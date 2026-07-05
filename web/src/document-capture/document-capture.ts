/**
 * Document auto-capture flow (docs/ALGORITHM.md).
 *
 * start() builds the camera UI inside `mount`, runs the 10 fps detection
 * loop (frames are DROPPED, never queued, while a previous frame is being
 * processed), auto-captures when the stability + sharpness triggers hold,
 * perspective-corrects, uploads, and resolves with the OCR result.
 *
 * UX states: searching → holdStill → tooBlurry|moveCloser|alignCard →
 * capturing → uploading → done | error. A manual capture button appears
 * after 10 s without auto-capture.
 */
import { EkycApiClient } from '../core/api-client';
import { CameraController } from '../core/camera';
import { CancelledError, EkycError, FileTooLargeError } from '../core/errors';
import { createTranslator, type Locale, type Translator } from '../core/i18n/i18n';
import { applyTheme, type EkycTheme } from '../core/theme';
import { loadOpenCv, type CV, type CvMat } from '../core/opencv-loader';
import type { DocumentResult } from '../core/types';
import { quadBoundingBox, laplacianVariance } from '../vision/blur-score';
import type { Quad } from '../vision/geometry';
import { MAX_UPLOAD_BYTES, warpToJpegBlob, JPEG_QUALITY } from '../vision/perspective';
import {
  computeGuideRect,
  DEFAULT_DETECTION_PARAMS,
  detectQuad,
  type DetectionParams,
  type GuideRect,
} from '../vision/quad-detector';
import { StabilityTracker } from '../vision/stability-tracker';
import { DOCUMENT_SPECS, type DocumentType } from './document-types';
import { buildOverlay, drawDocumentOverlay, type GuideTone, type OverlayElements } from './overlay';

export type CaptureState =
  | 'initializing'
  | 'searching'
  | 'holdStill'
  | 'tooBlurry'
  | 'moveCloser'
  | 'alignCard'
  | 'capturing'
  | 'uploading'
  | 'done'
  | 'error'
  | 'cancelled';

const STATE_MESSAGE_KEY: Record<CaptureState, string> = {
  initializing: 'initializing',
  searching: 'searching_card',
  holdStill: 'hold_still',
  tooBlurry: 'too_blurry',
  moveCloser: 'move_closer',
  alignCard: 'align_card',
  capturing: 'capturing',
  uploading: 'uploading',
  done: 'done',
  error: 'error_generic',
  cancelled: 'error_cancelled',
};

const STATE_TONE: Record<CaptureState, GuideTone> = {
  initializing: 'idle',
  searching: 'idle',
  holdStill: 'active',
  tooBlurry: 'warning',
  moveCloser: 'warning',
  alignCard: 'warning',
  capturing: 'locked',
  uploading: 'locked',
  done: 'locked',
  error: 'error',
  cancelled: 'error',
};

export interface DocumentCaptureStartOptions {
  /** Element the capture UI is mounted into. */
  mount: HTMLElement;
  documentType: DocumentType;
  locale?: Locale;
  theme?: Partial<EkycTheme>;
  /** Observe UX state transitions (for host-app chrome, analytics, ...). */
  onState?: (state: CaptureState, info: { messageKey: string }) => void;
  /** Override detection constants (defaults = docs/ALGORITHM.md). */
  params?: Partial<DetectionParams>;
  /** Camera facing (default 'environment'). */
  cameraFacing?: 'user' | 'environment';
  /** Self-hosted opencv.js URL for no-bundler setups (docs/SECURITY.md). */
  opencvScriptUrl?: string;
}

interface RingBufferEntry {
  quad: Quad;
  sharpness: number;
}

export class DocumentCapture {
  private readonly api: EkycApiClient;

  constructor(api: EkycApiClient) {
    this.api = api;
  }

  /** Run the full capture flow. Resolves with the OCR result. */
  start(options: DocumentCaptureStartOptions): Promise<DocumentResult> {
    return new Promise<DocumentResult>((resolve, reject) => {
      void new CaptureSession(this.api, options, resolve, reject).run();
    });
  }
}

/** One capture attempt; owns all resources and guarantees teardown. */
class CaptureSession {
  private readonly api: EkycApiClient;
  private readonly options: DocumentCaptureStartOptions;
  private readonly resolve: (r: DocumentResult) => void;
  private readonly reject: (e: unknown) => void;
  private readonly params: DetectionParams;
  private readonly t: Translator;

  private overlay: OverlayElements | null = null;
  private camera: CameraController | null = null;
  private cv: CV | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private manualTimer: ReturnType<typeof setTimeout> | null = null;
  private tracker: StabilityTracker | null = null;
  private ring: RingBufferEntry[] = [];
  private procCanvas: HTMLCanvasElement | null = null;
  private busy = false;
  private finished = false;
  private state: CaptureState = 'initializing';
  private lastQuadProcessed: Quad | null = null;
  private processedWidth = 0;
  private processedHeight = 0;
  private freezeUrl: string | null = null;

  constructor(
    api: EkycApiClient,
    options: DocumentCaptureStartOptions,
    resolve: (r: DocumentResult) => void,
    reject: (e: unknown) => void,
  ) {
    this.api = api;
    this.options = options;
    this.resolve = resolve;
    this.reject = reject;
    this.params = { ...DEFAULT_DETECTION_PARAMS, ...options.params };
    this.t = createTranslator(options.locale ?? 'en');
  }

  async run(): Promise<void> {
    try {
      applyTheme(this.options.mount, this.options.theme);
      this.overlay = buildOverlay(this.options.mount, this.t);
      this.overlay.cancelButton.addEventListener('click', () => this.cancel());
      this.overlay.manualButton.addEventListener('click', () => {
        void this.capture(this.lastQuadProcessed);
      });
      this.setState('initializing');

      this.camera = new CameraController();
      const [, cv] = await Promise.all([
        this.camera.open(this.overlay.video, {
          facingMode: this.options.cameraFacing ?? 'environment',
        }),
        loadOpenCv({ scriptUrl: this.options.opencvScriptUrl }),
      ]);
      if (this.finished) return; // cancelled while starting up
      this.cv = cv;

      const video = this.overlay.video;
      this.overlay.canvas.width = video.videoWidth;
      this.overlay.canvas.height = video.videoHeight;

      const scale = Math.min(
        1,
        this.params.processingMaxDim / Math.max(video.videoWidth, video.videoHeight),
      );
      this.processedWidth = Math.round(video.videoWidth * scale);
      this.processedHeight = Math.round(video.videoHeight * scale);
      this.procCanvas = document.createElement('canvas');
      this.procCanvas.width = this.processedWidth;
      this.procCanvas.height = this.processedHeight;

      this.tracker = new StabilityTracker({
        frameWidth: this.processedWidth,
        frameHeight: this.processedHeight,
        windowSize: this.params.stabilityWindow,
        minStableFrames: this.params.minStableFrames,
        maxCornerDriftFrac: this.params.maxCornerDriftFrac,
      });

      this.setState('searching');
      // Manual fallback button appears early — auto-capture only fires on a
      // properly aligned document quad, so give the user a quick manual
      // escape hatch if the quad does not lock.
      this.manualTimer = setTimeout(() => {
        if (!this.finished && this.overlay) this.overlay.manualButton.style.display = '';
      }, this.params.manualFallbackMs);

      // Frame budget: at most targetFps frames/second; the `busy` flag
      // drops (never queues) frames while one is still processing.
      this.loopTimer = setInterval(() => this.tick(), 1000 / this.params.targetFps);
    } catch (e) {
      this.fail(e);
    }
  }

  private setState(state: CaptureState): void {
    this.state = state;
    const messageKey = STATE_MESSAGE_KEY[state];
    if (this.overlay) this.overlay.chip.textContent = this.t(messageKey);
    this.options.onState?.(state, { messageKey });
  }

  private tick(): void {
    if (this.busy || this.finished) return;
    const overlay = this.overlay;
    const cv = this.cv;
    const tracker = this.tracker;
    const procCanvas = this.procCanvas;
    if (!overlay || !cv || !tracker || !procCanvas) return;
    this.busy = true;
    try {
      const video = overlay.video;
      if (video.videoWidth === 0) return;
      const pctx = procCanvas.getContext('2d', { willReadFrequently: true });
      if (!pctx) return;
      pctx.drawImage(video, 0, 0, this.processedWidth, this.processedHeight);
      const imageData = pctx.getImageData(0, 0, this.processedWidth, this.processedHeight);

      const spec = DOCUMENT_SPECS[this.options.documentType];
      const guide = computeGuideRect(
        this.processedWidth,
        this.processedHeight,
        spec.aspect,
        this.params.guideWidthFrac,
      );
      const detection = detectQuad(cv, imageData, spec.aspect, guide, this.params);
      try {
        tracker.push(detection.quad);
        if (detection.quad) {
          // Auto-capture fires ONLY on a properly accepted document quad —
          // right shape, size, centered, stable and sharp. No heuristic
          // "guide looks busy" fallback: a real room is full of
          // rectangular furniture that would trip it. The manual button
          // (shown early) is the fallback when the quad never locks.
          this.lastQuadProcessed = detection.quad;
          const bbox = quadBoundingBox(
            detection.quad,
            detection.processedWidth,
            detection.processedHeight,
          );
          const sharpness = laplacianVariance(cv, detection.gray, bbox);
          this.ring.push({ quad: detection.quad, sharpness });
          if (this.ring.length > this.params.ringBufferSize) this.ring.shift();

          const bestSharpness = Math.max(...this.ring.map((r) => r.sharpness));
          if (tracker.triggered && bestSharpness >= this.params.minSharpness) {
            void this.capture(detection.quad); // auto-capture (step 11)
            return;
          }
          this.setState(
            tracker.triggered && bestSharpness < this.params.minSharpness
              ? 'tooBlurry'
              : 'holdStill',
          );
        } else {
          switch (detection.reason) {
            case 'moveCloser':
              this.setState('moveCloser');
              break;
            case 'alignCard':
              this.setState('alignCard');
              break;
            default:
              this.setState('searching');
          }
        }
        this.draw(guide, detection.quad);
      } finally {
        detection.gray.delete();
      }
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = false;
    }
  }

  /** Draw the overlay in native-video coordinates. */
  private draw(guideProcessed: GuideRect, quadProcessed: Quad | null): void {
    const overlay = this.overlay;
    if (!overlay) return;
    const scaleUp = overlay.video.videoWidth / this.processedWidth;
    const guide: GuideRect = {
      x: guideProcessed.x * scaleUp,
      y: guideProcessed.y * scaleUp,
      width: guideProcessed.width * scaleUp,
      height: guideProcessed.height * scaleUp,
    };
    const quad = quadProcessed
      ? (quadProcessed.map((p) => ({ x: p.x * scaleUp, y: p.y * scaleUp })) as Quad)
      : null;
    drawDocumentOverlay(
      overlay.canvas,
      this.options.mount,
      guide,
      quad,
      STATE_TONE[this.state],
      DOCUMENT_SPECS[this.options.documentType].layout,
    );
    overlay.progressBar.style.width = `${Math.round((this.tracker?.progress ?? 0) * 100)}%`;
  }

  /**
   * Capture + upload. `quadProcessed` null (manual capture with no quad
   * ever seen) falls back to cropping the guide region.
   */
  private async capture(quadProcessed: Quad | null): Promise<void> {
    if (this.finished) return;
    const overlay = this.overlay;
    const cv = this.cv;
    if (!overlay || !cv) return;
    this.stopLoop();
    this.setState('capturing');
    this.playShutter();
    try {
      const video = overlay.video;
      const spec = DOCUMENT_SPECS[this.options.documentType];
      // Step 11 (web): draw the current video frame at native resolution.
      const full = document.createElement('canvas');
      full.width = video.videoWidth;
      full.height = video.videoHeight;
      const fctx = full.getContext('2d');
      if (!fctx) throw new EkycError('Could not create capture canvas');
      fctx.drawImage(video, 0, 0);

      let blob: Blob;
      if (quadProcessed) {
        const scaleUp = video.videoWidth / this.processedWidth;
        const corners = quadProcessed.map((p) => ({
          x: p.x * scaleUp,
          y: p.y * scaleUp,
        })) as Quad;
        const imageData = fctx.getImageData(0, 0, full.width, full.height);
        const mat: CvMat = cv.matFromImageData(imageData);
        try {
          blob = await warpToJpegBlob(cv, mat, corners, spec.warpWidth, spec.warpHeight);
        } finally {
          mat.delete();
        }
      } else {
        // Manual capture without any detected quad: crop the guide region.
        const scaleUp = video.videoWidth / this.processedWidth;
        const guide = computeGuideRect(
          this.processedWidth,
          this.processedHeight,
          spec.aspect,
          this.params.guideWidthFrac,
        );
        const crop = document.createElement('canvas');
        crop.width = Math.round(guide.width * scaleUp);
        crop.height = Math.round(guide.height * scaleUp);
        const cctx = crop.getContext('2d');
        if (!cctx) throw new EkycError('Could not create crop canvas');
        cctx.drawImage(
          full,
          guide.x * scaleUp,
          guide.y * scaleUp,
          guide.width * scaleUp,
          guide.height * scaleUp,
          0,
          0,
          crop.width,
          crop.height,
        );
        blob = await new Promise<Blob>((res, rej) =>
          crop.toBlob(
            (b) => (b ? res(b) : rej(new EkycError('JPEG encoding failed'))),
            'image/jpeg',
            JPEG_QUALITY,
          ),
        );
      }

      if (blob.size >= MAX_UPLOAD_BYTES) {
        throw new FileTooLargeError('Captured image exceeds the 10 MB upload limit');
      }

      // Freeze the exact image being uploaded over the live video, so the
      // user sees what was captured while it uploads.
      this.showFreeze(blob);
      this.setState('uploading');
      // NOTE: if this request fails it is NOT retried (billable request,
      // docs/API_CONTRACTS.md). The host app may start a fresh capture.
      const result = await this.api.submitDocument(this.options.documentType, blob);
      result.capturedImage = blob;
      this.setState('done');
      this.finish();
      this.resolve(result);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Camera-shutter flash: snap to opaque white, then fade out. */
  private playShutter(): void {
    const flash = this.overlay?.flash;
    if (!flash) return;
    flash.style.transition = 'none';
    flash.style.opacity = '0.85';
    // Force a reflow so the opacity:0 transition actually animates.
    void flash.offsetWidth;
    flash.style.transition = 'opacity 320ms ease-out';
    flash.style.opacity = '0';
  }

  /** Show the captured JPEG frozen over the video during upload. */
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
    this.setState('error');
    if (this.overlay && e instanceof EkycError) {
      this.overlay.chip.textContent = this.t(e.userMessageKey);
    }
    this.finish();
    this.reject(e);
  }

  private stopLoop(): void {
    if (this.loopTimer !== null) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
    if (this.manualTimer !== null) {
      clearTimeout(this.manualTimer);
      this.manualTimer = null;
    }
  }

  /** Clean DOM/camera/timer teardown. Safe to call multiple times. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stopLoop();
    this.camera?.stop();
    this.camera = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.tracker = null;
    this.ring = [];
    this.procCanvas = null;
    this.cv = null;
    if (this.freezeUrl) {
      URL.revokeObjectURL(this.freezeUrl);
      this.freezeUrl = null;
    }
  }
}
