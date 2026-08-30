/**
 * Active liveness flow (docs/ACTIVE_LIVENESS.md).
 *
 * Orchestrates: camera (user-facing, mirrored preview) + MediaPipe
 * FaceLandmarker + the pure ChallengeMachine + best-frame selection +
 * the oval overlay, then finalizes server-side via
 * POST /v3/store/ekyc/face-active-liveness/finalize.
 *
 * The signed verdict returned by the server is the ONLY proof of liveness;
 * on-device challenge results are UX guidance (docs/SECURITY.md).
 */
import { EkycApiClient } from '../core/api-client';
import { CameraController } from '../core/camera';
import {
  CancelledError,
  EkycError,
  FaceDetectorUnavailableError,
  LivenessFailedError,
} from '../core/errors';
import { clearCpuPin, persistCpuPin, readPersistedCpuPin } from './delegate-preference';
import { createTranslator, type Locale, type Translator } from '../core/i18n/i18n';
import { applyTheme, type EkycTheme } from '../core/theme';
import type { ActiveLivenessResult, SdkIntegration } from '../core/types';
import { resolveSdkIdentity } from '../version';
import {
  buildOverlay,
  computeOvalGuide,
  drawOvalOverlay,
  type GuideTone,
  type OverlayElements,
} from '../document-capture/overlay';
import { BestFrameSelector, laplacianVarianceRgba } from './best-frame-selector';
import {
  ChallengeMachine,
  type ChallengeMachineConfig,
  type ChallengeType,
  type FaceObservation,
  type MachineSnapshot,
} from './challenge-machine';
import {
  mapObservation,
  selectFaces,
  type FaceLandmarkerResultLike,
  type FaceSelection,
  type FaceSelectionConfig,
} from './face-metrics';
import { loadFaceLandmarker, type FaceLandmarkerLike } from './mediapipe-loader';
import { JPEG_QUALITY } from '../vision/perspective';

/** Face bbox is expanded by this margin for the selfie crop (spec: 40%). */
const SELFIE_CROP_MARGIN = 0.4;
/** Downscale width for the sharpness analysis crop (perf only). */
const ANALYSIS_CROP_WIDTH = 160;
/**
 * Unusable detector output (running, but every landmark set numerically
 * impossible) triggers a rebuild on the CPU delegate after 15 consecutive
 * frames — or, because a broken GPU path can also be SLOW (a field device
 * produced under 1 fps of garbage), after 3+ unusable frames spanning 2
 * seconds, whichever comes first. Long enough not to fire on a startup
 * hiccup, short enough that the user is not left staring at a hint they
 * cannot act on.
 */
const UNUSABLE_FRAMES_BEFORE_CPU_RETRY = 15;
const UNUSABLE_MIN_FRAMES = 3;
const UNUSABLE_MAX_WAIT_MS = 2000;
/**
 * Third failure shape: a delegate that returns NO faces, ever — not
 * garbage, not an error (field device, 27 Aug 2026). Legitimate "user not
 * in frame yet" looks identical for a while, so the CPU delegate is only
 * tried after this long with at least NO_DETECTION_MIN_FRAMES processed
 * frames and not one usable face. Harmless on a healthy device whose user
 * is slow to line up: the swap is silent.
 */
const NO_DETECTION_CPU_RETRY_MS = 8000;
const NO_DETECTION_MIN_FRAMES = 10;

const CHALLENGE_MESSAGE_KEY: Record<ChallengeType, string> = {
  blink: 'blink_now',
  // Arrow-enhanced variants: the preview is mirrored, so the user's left
  // is screen-left and the arrows point the natural way.
  turnLeft: 'turn_left_arrow',
  turnRight: 'turn_right_arrow',
  smile: 'smile_now',
};

export interface LivenessStateInfo {
  phase: MachineSnapshot['phase'];
  messageKey: string;
  challenge?: ChallengeType;
  challengeIndex?: number;
  challengeCount?: number;
}

export interface ActiveLivenessStartOptions {
  mount: HTMLElement;
  locale?: Locale;
  theme?: Partial<EkycTheme>;
  onState?: (info: LivenessStateInfo) => void;
  /** Ask the server to echo the selfie back as base64. */
  returnImage?: boolean;
  /** Self-hosted MediaPipe assets base URL (docs/SECURITY.md). */
  assetBaseUrl?: string;
  /** Override the face_landmarker model URL. */
  modelUrl?: string;
  /** Override challenge-machine constants (tests/tuning). */
  machineConfig?: Partial<ChallengeMachineConfig>;
  /** Debug hook: fires for every processed frame with the raw observation. */
  onObservation?: (obs: FaceObservation) => void;
  /**
   * Tuning for "how many people are in frame" (face-metrics.ts). Defaults
   * suit every device we have measured; override only on support advice.
   */
  faceSelection?: Partial<FaceSelectionConfig>;
  /** Wrapper SDK identity for the challenge log (docs/WEBVIEW_BRIDGE.md). */
  integration?: SdkIntegration;
}

export class ActiveLivenessFlow {
  private readonly api: EkycApiClient;

  constructor(api: EkycApiClient) {
    this.api = api;
  }

  start(options: ActiveLivenessStartOptions): Promise<ActiveLivenessResult> {
    return new Promise<ActiveLivenessResult>((resolve, reject) => {
      void new LivenessSession(this.api, options, resolve, reject).run();
    });
  }
}

class LivenessSession {
  private readonly api: EkycApiClient;
  private readonly options: ActiveLivenessStartOptions;
  private readonly resolve: (r: ActiveLivenessResult) => void;
  private readonly reject: (e: unknown) => void;
  private readonly t: Translator;
  private readonly machine: ChallengeMachine;
  private readonly selector = new BestFrameSelector<HTMLCanvasElement>();

  private overlay: OverlayElements | null = null;
  private camera: CameraController | null = null;
  private landmarker: FaceLandmarkerLike | null = null;
  private rafId: number | null = null;
  private finished = false;
  private lastVideoTime = -1;
  private lastMessageKey = '';
  private analysisCanvas: HTMLCanvasElement | null = null;
  private bestCanvas: HTMLCanvasElement | null = null;
  private unusableStreak = 0;
  private unusableSinceMs = 0;
  private delegateStartedMs = 0;
  private framesOnDelegate = 0;
  private sawUsableFace = false;
  private triedCpuDelegate = false;
  private swappingDelegate = false;
  private recoveredToCpu = false;
  private cpuPinWasUsed = false;
  private cpuPinStored = false;

  constructor(
    api: EkycApiClient,
    options: ActiveLivenessStartOptions,
    resolve: (r: ActiveLivenessResult) => void,
    reject: (e: unknown) => void,
  ) {
    this.api = api;
    this.options = options;
    this.resolve = resolve;
    this.reject = reject;
    this.t = createTranslator(options.locale ?? 'en');
    this.machine = new ChallengeMachine(options.machineConfig);
  }

  async run(): Promise<void> {
    try {
      applyTheme(this.options.mount, this.options.theme);
      this.overlay = buildOverlay(this.options.mount, this.t, { mirror: true });
      this.overlay.manualButton.style.display = 'none';
      this.overlay.progressTrack.style.display = 'none';
      this.overlay.cancelButton.addEventListener('click', () => this.cancel());
      this.overlay.chip.textContent = this.t('initializing');

      this.camera = new CameraController();
      // A device that previously proved its GPU delegate emits garbage
      // starts straight on the CPU delegate (delegate-preference.ts).
      const pinnedCpu = readPersistedCpuPin();
      if (pinnedCpu) {
        this.triedCpuDelegate = true;
        this.cpuPinWasUsed = true;
      }
      const [, landmarker] = await Promise.all([
        this.camera.open(this.overlay.video, { facingMode: 'user' }),
        loadFaceLandmarker({
          assetBaseUrl: this.options.assetBaseUrl,
          modelUrl: this.options.modelUrl,
          delegate: pinnedCpu ? 'CPU' : undefined,
        }),
      ]);
      if (this.finished) return;
      this.landmarker = landmarker;
      this.delegateStartedMs = performance.now();

      const video = this.overlay.video;
      this.overlay.canvas.width = video.videoWidth;
      this.overlay.canvas.height = video.videoHeight;
      this.analysisCanvas = document.createElement('canvas');

      this.machine.start();
      this.loop();
    } catch (e) {
      this.fail(e);
    }
  }

  private loop = (): void => {
    if (this.finished) return;
    this.rafId = requestAnimationFrame(this.loop);
    const overlay = this.overlay;
    const landmarker = this.landmarker;
    if (!overlay || !landmarker) return;
    const video = overlay.video;
    if (video.videoWidth === 0 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    let result: FaceLandmarkerResultLike;
    try {
      result = landmarker.detectForVideo(video, performance.now()) as FaceLandmarkerResultLike;
    } catch {
      // A broken GPU delegate can THROW on detect instead of returning
      // garbage (same field device, a day later). Same treatment.
      if (this.noteUnusableFrame()) void this.recoverFromUnusableDetector();
      return;
    }
    this.framesOnDelegate += 1;

    const oval = computeOvalGuide(video.videoWidth, video.videoHeight);
    const selection = selectFaces(result, this.options.faceSelection);
    const obs = mapObservation(result, {
      frameWidth: video.videoWidth,
      frameHeight: video.videoHeight,
      ovalCenterX: oval.cx / video.videoWidth,
      ovalCenterY: oval.cy / video.videoHeight,
      selection,
    });

    // The detector is running but returning impossible coordinates: retry
    // on the CPU delegate once, then surface a real error. Without this the
    // flow shows a hint the user cannot act on, forever, and never calls
    // back (field report, Galaxy S25 Ultra, Aug 2026).
    if (selection.rejected > 0 && selection.count === 0) {
      if (this.noteUnusableFrame()) {
        void this.recoverFromUnusableDetector();
        return;
      }
    } else if (selection.count > 0) {
      this.unusableStreak = 0;
      this.sawUsableFace = true;
      // The CPU delegate proved itself after a garbage GPU run: remember it
      // so future sessions on this device skip the broken delegate.
      if (this.recoveredToCpu && !this.cpuPinStored) {
        this.cpuPinStored = true;
        persistCpuPin();
      }
    }

    if (this.shouldRetryAfterNoDetections()) {
      void this.recoverFromUnusableDetector();
      return;
    }

    this.options.onObservation?.(obs);
    const snapshot = this.machine.process(obs);
    this.considerBestFrame(selection, obs, video);
    this.render(snapshot, obs, oval);

    if (snapshot.phase === 'capture') {
      void this.finalize();
    } else if (snapshot.phase === 'failed') {
      this.fail(new LivenessFailedError(snapshot.failReason ?? 'unknown'));
    }
  };

  /** Track one unusable/throwing detector frame; true = give up on delegate. */
  private noteUnusableFrame(): boolean {
    const now = performance.now();
    if (this.unusableStreak === 0) this.unusableSinceMs = now;
    this.unusableStreak += 1;
    return (
      this.unusableStreak >= UNUSABLE_FRAMES_BEFORE_CPU_RETRY ||
      (this.unusableStreak >= UNUSABLE_MIN_FRAMES &&
        now - this.unusableSinceMs >= UNUSABLE_MAX_WAIT_MS)
    );
  }

  /** The no-faces-ever fallback (see NO_DETECTION_CPU_RETRY_MS). */
  private shouldRetryAfterNoDetections(): boolean {
    return (
      !this.triedCpuDelegate &&
      !this.sawUsableFace &&
      this.framesOnDelegate >= NO_DETECTION_MIN_FRAMES &&
      performance.now() - this.delegateStartedMs >= NO_DETECTION_CPU_RETRY_MS
    );
  }

  /**
   * Rebuild the landmarker on the CPU delegate after the GPU one produced
   * unusable output. Only ever tried once per session; if the CPU delegate
   * is no better, the session fails with a typed error so the host app's
   * error callback fires instead of the flow hanging.
   */
  private async recoverFromUnusableDetector(): Promise<void> {
    if (this.swappingDelegate || this.finished) return;
    if (this.triedCpuDelegate) {
      // The CPU delegate is broken too. If we started pinned to it, drop
      // the pin so the next session retries the GPU (a driver update may
      // have fixed it) — then surface a real error instead of hanging.
      if (this.cpuPinWasUsed) clearCpuPin();
      this.fail(new FaceDetectorUnavailableError());
      return;
    }
    this.swappingDelegate = true;
    this.triedCpuDelegate = true;
    this.unusableStreak = 0;
    try {
      const cpu = await loadFaceLandmarker({
        assetBaseUrl: this.options.assetBaseUrl,
        modelUrl: this.options.modelUrl,
        delegate: 'CPU',
      });
      if (this.finished) return;
      this.landmarker = cpu;
      this.recoveredToCpu = true;
      this.delegateStartedMs = performance.now();
      this.framesOnDelegate = 0;
    } catch (e) {
      this.fail(new FaceDetectorUnavailableError(undefined, { cause: e }));
    } finally {
      this.swappingDelegate = false;
    }
  }

  /** Best-frame selection across the entire session (spec). */
  private considerBestFrame(
    selection: FaceSelection,
    obs: FaceObservation,
    video: HTMLVideoElement,
  ): void {
    if (!this.selector.isCandidate(obs) || !this.analysisCanvas) return;
    const bbox = selection.box;
    if (!bbox) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const faceX = bbox.minX * vw;
    const faceY = bbox.minY * vh;
    const faceW = (bbox.maxX - bbox.minX) * vw;
    const faceH = (bbox.maxY - bbox.minY) * vh;
    if (faceW < 8 || faceH < 8) return;

    // Sharpness on a small downscaled face crop (cheap at frame rate).
    const aw = ANALYSIS_CROP_WIDTH;
    const ah = Math.max(8, Math.round((faceH / faceW) * aw));
    this.analysisCanvas.width = aw;
    this.analysisCanvas.height = ah;
    const actx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
    if (!actx) return;
    actx.drawImage(video, faceX, faceY, faceW, faceH, 0, 0, aw, ah);
    const sample = actx.getImageData(0, 0, aw, ah);
    const score = this.selector.score(
      laplacianVarianceRgba(sample.data, aw, ah),
      obs,
    );
    if (score <= (this.selector.best?.score ?? -Infinity)) return;

    // New best: snapshot the face crop expanded by 40% at native res.
    const marginX = faceW * SELFIE_CROP_MARGIN;
    const marginY = faceH * SELFIE_CROP_MARGIN;
    const cx = Math.max(0, faceX - marginX);
    const cy = Math.max(0, faceY - marginY);
    const cw = Math.min(vw - cx, faceW + marginX * 2);
    const ch = Math.min(vh - cy, faceH + marginY * 2);
    const crop = document.createElement('canvas');
    crop.width = Math.round(cw);
    crop.height = Math.round(ch);
    const cctx = crop.getContext('2d');
    if (!cctx) return;
    cctx.drawImage(video, cx, cy, cw, ch, 0, 0, crop.width, crop.height);
    this.bestCanvas = crop;
    this.selector.offer(score, crop);
  }

  private messageKeyFor(snapshot: MachineSnapshot, obs: FaceObservation): string {
    switch (snapshot.phase) {
      case 'findFace':
        if (obs.count === 0) return 'center_face';
        if (snapshot.multiFace) return 'multiple_faces';
        if (obs.faceWidthFrac < 0.25) return 'move_face_closer';
        if (obs.centerOffsetFrac >= 0.12) return 'center_face';
        return 'hold_face';
      case 'challenge': {
        if (obs.count === 0) return 'face_lost';
        if (snapshot.multiFace) return 'multiple_faces';
        const type = snapshot.currentChallenge;
        return type ? CHALLENGE_MESSAGE_KEY[type] : 'hold_face';
      }
      case 'recenter':
        return 'recenter_face';
      case 'capture':
      case 'finalizing':
        return 'finalizing';
      case 'done':
        return 'liveness_passed';
      case 'failed':
        return 'liveness_failed';
      default:
        return 'get_ready';
    }
  }

  private toneFor(snapshot: MachineSnapshot): GuideTone {
    switch (snapshot.phase) {
      case 'findFace':
        return snapshot.holdFrames > 0 ? 'active' : 'idle';
      case 'challenge':
        return 'active';
      case 'recenter':
        return snapshot.holdFrames > 0 ? 'active' : 'warning';
      case 'capture':
      case 'finalizing':
      case 'done':
        return 'locked';
      case 'failed':
        return 'error';
      default:
        return 'idle';
    }
  }

  private render(
    snapshot: MachineSnapshot,
    obs: FaceObservation,
    oval: ReturnType<typeof computeOvalGuide>,
  ): void {
    const overlay = this.overlay;
    if (!overlay) return;
    const messageKey = this.messageKeyFor(snapshot, obs);
    if (messageKey !== this.lastMessageKey) {
      this.lastMessageKey = messageKey;
      overlay.chip.textContent = this.t(messageKey);
      this.options.onState?.({
        phase: snapshot.phase,
        messageKey,
        challenge: snapshot.currentChallenge ?? undefined,
        challengeIndex: snapshot.challengeIndex >= 0 ? snapshot.challengeIndex : undefined,
        challengeCount: snapshot.challengeCount,
      });
    }
    const arrow =
      snapshot.phase === 'challenge' && snapshot.currentChallenge === 'turnLeft'
        ? ('left' as const)
        : snapshot.phase === 'challenge' && snapshot.currentChallenge === 'turnRight'
          ? ('right' as const)
          : null;
    drawOvalOverlay(
      overlay.canvas,
      this.options.mount,
      oval,
      this.toneFor(snapshot),
      snapshot.challengeCount,
      snapshot.completedCount,
      arrow,
    );
  }

  private async finalize(): Promise<void> {
    if (this.finished) return;
    this.stopLoop();
    const overlay = this.overlay;
    if (overlay) overlay.chip.textContent = this.t('finalizing');
    try {
      const source = this.bestCanvas ?? this.fallbackFrame();
      const selfie = await new Promise<Blob>((res, rej) =>
        source.toBlob(
          (b) => (b ? res(b) : rej(new EkycError('JPEG encoding failed'))),
          'image/jpeg',
          JPEG_QUALITY,
        ),
      );
      this.machine.markFinalizing();
      const log = this.machine.buildChallengeLog(resolveSdkIdentity(this.options.integration));
      // Network/server failure => failed(finalizeError); NEVER retried
      // (billable request, docs/API_CONTRACTS.md).
      const result = await this.api.finalizeActiveLiveness(selfie, log, {
        returnImage: this.options.returnImage,
      });
      this.machine.markDone();
      result.selfieImage = selfie;
      this.options.onState?.({ phase: 'done', messageKey: 'liveness_passed' });
      this.finish();
      this.resolve(result);
    } catch (e) {
      this.machine.markFailed('finalizeError');
      this.fail(e);
    }
  }

  /** Should not happen in practice: capture reached without a candidate. */
  private fallbackFrame(): HTMLCanvasElement {
    const video = this.overlay?.video;
    const canvas = document.createElement('canvas');
    canvas.width = video?.videoWidth ?? 1;
    canvas.height = video?.videoHeight ?? 1;
    const ctx = canvas.getContext('2d');
    if (ctx && video) ctx.drawImage(video, 0, 0);
    return canvas;
  }

  private cancel(): void {
    if (this.finished) return;
    this.options.onState?.({ phase: 'failed', messageKey: 'error_cancelled' });
    this.finish();
    this.reject(new CancelledError());
  }

  private fail(e: unknown): void {
    if (this.finished) return;
    if (this.overlay) {
      this.overlay.chip.textContent = this.t(
        e instanceof EkycError ? e.userMessageKey : 'liveness_failed',
      );
    }
    this.options.onState?.({ phase: 'failed', messageKey: 'liveness_failed' });
    this.finish();
    this.reject(e);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** Clean teardown: camera, RAF loop, DOM. Safe to call multiple times. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stopLoop();
    this.camera?.stop();
    this.camera = null;
    // The landmarker is shared (mediapipe-loader keeps one instance);
    // do NOT close() it here or a second session would break.
    this.landmarker = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.analysisCanvas = null;
    this.bestCanvas = null;
  }
}
