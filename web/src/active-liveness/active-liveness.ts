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
import { CancelledError, EkycError, LivenessFailedError } from '../core/errors';
import { createTranslator, type Locale, type Translator } from '../core/i18n/i18n';
import { applyTheme, type EkycTheme } from '../core/theme';
import type { ActiveLivenessResult } from '../core/types';
import { SDK_NAME, SDK_VERSION } from '../version';
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
import { faceBoundingBox, mapObservation, type FaceLandmarkerResultLike } from './face-metrics';
import { loadFaceLandmarker, type FaceLandmarkerLike } from './mediapipe-loader';
import { JPEG_QUALITY } from '../vision/perspective';

/** Face bbox is expanded by this margin for the selfie crop (spec: 40%). */
const SELFIE_CROP_MARGIN = 0.4;
/** Downscale width for the sharpness analysis crop (perf only). */
const ANALYSIS_CROP_WIDTH = 160;

const CHALLENGE_MESSAGE_KEY: Record<ChallengeType, string> = {
  blink: 'blink_now',
  turnLeft: 'turn_left',
  turnRight: 'turn_right',
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
      const [, landmarker] = await Promise.all([
        this.camera.open(this.overlay.video, { facingMode: 'user' }),
        loadFaceLandmarker({
          assetBaseUrl: this.options.assetBaseUrl,
          modelUrl: this.options.modelUrl,
        }),
      ]);
      if (this.finished) return;
      this.landmarker = landmarker;

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

    const result = landmarker.detectForVideo(
      video,
      performance.now(),
    ) as FaceLandmarkerResultLike;

    const oval = computeOvalGuide(video.videoWidth, video.videoHeight);
    const obs = mapObservation(result, {
      frameWidth: video.videoWidth,
      frameHeight: video.videoHeight,
      ovalCenterX: oval.cx / video.videoWidth,
      ovalCenterY: oval.cy / video.videoHeight,
    });

    this.options.onObservation?.(obs);
    const snapshot = this.machine.process(obs);
    this.considerBestFrame(result, obs, video);
    this.render(snapshot, obs, oval);

    if (snapshot.phase === 'capture') {
      void this.finalize();
    } else if (snapshot.phase === 'failed') {
      this.fail(new LivenessFailedError(snapshot.failReason ?? 'unknown'));
    }
  };

  /** Best-frame selection across the entire session (spec). */
  private considerBestFrame(
    result: FaceLandmarkerResultLike,
    obs: FaceObservation,
    video: HTMLVideoElement,
  ): void {
    if (!this.selector.isCandidate(obs) || !this.analysisCanvas) return;
    const bbox = faceBoundingBox(result);
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
        if (obs.count > 1) return 'multiple_faces';
        if (obs.faceWidthFrac < 0.25) return 'move_face_closer';
        if (obs.centerOffsetFrac >= 0.12) return 'center_face';
        return 'hold_face';
      case 'challenge': {
        if (obs.count === 0) return 'face_lost';
        if (obs.count > 1) return 'multiple_faces';
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
    drawOvalOverlay(
      overlay.canvas,
      this.options.mount,
      oval,
      this.toneFor(snapshot),
      snapshot.challengeCount,
      snapshot.completedCount,
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
      const log = this.machine.buildChallengeLog({
        name: SDK_NAME,
        version: SDK_VERSION,
        platform: 'web',
      });
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
