/**
 * Document quad detection — docs/ALGORITHM.md steps 1–8 on an OpenCV Mat.
 *
 * The caller supplies RGBA pixels (ImageData drawn from the <video> at
 * processing size); this module performs grayscale conversion, downscale,
 * blur, adaptive Canny, dilate, contour extraction and all quad acceptance
 * checks. All detection constants live in DEFAULT_DETECTION_PARAMS
 * (`DetectionParams`, mirrored by `DetectionConfig` in the Flutter SDK).
 */
import type { CV, CvMat, ImageDataLike } from '../core/opencv-loader';
import { aspectAccepted, aspectRatio, quadArea, type Point, type Quad } from './geometry';

/**
 * Extract a document's 4 corners from a contour as the farthest point from
 * the contour centroid within each quadrant (jscanify, MIT — see NOTICE).
 * Returns corners already ordered TL, TR, BR, BL, or null if any quadrant
 * is empty (not a quadrilateral-ish blob).
 */
function extremeCornerQuad(contour: CvMat): Quad | null {
  const data = contour.data32S;
  const n = data.length / 2;
  if (n < 4) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += data[i * 2];
    cy += data[i * 2 + 1];
  }
  cx /= n;
  cy /= n;

  let tl: Point | null = null;
  let tr: Point | null = null;
  let br: Point | null = null;
  let bl: Point | null = null;
  let dtl = -1;
  let dtr = -1;
  let dbr = -1;
  let dbl = -1;
  for (let i = 0; i < n; i++) {
    const x = data[i * 2];
    const y = data[i * 2 + 1];
    const dx = x - cx;
    const dy = y - cy;
    const d = dx * dx + dy * dy;
    if (dx <= 0 && dy <= 0) {
      if (d > dtl) {
        dtl = d;
        tl = { x, y };
      }
    } else if (dx > 0 && dy <= 0) {
      if (d > dtr) {
        dtr = d;
        tr = { x, y };
      }
    } else if (dx > 0 && dy > 0) {
      if (d > dbr) {
        dbr = d;
        br = { x, y };
      }
    } else if (d > dbl) {
      dbl = d;
      bl = { x, y };
    }
  }
  if (!tl || !tr || !br || !bl) return null;
  return [tl, tr, br, bl];
}

/** All pipeline constants (docs/ALGORITHM.md). One object per platform. */
export interface DetectionParams {
  /** Longest processed dimension (step 2). */
  processingMaxDim: number;
  /** Gaussian blur kernel size (step 3). */
  gaussianKernelSize: number;
  /** Adaptive Canny clamp range (step 4). */
  cannyClampMin: number;
  cannyClampMax: number;
  /** Canny thresholds = [lowerFactor, upperFactor] x median. */
  cannyLowerFactor: number;
  cannyUpperFactor: number;
  /** Morphological-close kernel size (step 5) — bridges card-edge gaps. */
  closeKernelSize: number;
  /** Top-N largest contours to examine (step 6). */
  maxContourCandidates: number;
  /** Contour area >= this fraction of the guide-rect area (step 7). */
  minGuideAreaFrac: number;
  /** Detected corners may sit this fraction of the guide beyond its edges. */
  guideCornerMarginFrac: number;
  /** Corners must be >= this many px inside the processed frame border. */
  borderMarginPx: number;
  /** Aspect tolerance vs the document target (step 8). */
  aspectTolerance: number;
  /** Quad area within [min, max] x guide area (step 8). */
  guideAreaMinFrac: number;
  guideAreaMaxFrac: number;
  /** Stability window (step 9). */
  stabilityWindow: number;
  minStableFrames: number;
  maxCornerDriftFrac: number;
  /** Laplacian-variance sharpness threshold (step 10). */
  minSharpness: number;
  /** Ring buffer of accepted frames (step 10). */
  ringBufferSize: number;
  /** Manual capture button appears after this many ms (UX section). */
  manualFallbackMs: number;
  /** Frame budget: process at most this many frames per second. */
  targetFps: number;
  /** Guide rect width as a fraction of the processed frame width. */
  guideWidthFrac: number;
  /**
   * Aspect window for the `cardLike` signal — a landscape rectangle. Wide
   * enough for ID-1 (1.586) and passport (1.42) with slack, tight enough
   * to exclude a near-square/portrait face outline.
   */
  cardLikeAspectMin: number;
  cardLikeAspectMax: number;
  /** EMA factor for corner smoothing (0..1; lower = steadier). */
  cornerSmoothingAlpha: number;
  /** Corner move beyond this many px snaps to raw (fast reposition). */
  cornerSmoothingResetPx: number;
  /**
   * "Easy" occupancy snap (web capture model). The guide is OCCUPIED by a
   * detailed object when the fraction of Canny-edge pixels inside the guide
   * rect (`guideEdgeDensity`) is >= this. A text-filled card gives a high
   * density; an empty wall is ~0. This lets auto-capture fire without the
   * fragile edge-contour quad being accepted.
   */
  occupancyMinEdgeDensity: number;
  /**
   * Easy snap: the mean absolute difference of the gray guide crop vs the
   * previous frame's crop must be <= this to count as motion-stable.
   */
  easyMotionMaxMeanDiff: number;
  /**
   * Easy snap: consecutive occupied + motion-stable + sharp frames required
   * before firing (~0.3 s at the default frame rate).
   */
  easyStableFrames: number;
}

export const DEFAULT_DETECTION_PARAMS: DetectionParams = {
  processingMaxDim: 480,
  gaussianKernelSize: 5,
  cannyClampMin: 30,
  cannyClampMax: 200,
  cannyLowerFactor: 0.66,
  cannyUpperFactor: 1.33,
  // 7: a wider close kernel bridges glare/low-contrast gaps in the card
  // border so it survives as one closed contour.
  closeKernelSize: 7,
  maxContourCandidates: 8,
  minGuideAreaFrac: 0.45,
  guideCornerMarginFrac: 0.12,
  borderMarginPx: 6,
  aspectTolerance: 0.3,
  guideAreaMinFrac: 0.5,
  // 1.35: users naturally overfill the guide a little.
  guideAreaMaxFrac: 1.35,
  // Corners are EMA-smoothed before this check, so hand tremor is damped
  // and the trigger is easy to reach: 2-of-4 frames at 9% drift (~0.2 s).
  stabilityWindow: 4,
  minStableFrames: 2,
  maxCornerDriftFrac: 0.09,
  // Webcams are soft; the ring buffer still submits the SHARPEST frame.
  minSharpness: 30,
  ringBufferSize: 6,
  // Auto-capture only fires on an aligned document quad; surface the manual
  // button quickly so a user is never stuck if the quad won't lock.
  manualFallbackMs: 4_000,
  targetFps: 12,
  guideWidthFrac: 0.8,
  cardLikeAspectMin: 1.25,
  cardLikeAspectMax: 2.4,
  // EMA smoothing: 0.45 damps jitter while still tracking real movement;
  // a >60px jump snaps to raw so fast repositions aren't laggy.
  cornerSmoothingAlpha: 0.45,
  cornerSmoothingResetPx: 60,
  // Easy occupancy snap: a text-filled card fills the guide with edges
  // (density well above 0.03); an empty wall stays near 0. Motion <= 8
  // mean-abs-diff is "held steady"; 4 such frames (~0.3 s) fires capture.
  occupancyMinEdgeDensity: 0.03,
  easyMotionMaxMeanDiff: 8,
  easyStableFrames: 4,
};

export interface GuideRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Why the best candidate was rejected — drives the UX state machine. */
export type RejectReason = 'noQuad' | 'moveCloser' | 'alignCard';

export interface QuadDetectionResult {
  /** Accepted quad (TL,TR,BR,BL) in PROCESSED-frame coordinates, or null. */
  quad: Quad | null;
  reason: RejectReason | null;
  /**
   * A substantial, roughly card-shaped rectangle was found this frame —
   * a 4-point convex contour (or hull) that filled a large part of the
   * guide with a landscape aspect, EVEN IF it was rejected for
   * aspect/centroid/oversize. This is the "a document-like object is
   * present" signal; a face or empty scene is never cardLike, so assisted
   * capture keys off it (not raw pixel motion).
   */
  cardLike: boolean;
  /**
   * Fraction (0..1) of Canny-edge pixels inside the guide rect this frame —
   * the "guide is occupied by a detailed object" signal. A text-filled card
   * scores high; an empty wall scores ~0. Drives the easy occupancy snap
   * (document-capture) independently of quad acceptance.
   */
  guideEdgeDensity: number;
  /**
   * Processed grayscale mat (post-downscale, pre-blur) for sharpness
   * scoring. THE CALLER MUST CALL `.delete()` on it.
   */
  gray: CvMat;
  /** Multiply processed coords by this to get source-image coords. */
  scaleBack: number;
  processedWidth: number;
  processedHeight: number;
}

/** Centered guide rect matching the document aspect (UX + step 8 checks). */
export function computeGuideRect(
  frameWidth: number,
  frameHeight: number,
  targetAspect: number,
  widthFrac: number = DEFAULT_DETECTION_PARAMS.guideWidthFrac,
): GuideRect {
  let gw = frameWidth * widthFrac;
  let gh = gw / targetAspect;
  const maxH = frameHeight * 0.8;
  if (gh > maxH) {
    gh = maxH;
    gw = gh * targetAspect;
  }
  return { x: (frameWidth - gw) / 2, y: (frameHeight - gh) / 2, width: gw, height: gh };
}

/** Median of an 8-bit grayscale image via its histogram. */
function grayscaleMedian(gray: CvMat): number {
  const hist = new Uint32Array(256);
  const data = gray.data;
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const half = data.length / 2;
  let cumulative = 0;
  for (let v = 0; v < 256; v++) {
    cumulative += hist[v];
    if (cumulative >= half) return v;
  }
  return 255;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Run detection steps 1–8 on one RGBA frame.
 *
 * @param cv          initialized OpenCV module (loadOpenCv()).
 * @param imageData   RGBA pixels; ideally already at processing size
 *                    (longest side <= params.processingMaxDim). Larger
 *                    inputs are downscaled here (step 2) and `scaleBack`
 *                    reports the processed -> source factor.
 * @param targetAspect 1.586 (ID-1) or 1.42 (passport).
 * @param guide       guide rect in PROCESSED coordinates; pass null to
 *                    derive a centered default from the aspect.
 */
export function detectQuad(
  cv: CV,
  imageData: ImageDataLike,
  targetAspect: number,
  guide: GuideRect | null = null,
  params: DetectionParams = DEFAULT_DETECTION_PARAMS,
): QuadDetectionResult {
  const rgba = cv.matFromImageData(imageData);
  let gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  rgba.delete();

  // Step 2: downscale so the longest dimension == processingMaxDim.
  let scaleBack = 1;
  const maxDim = Math.max(gray.cols, gray.rows);
  if (maxDim > params.processingMaxDim) {
    scaleBack = maxDim / params.processingMaxDim;
    const w = Math.round(gray.cols / scaleBack);
    const h = Math.round(gray.rows / scaleBack);
    const resized = new cv.Mat();
    cv.resize(gray, resized, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    gray.delete();
    gray = resized;
  }
  const width = gray.cols;
  const height = gray.rows;
  const guideRect = guide ?? computeGuideRect(width, height, targetAspect, params.guideWidthFrac);
  const guideArea = guideRect.width * guideRect.height;

  // Step 3: Gaussian blur (on a working copy; `gray` is returned for
  // sharpness scoring and must stay unblurred).
  const blurred = new cv.Mat();
  cv.GaussianBlur(
    gray,
    blurred,
    new cv.Size(params.gaussianKernelSize, params.gaussianKernelSize),
    0,
  );

  // Step 4: adaptive Canny from the grayscale median, clamped to [30, 200].
  const median = grayscaleMedian(blurred);
  const lower = clamp(params.cannyLowerFactor * median, params.cannyClampMin, params.cannyClampMax);
  const upper = clamp(params.cannyUpperFactor * median, params.cannyClampMin, params.cannyClampMax);
  const edges = new cv.Mat();
  cv.Canny(blurred, edges, lower, upper);
  blurred.delete();

  // Occupancy signal: fraction of Canny-edge pixels inside the guide rect
  // (computed on `edges` BEFORE it is consumed/deleted). meanStdDev of a
  // binary edge map is 255 * (edge fraction), so mean/255 = density.
  let guideEdgeDensity = 0;
  {
    const gx = clamp(Math.floor(guideRect.x), 0, Math.max(0, width - 1));
    const gy = clamp(Math.floor(guideRect.y), 0, Math.max(0, height - 1));
    const gw = clamp(Math.round(guideRect.width), 1, width - gx);
    const gh = clamp(Math.round(guideRect.height), 1, height - gy);
    const roi = edges.roi(new cv.Rect(gx, gy, gw, gh));
    const mean = new cv.Mat();
    const stddev = new cv.Mat();
    try {
      cv.meanStdDev(roi, mean, stddev);
      guideEdgeDensity = mean.data64F[0] / 255;
    } finally {
      roi.delete();
      mean.delete();
      stddev.delete();
    }
  }

  // Step 5: morphological CLOSE with a larger kernel to bridge gaps in the
  // card's edge (glare, low contrast, finger occlusion) so the border
  // survives as ONE closed contour — the key to robust detection.
  const kernel = cv.getStructuringElement(
    cv.MORPH_RECT,
    new cv.Size(params.closeKernelSize, params.closeKernelSize),
  );
  const closed = new cv.Mat();
  cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
  edges.delete();
  kernel.delete();

  // Step 6: external contours, largest first.
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  closed.delete();
  hierarchy.delete();

  const indexed: Array<{ index: number; area: number }> = [];
  for (let i = 0; i < contours.size(); i++) {
    indexed.push({ index: i, area: cv.contourArea(contours.get(i)) });
  }
  indexed.sort((a, b) => b.area - a.area);

  let accepted: Quad | null = null;
  let reason: RejectReason = 'noQuad';
  let cardLike = false;

  // Step 7 (jscanify approach, MIT — see NOTICE): the card is the largest
  // contour that fills the guide. Its 4 corners are the points farthest
  // from the contour's centroid in each quadrant — robust to rounded
  // corners, broken edges and fingers, unlike a strict approxPolyDP that
  // demands exactly 4 convex vertices.
  const marginX = guideRect.width * params.guideCornerMarginFrac;
  const marginY = guideRect.height * params.guideCornerMarginFrac;

  for (const { index, area: contourArea } of indexed.slice(0, params.maxContourCandidates)) {
    if (contourArea < params.minGuideAreaFrac * guideArea) break; // sorted desc → rest smaller
    const quad = extremeCornerQuad(contours.get(index));
    if (!quad) continue;

    const area = quadArea(quad);
    const aspect = aspectRatio(quad);
    // Orientation-agnostic card-like signal (UX hint only): a substantial
    // rectangle whose long/short ratio is landscape-ish. A near-round face
    // blob (ratio ~1) is excluded; a portrait passport (0.71 → 1.41) counts.
    const ratio = aspect >= 1 ? aspect : 1 / aspect;
    if (
      area >= params.minGuideAreaFrac * guideArea &&
      ratio >= params.cardLikeAspectMin &&
      ratio <= params.cardLikeAspectMax
    ) {
      cardLike = true;
    }

    // Corners must sit within the guide (+ margin) and inside the frame.
    const withinGuide = quad.every(
      (p) =>
        p.x >= guideRect.x - marginX &&
        p.x <= guideRect.x + guideRect.width + marginX &&
        p.y >= guideRect.y - marginY &&
        p.y <= guideRect.y + guideRect.height + marginY,
    );
    const inBorder = quad.every(
      (p) =>
        p.x >= params.borderMarginPx &&
        p.y >= params.borderMarginPx &&
        p.x <= width - params.borderMarginPx &&
        p.y <= height - params.borderMarginPx,
    );
    if (!withinGuide || !inBorder) {
      reason = 'alignCard';
      continue;
    }
    if (area < params.guideAreaMinFrac * guideArea) {
      reason = 'moveCloser';
      continue;
    }
    if (area > params.guideAreaMaxFrac * guideArea) {
      reason = 'alignCard';
      continue;
    }
    if (!aspectAccepted(aspect, targetAspect, params.aspectTolerance)) {
      reason = 'alignCard';
      continue;
    }
    accepted = quad;
    break;
  }
  contours.delete();

  return {
    quad: accepted,
    reason: accepted ? null : reason,
    cardLike: accepted !== null || cardLike,
    guideEdgeDensity,
    gray,
    scaleBack,
    processedWidth: width,
    processedHeight: height,
  };
}
