/**
 * Face auto-capture ("auto face snap").
 *
 * Opens the user-facing camera, runs MediaPipe FaceLandmarker, and when ONE
 * frontal face (|yaw| < 15, |pitch| < 12, faceWidthFrac >= 0.22, eyes open)
 * is held motion-stable for ~0.4 s, plays the shutter flash, freezes the
 * frame and resolves with the cropped selfie JPEG (face bbox + 40% margin,
 * quality 0.92). NO liveness challenges — just a good-selfie snapshot.
 *
 * Reuses the oval overlay + shutter/freeze (document-capture/overlay) and the
 * best-frame selector (sharpness x faceWidthFrac^2) from active liveness, and
 * lazy-loads MediaPipe exactly like the liveness flow.
 */
import { CameraController } from '../core/camera';
import { CancelledError, EkycError } from '../core/errors';
import { createTranslator, type Locale, type Translator } from '../core/i18n/i18n';
import { applyTheme, type EkycTheme } from '../core/theme';
import {
  buildOverlay,
  computeOvalGuide,
  drawOvalOverlay,
  type GuideTone,
  type OverlayElements,
} from '../document-capture/overlay';
import { JPEG_QUALITY } from '../vision/perspective';
import { BestFrameSelector, laplacianVarianceRgba } from './best-frame-selector';
import type { FaceObservation } from './challenge-machine';
import { faceBoundingBox, mapObservation, type FaceLandmarkerResultLike } from './face-metrics';
import { loadFaceLandmarker, type FaceLandmarkerLike } from './mediapipe-loader';

export type FaceCaptureState =
  | 'initializing'
  | 'searching'
  | 'holdStill'
  | 'capturing'
  | 'done'
  | 'cancelled'
  | 'error';

export interface FaceCaptureStartOptions {
  /** Element the capture UI is mounted into. */
  mount: HTMLElement;
  locale?: Locale;
  theme?: Partial<EkycTheme>;
  /** Observe UX state transitions (for host-app chrome, analytics, ...). */
  onState?: (state: FaceCaptureState, info: { messageKey: string }) => void;
  /** Self-hosted MediaPipe assets base URL (docs/SECURITY.md). */
  assetBaseUrl?: string;
  /** Override the face_landmarker model URL. */
  modelUrl?: string;
}

/** Frontal gate for a good selfie snapshot. */
const FRONTAL_MAX_YAW_DEG = 15;
const FRONTAL_MAX_PITCH_DEG = 12;
const MIN_FACE_WIDTH_FRAC = 0.22;
/** "Eyes open" gate (1 - blendshape blink). */
const MIN_EYE_OPEN = 0.5;
/** Face must sit within this normalized distance of the oval center. */
const MAX_CENTER_OFFSET_FRAC = 0.18;
/** Hold ~0.4 s of a motion-stable frontal face before the auto snap. */
const HOLD_MS = 400;
/** Motion-stability tolerance: per-frame face center / width drift (frac). */
const MAX_MOTION_DRIFT_FRAC = 0.03;
/** Manual "capture now" button appears after this long. */
const MANUAL_FALLBACK_MS = 4_000;
/** Selfie crop margin around the face bbox (spec: 40%). */
const SELFIE_CROP_MARGIN = 0.4;
/** Downscale width for the cheap per-frame sharpness analysis crop. */
const ANALYSIS_CROP_WIDTH = 160;

const STATE_MESSAGE_KEY: Record<FaceCaptureState, string> = {
  initializing: 'initializing',
  searching: 'center_face',
  holdStill: 'hold_face',
  capturing: 'capturing',
  done: 'done',
  cancelled: 'error_cancelled',
  error: 'error_generic',
};

const STATE_TONE: Record<FaceCaptureState, GuideTone> = {
  initializing: 'idle',
  searching: 'idle',
  holdStill: 'active',
  capturing: 'locked',
  done: 'locked',
  cancelled: 'error',
  error: 'error',
};

/** Public entry: spawns one face-capture session. */
export class FaceCapture {
  /** Run the auto face-snap flow. Resolves with the cropped selfie JPEG. */
  captureFace(options: FaceCaptureStartOptions): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      void new FaceCaptureSession(options, resolve, reject).run();
    });
  }
}

/** Previous-frame face box (normalized) for the motion-stability check. */
interface FaceMotionRef {
  cx: number;
  cy: number;
  width: number;
}

/** One capture attempt; owns all resources and guarantees teardown. */
class FaceCaptureSession {
  private readonly options: FaceCaptureStartOptions;
  private readonly resolve: (b: Blob) => void;
  private readonly reject: (e: unknown) => void;
  private readonly t: Translator;
  private readonly selector: BestFrameSelector<HTMLCanvasElement>;

  private overlay: OverlayElements | null = null;
  private camera: CameraController | null = null;
  private landmarker: FaceLandmarkerLike | null = null;
  private rafId: number | null = null;
  private manualTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;
  private state: FaceCaptureState = 'initializing';
  private lastVideoTime = -1;
  private lastMessageKey = '';
  private analysisCanvas: HTMLCanvasElement | null = null;
  private bestCanvas: HTMLCanvasElement | null = null;
  private holdSince: number | null = null;
  private motionRef: FaceMotionRef | null = null;
  private freezeUrl: string | null = null;

  constructor(
    options: FaceCaptureStartOptions,
    resolve: (b: Blob) => void,
    reject: (e: unknown) => void,
  ) {
    this.options = options;
    this.resolve = resolve;
    this.reject = reject;
    this.t = createTranslator(options.locale ?? 'en');
    // Selector candidate gate matches the frontal snap gate below so the
    // saved crop is drawn from the same frames we consider "good".
    this.selector = new BestFrameSelector<HTMLCanvasElement>({
      maxAbsYawDeg: FRONTAL_MAX_YAW_DEG,
      maxAbsPitchDeg: FRONTAL_MAX_PITCH_DEG,
      minEyeOpen: MIN_EYE_OPEN,
      minFaceWidthFrac: MIN_FACE_WIDTH_FRAC,
    });
  }

  async run(): Promise<void> {
    try {
      applyTheme(this.options.mount, this.options.theme);
      this.overlay = buildOverlay(this.options.mount, this.t, { mirror: true });
      this.overlay.progressTrack.style.display = 'none';
      this.overlay.manualButton.style.display = 'none';
      this.overlay.manualButton.addEventListener('click', () => {
        void this.capture();
      });
      this.overlay.cancelButton.addEventListener('click', () => this.cancel());
      this.setState('initializing');

      this.camera = new CameraController();
      const [, landmarker] = await Promise.all([
        this.camera.open(this.overlay.video, { facingMode: 'user' }),
        loadFaceLandmarker({
          assetBaseUrl: this.options.assetBaseUrl,
          modelUrl: this.options.modelUrl,
        }),
      ]);
      if (this.finished) return; // cancelled while starting up
      this.landmarker = landmarker;

      const video = this.overlay.video;
      this.overlay.canvas.width = video.videoWidth;
      this.overlay.canvas.height = video.videoHeight;
      this.analysisCanvas = document.createElement('canvas');

      this.setState('searching');
      this.manualTimer = setTimeout(() => {
        if (!this.finished && this.overlay) this.overlay.manualButton.style.display = '';
      }, MANUAL_FALLBACK_MS);

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

    const result = landmarker.detectForVideo(video, performance.now()) as FaceLandmarkerResultLike;
    const oval = computeOvalGuide(video.videoWidth, video.videoHeight);
    const obs = mapObservation(result, {
      frameWidth: video.videoWidth,
      frameHeight: video.videoHeight,
      ovalCenterX: oval.cx / video.videoWidth,
      ovalCenterY: oval.cy / video.videoHeight,
    });

    this.considerBestFrame(result, obs, video);

    const frontal = this.isFrontal(obs);
    const motionStable = this.updateMotion(result, obs);
    const now = performance.now();
    if (frontal && motionStable) {
      if (this.holdSince === null) this.holdSince = now;
    } else {
      this.holdSince = null;
    }
    const held = this.holdSince !== null && now - this.holdSince >= HOLD_MS;

    this.render(obs, frontal, oval);

    if (held) void this.capture();
  };

  private isFrontal(obs: FaceObservation): boolean {
    return (
      obs.count === 1 &&
      Math.abs(obs.yawDeg) < FRONTAL_MAX_YAW_DEG &&
      Math.abs(obs.pitchDeg) < FRONTAL_MAX_PITCH_DEG &&
      obs.faceWidthFrac >= MIN_FACE_WIDTH_FRAC &&
      obs.leftEyeOpen > MIN_EYE_OPEN &&
      obs.rightEyeOpen > MIN_EYE_OPEN &&
      obs.centerOffsetFrac < MAX_CENTER_OFFSET_FRAC
    );
  }

  /**
   * Motion-stability: the face box must not drift more than
   * `MAX_MOTION_DRIFT_FRAC` (normalized) vs the previous frame. Updates the
   * reference box. A missing / multi-face frame resets the reference and is
   * never stable.
   */
  private updateMotion(result: FaceLandmarkerResultLike, obs: FaceObservation): boolean {
    if (obs.count !== 1) {
      this.motionRef = null;
      return false;
    }
    const bbox = faceBoundingBox(result);
    if (!bbox) {
      this.motionRef = null;
      return false;
    }
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const width = bbox.maxX - bbox.minX;
    const prev = this.motionRef;
    let stable = false;
    if (prev) {
      const drift = Math.max(
        Math.abs(cx - prev.cx),
        Math.abs(cy - prev.cy),
        Math.abs(width - prev.width),
      );
      stable = drift <= MAX_MOTION_DRIFT_FRAC;
    }
    this.motionRef = { cx, cy, width };
    return stable;
  }

  /**
   * Best-frame selection: on every frontal candidate, score
   * `laplacianVariance x faceWidthFrac^2` on a small face crop and, when it
   * beats the current best, snapshot the 40%-margin selfie crop at native
   * resolution (identical to the active-liveness best-frame logic).
   */
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

    const aw = ANALYSIS_CROP_WIDTH;
    const ah = Math.max(8, Math.round((faceH / faceW) * aw));
    this.analysisCanvas.width = aw;
    this.analysisCanvas.height = ah;
    const actx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
    if (!actx) return;
    actx.drawImage(video, faceX, faceY, faceW, faceH, 0, 0, aw, ah);
    const sample = actx.getImageData(0, 0, aw, ah);
    const score = this.selector.score(laplacianVarianceRgba(sample.data, aw, ah), obs);
    if (score <= (this.selector.best?.score ?? -Infinity)) return;

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

  /** Resolve the per-frame UX state + chip message, then draw the oval. */
  private render(
    obs: FaceObservation,
    frontal: boolean,
    oval: ReturnType<typeof computeOvalGuide>,
  ): void {
    if (this.state === 'capturing' || this.state === 'done') return;
    let state: FaceCaptureState;
    let messageKey: string;
    if (obs.count === 0) {
      state = 'searching';
      messageKey = 'center_face';
    } else if (obs.count > 1) {
      state = 'searching';
      messageKey = 'multiple_faces';
    } else if (obs.faceWidthFrac < MIN_FACE_WIDTH_FRAC) {
      state = 'searching';
      messageKey = 'move_face_closer';
    } else if (!frontal) {
      state = 'searching';
      messageKey = obs.centerOffsetFrac >= MAX_CENTER_OFFSET_FRAC ? 'center_face' : 'look_straight';
    } else {
      state = 'holdStill';
      messageKey = 'hold_face';
    }

    this.state = state;
    if (messageKey !== this.lastMessageKey) {
      this.lastMessageKey = messageKey;
      if (this.overlay) this.overlay.chip.textContent = this.t(messageKey);
      this.options.onState?.(state, { messageKey });
    }
    if (this.overlay) {
      drawOvalOverlay(this.overlay.canvas, this.options.mount, oval, STATE_TONE[state], 0, 0);
    }
  }

  private setState(state: FaceCaptureState): void {
    this.state = state;
    const messageKey = STATE_MESSAGE_KEY[state];
    this.lastMessageKey = messageKey;
    if (this.overlay) this.overlay.chip.textContent = this.t(messageKey);
    this.options.onState?.(state, { messageKey });
  }

  /** Freeze + shutter + encode the best crop, then resolve. */
  private async capture(): Promise<void> {
    if (this.finished) return;
    const overlay = this.overlay;
    if (!overlay) return;
    this.stopLoop();
    this.setState('capturing');
    this.playShutter();
    try {
      const source = this.bestCanvas ?? this.fallbackFrame();
      const blob = await new Promise<Blob>((res, rej) =>
        source.toBlob(
          (b) => (b ? res(b) : rej(new EkycError('JPEG encoding failed'))),
          'image/jpeg',
          JPEG_QUALITY,
        ),
      );
      this.showFreeze(blob);
      this.setState('done');
      this.finish();
      this.resolve(blob);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Fallback: no candidate was ever captured — grab the current frame. */
  private fallbackFrame(): HTMLCanvasElement {
    const video = this.overlay?.video;
    const canvas = document.createElement('canvas');
    canvas.width = video?.videoWidth ?? 1;
    canvas.height = video?.videoHeight ?? 1;
    const ctx = canvas.getContext('2d');
    if (ctx && video) ctx.drawImage(video, 0, 0);
    return canvas;
  }

  /** Camera-shutter flash: snap to opaque white, then fade out. */
  private playShutter(): void {
    const flash = this.overlay?.flash;
    if (!flash) return;
    flash.style.transition = 'none';
    flash.style.opacity = '0.85';
    void flash.offsetWidth; // force reflow so the fade animates
    flash.style.transition = 'opacity 320ms ease-out';
    flash.style.opacity = '0';
  }

  /** Show the captured JPEG frozen over the video. */
  private showFreeze(blob: Blob): void {
    const freeze = this.overlay?.freeze;
    if (!freeze) return;
    if (this.freezeUrl) URL.revokeObjectURL(this.freezeUrl);
    this.freezeUrl = URL.createObjectURL(blob);
    freeze.src = this.freezeUrl;
    freeze.style.display = 'block';
  }

  private cancel(): void {
    if (this.finished) return;
    this.setState('cancelled');
    this.finish();
    this.reject(new CancelledError());
  }

  private fail(e: unknown): void {
    if (this.finished) return;
    this.state = 'error';
    if (this.overlay) {
      this.overlay.chip.textContent = this.t(
        e instanceof EkycError ? e.userMessageKey : 'error_generic',
      );
    }
    this.options.onState?.('error', { messageKey: STATE_MESSAGE_KEY.error });
    this.finish();
    this.reject(e);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.manualTimer !== null) {
      clearTimeout(this.manualTimer);
      this.manualTimer = null;
    }
  }

  /** Clean teardown: camera, RAF loop, DOM. Safe to call multiple times. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stopLoop();
    this.camera?.stop();
    this.camera = null;
    // The landmarker is shared (mediapipe-loader keeps one instance); do NOT
    // close() it here or a second session would break.
    this.landmarker = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.analysisCanvas = null;
    this.bestCanvas = null;
    this.motionRef = null;
    this.holdSince = null;
    if (this.freezeUrl) {
      URL.revokeObjectURL(this.freezeUrl);
      this.freezeUrl = null;
    }
  }
}
