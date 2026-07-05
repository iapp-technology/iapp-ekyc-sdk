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
  private captureStartMs = 0;
  private assistedRun = 0;
  private prevGuideCrop: CvMat | null = null;

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
      this.captureStartMs = Date.now();
      // Manual fallback: show the button after 10 s without auto-capture.
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
          this.resetAssisted();
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
          const assisted =
            Date.now() - this.captureStartMs >= this.params.assistedFallbackMs
              ? this.assistedTick(cv, detection.gray, guide)
              : 'inactive';
          if (assisted === 'captured') return;
          if (assisted === 'inactive') {
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
          // 'active': assistedTick already set the holdStill/tooBlurry chip.
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

  /**
   * Assisted fallback (no quad accepted for assistedFallbackMs): fingers
   * over the card edge routinely break contour-based quad detection, so
   * once the GUIDE REGION itself is sharp and motion-stable for
   * assistedStableFrames consecutive frames, capture the guide crop —
   * same path as the manual button, but automatic.
   * Returns 'captured' when capture fired, 'active' when accumulating
   * (state chip already set), 'inactive' never (kept for call-site shape).
   */
  private assistedTick(cv: CV, gray: CvMat, guide: GuideRect): 'captured' | 'active' | 'inactive' {
    const rect = new cv.Rect(
      Math.max(0, Math.round(guide.x)),
      Math.max(0, Math.round(guide.y)),
      Math.min(Math.round(guide.width), this.processedWidth - Math.round(guide.x)),
      Math.min(Math.round(guide.height), this.processedHeight - Math.round(guide.y)),
    );
    const view = gray.roi(rect);
    const crop = view.clone();
    view.delete();

    let stable = false;
    if (this.prevGuideCrop) {
      const diff = new cv.Mat();
      cv.absdiff(this.prevGuideCrop, crop, diff);
      const mean = new cv.Mat();
      const stddev = new cv.Mat();
      cv.meanStdDev(diff, mean, stddev);
      stable = mean.data64F[0] <= this.params.assistedMaxMeanDiff;
      diff.delete();
      mean.delete();
      stddev.delete();
      this.prevGuideCrop.delete();
    }
    this.prevGuideCrop = crop;

    const sharpness = laplacianVariance(cv, gray, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    const sharp = sharpness >= this.params.minSharpness;

    this.assistedRun = stable && sharp ? this.assistedRun + 1 : 0;
    if (this.assistedRun >= this.params.assistedStableFrames) {
      void this.capture(null); // guide-crop capture, same as manual
      return 'captured';
    }
    this.setState(sharp ? 'holdStill' : 'tooBlurry');
    return 'active';
  }

  private resetAssisted(): void {
    this.assistedRun = 0;
    if (this.prevGuideCrop) {
      this.prevGuideCrop.delete();
      this.prevGuideCrop = null;
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
    drawDocumentOverlay(overlay.canvas, this.options.mount, guide, quad, STATE_TONE[this.state]);
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
    this.resetAssisted();
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
  }
}
