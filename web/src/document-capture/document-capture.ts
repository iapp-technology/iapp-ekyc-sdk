/**
 * Document auto-capture flow (docs/ALGORITHM.md).
 *
 * start() builds the camera UI inside `mount`, runs the detection loop
 * (frames are DROPPED, never queued, while a previous frame is being
 * processed), and AUTO-CAPTURES using the easy occupancy snap: the guide
 * being occupied by a detailed object (`guideEdgeDensity`) + motion-stable
 * + sharp, held for ~0.3 s — NOT dependent on the fragile edge-contour quad
 * being accepted (docs/ALGORITHM.md capture section). It then perspective-
 * corrects (using the accepted quad if present, else the guide crop),
 * uploads, and resolves with the OCR result.
 *
 * UX states: searching → holdStill (occupied + sharp, accumulating) →
 * tooBlurry (occupied, soft) → capturing → uploading → done | error. A
 * manual capture button appears after `manualFallbackMs` as a safety net.
 */
import { EkycApiClient } from '../core/api-client';
import { CameraController } from '../core/camera';
import { CancelledError, EkycError, FileTooLargeError } from '../core/errors';
import { createTranslator, type Locale, type Translator } from '../core/i18n/i18n';
import { applyTheme, type EkycTheme } from '../core/theme';
import { loadOpenCv, type CV, type CvMat } from '../core/opencv-loader';
import type { DocumentResult } from '../core/types';
import { laplacianVariance } from '../vision/blur-score';
import type { Quad } from '../vision/geometry';
import { MAX_UPLOAD_BYTES, JPEG_QUALITY } from '../vision/perspective';
import {
  computeGuideRect,
  DEFAULT_DETECTION_PARAMS,
  detectQuad,
  type DetectionParams,
  type GuideRect,
} from '../vision/quad-detector';
import { DOCUMENT_SPECS, type DocumentType } from './document-types';
import { buildOverlay, drawDocumentOverlay, type GuideTone, type OverlayElements } from './overlay';

export type CaptureState =
  | 'initializing'
  | 'searching'
  | 'holdStill'
  | 'tooBlurry'
  | 'moveCloser'
  | 'alignCard'
  | 'noDocument'
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
  noDocument: 'no_document_found',
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
  noDocument: 'warning',
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
  private procCanvas: HTMLCanvasElement | null = null;
  private busy = false;
  private finished = false;
  private state: CaptureState = 'initializing';
  private lastQuadProcessed: Quad | null = null;
  private processedWidth = 0;
  private processedHeight = 0;
  private freezeUrl: string | null = null;
  private smoothedQuad: Quad | null = null;
  /** Consecutive occupied + motion-stable + sharp frames (easy snap). */
  private easyRun = 0;
  /** cardLike flags for the last 4 frames (snap needs >=2). */
  private cardLikeWindow: boolean[] = [];
  /** Occupied+stable+sharp frames regardless of card-shape (long hold). */
  private gateFreeRun = 0;
  /** Frames since a cardLike sighting (large = no card in view). */
  private framesSinceCardLike = 10_000;
  /** True once something visibly entered the guide (arming event). */
  private armed = false;
  /** Auto-snaps rejected by the engine with HTTP 420 (no document). */
  private noDocRetries = 0;
  /** Previous frame's gray guide crop, for the motion-stability check. */
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

      this.setState('searching');
      // Manual fallback button appears early as a safety net; with the easy
      // occupancy snap auto-capture should fire within ~0.3 s of a held
      // card, but this guarantees the user is never stuck.
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
    const procCanvas = this.procCanvas;
    if (!overlay || !cv || !procCanvas) return;
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
        // EASY OCCUPANCY SNAP (docs/ALGORITHM.md capture section). The snap
        // no longer depends on the fragile edge-contour quad being accepted:
        // it fires when the guide is OCCUPIED by a detailed object (high
        // Canny-edge density — a text-filled card, never an empty wall), the
        // frame is MOTION-STABLE (small guide-crop diff), and SHARP. The
        // user is cooperatively presenting a card, so the guide crop already
        // contains the whole card; an accepted quad, when present, only
        // improves the crop (perspective-corrected).
        // CAPTURE MODEL: arm -> sight -> stabilize -> snap.
        // 1. ARM: something must visibly ENTER the guide (one big frame
        //    change). A static scene — doorframes, cabinets, a seated user
        //    — never arms, which is the structural no-card protection.
        // 2. SIGHT: a document-shaped quad with straight supported edges
        //    (cardLike) seen recently. Geometry is loose; the edge-support
        //    rule is the face/torso guard.
        // 3. STABILIZE + SNAP: fast path when sightings are consistent
        //    (~0.4 s); long-hold path guarantees a snap within ~2.5 s of a
        //    steady hold even when sighting flickers. Per-frame quality
        //    signals (edge density, sharpness) are HINTS only — a blank
        //    Thai ID back defeats both.
        const guideCrop = this.extractGuideCrop(cv, detection.gray, guide);
        const sharp = laplacianVariance(cv, guideCrop) >= this.params.minSharpness;
        const motion = this.guideMotionMeanDiff(cv, guideCrop); // takes ownership
        const motionStable = motion !== null && motion <= this.params.easyMotionMaxMeanDiff;
        if (motion !== null && motion >= this.params.armMotionMeanDiff) this.armed = true;

        this.cardLikeWindow.push(detection.cardLike);
        if (this.cardLikeWindow.length > 8) this.cardLikeWindow.shift();
        const cardHits = this.cardLikeWindow.filter(Boolean).length;
        this.framesSinceCardLike = detection.cardLike ? 0 : this.framesSinceCardLike + 1;
        const cardMemory =
          this.armed && this.framesSinceCardLike <= this.params.longHoldCardMemoryFrames;

        if (!cardMemory) {
          // No card around: hard reset so stale residue can never cause an
          // instant snap the moment a card enters.
          this.easyRun = 0;
          this.gateFreeRun = 0;
        } else {
          // Fast path: consistent sightings + steady hold (leaky decay).
          if (motionStable && cardHits >= 2) this.easyRun += 1;
          else this.easyRun = Math.max(0, this.easyRun - 1);
          // Long-hold guarantee: steady hold with a card in memory.
          if (motionStable) this.gateFreeRun += 1;
          else this.gateFreeRun = Math.max(0, this.gateFreeRun - 2);
        }

        // Keep the drawn quad + quality crop: EMA-smooth accepted corners,
        // reset the smoother on a rejected frame so re-acquisition is fresh.
        const smoothed = detection.quad ? this.smoothQuad(detection.quad) : null;
        if (!detection.quad) this.smoothedQuad = null;
        if (smoothed) this.lastQuadProcessed = smoothed;

        if (
          this.easyRun >= this.params.easyStableFrames + 2 ||
          this.gateFreeRun >= this.params.longHoldSnapFrames
        ) {
          void this.capture(smoothed, { auto: true });
          return;
        }

        this.setState(!cardMemory ? 'searching' : !sharp ? 'tooBlurry' : 'holdStill');
        this.draw(guide, smoothed);
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
   * Clone the gray guide-region crop (processed coords) from `gray`. The
   * clone is standalone (the caller's `gray` is deleted after the frame).
   */
  private extractGuideCrop(cv: CV, gray: CvMat, guide: GuideRect): CvMat {
    const gx = Math.max(0, Math.min(gray.cols - 1, Math.floor(guide.x)));
    const gy = Math.max(0, Math.min(gray.rows - 1, Math.floor(guide.y)));
    const gw = Math.max(1, Math.min(gray.cols - gx, Math.round(guide.width)));
    const gh = Math.max(1, Math.min(gray.rows - gy, Math.round(guide.height)));
    const roi = gray.roi(new cv.Rect(gx, gy, gw, gh));
    try {
      return roi.clone();
    } finally {
      roi.delete();
    }
  }

  /**
   * Mean-abs-diff of `guideCrop` vs the previous frame's crop, or null on
   * the first frame / a size change. TAKES OWNERSHIP of `guideCrop`: the
   * old prevGuideCrop is deleted and `guideCrop` becomes the new one.
   */
  private guideMotionMeanDiff(cv: CV, guideCrop: CvMat): number | null {
    const prev = this.prevGuideCrop;
    let motion: number | null = null;
    if (prev && prev.rows === guideCrop.rows && prev.cols === guideCrop.cols) {
      const diff = new cv.Mat();
      const mean = new cv.Mat();
      const stddev = new cv.Mat();
      try {
        cv.absdiff(guideCrop, prev, diff);
        cv.meanStdDev(diff, mean, stddev);
        motion = mean.data64F[0];
      } finally {
        diff.delete();
        mean.delete();
        stddev.delete();
      }
    }
    if (prev) prev.delete();
    this.prevGuideCrop = guideCrop;
    return motion;
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
    const progress = Math.min(1, this.easyRun / Math.max(1, this.params.easyStableFrames));
    overlay.progressBar.style.width = `${Math.round(progress * 100)}%`;
  }

  /**
   * Capture + upload. `quadProcessed` null (manual capture with no quad
   * ever seen) falls back to cropping the guide region.
   */
  private async capture(
    quadProcessed: Quad | null,
    opts: { auto?: boolean } = {},
  ): Promise<void> {
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

      // NO perspective warp: warping between detected corners DISTORTS the
      // image whenever the corners are even slightly off the card's true
      // corners (hand, glare, smoothing lag) — users reported skewed
      // captures. The user positions the card in the guide, so the plain
      // guide-region crop is a clean undistorted photo, and the OCR engine
      // handles natural perspective itself (0.98 detection on real tests).
      // `quadProcessed` is intentionally unused here; the quad only serves
      // detection gating and the on-screen overlay.
      void quadProcessed;
      let blob: Blob;
      {
        const scaleUp = video.videoWidth / this.processedWidth;
        const guide = computeGuideRect(
          this.processedWidth,
          this.processedHeight,
          spec.aspect,
          this.params.guideWidthFrac,
        );
        // Some documents submit only a sub-region of the guide (passport:
        // the data page — the lower half of the open booklet).
        const region = spec.submitRegion ?? { x: 0, y: 0, w: 1, h: 1 };
        const src = {
          x: (guide.x + region.x * guide.width) * scaleUp,
          y: (guide.y + region.y * guide.height) * scaleUp,
          width: guide.width * region.w * scaleUp,
          height: guide.height * region.h * scaleUp,
        };
        const crop = document.createElement('canvas');
        crop.width = Math.round(src.width);
        crop.height = Math.round(src.height);
        const cctx = crop.getContext('2d');
        if (!cctx) throw new EkycError('Could not create crop canvas');
        cctx.drawImage(
          full,
          src.x,
          src.y,
          src.width,
          src.height,
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
      // HTTP 420 = the OCR engine found no document in the image. For an
      // AUTO snap that means our local gates fired on a non-document scene
      // — resume scanning instead of failing the whole session. 4xx
      // responses are never billed, so the retry costs nothing.
      if (
        opts.auto &&
        e instanceof EkycError &&
        e.statusCode === 420 &&
        this.noDocRetries < 2 &&
        !this.finished
      ) {
        this.noDocRetries += 1;
        this.resumeAfterNoDocument();
        return;
      }
      this.fail(e);
    }
  }

  /** Hide the freeze, reset the snap gates and restart the scan loop. */
  private resumeAfterNoDocument(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.freeze.style.display = 'none';
    this.easyRun = 0;
    this.gateFreeRun = 0;
    this.framesSinceCardLike = 10_000;
    this.cardLikeWindow = [];
    this.smoothedQuad = null;
    this.setState('noDocument');
    // Brief pause so the user reads the message, then scan again.
    setTimeout(() => {
      if (this.finished || this.loopTimer !== null) return;
      this.loopTimer = setInterval(() => this.tick(), 1000 / this.params.targetFps);
    }, 1200);
  }

  /**
   * Exponential moving average of the corner positions. Snaps to the raw
   * quad if the jump is large (fast reposition) so the guide tracks quick
   * moves, but damps small frame-to-frame jitter otherwise.
   */
  private smoothQuad(raw: Quad): Quad {
    const prev = this.smoothedQuad;
    if (!prev) {
      this.smoothedQuad = raw;
      return raw;
    }
    const a = this.params.cornerSmoothingAlpha;
    const jumpPx = this.params.cornerSmoothingResetPx;
    const next = raw.map((p, i) => {
      const dx = p.x - prev[i].x;
      const dy = p.y - prev[i].y;
      if (Math.hypot(dx, dy) > jumpPx) return p; // big move → snap
      return { x: prev[i].x + dx * a, y: prev[i].y + dy * a };
    }) as Quad;
    this.smoothedQuad = next;
    return next;
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
    this.procCanvas = null;
    this.easyRun = 0;
    if (this.prevGuideCrop) {
      this.prevGuideCrop.delete();
      this.prevGuideCrop = null;
    }
    this.cv = null;
    this.smoothedQuad = null;
    if (this.freezeUrl) {
      URL.revokeObjectURL(this.freezeUrl);
      this.freezeUrl = null;
    }
  }
}
