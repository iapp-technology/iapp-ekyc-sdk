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
import {
  anglesOk,
  aspectAccepted,
  aspectRatio,
  centroid,
  orderCorners,
  quadArea,
  type Point,
  type Quad,
} from './geometry';

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
  /** Dilate kernel size (step 5). */
  dilateKernelSize: number;
  /** Top-N contours by area to examine (step 6). */
  maxContourCandidates: number;
  /** approxPolyDP epsilon = this x arcLength (step 7). */
  approxEpsilonFrac: number;
  /** Contour area >= this fraction of processed-frame area (step 7). */
  minFrameAreaFrac: number;
  /** Contour area >= this fraction of the guide-rect area (step 7). */
  minGuideAreaFrac: number;
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
   * Assisted fallback: if no quad has been accepted after this many ms,
   * auto-capture fires from the GUIDE REGION alone once it is sharp and
   * stable — fingers over the card edge routinely break contour-based
   * quad detection, and users should not need the manual button for that.
   */
  assistedFallbackMs: number;
  /** Consecutive sharp+stable guide frames required in assisted mode. */
  assistedStableFrames: number;
  /** Max mean abs pixel diff (0-255) between guide crops to count stable. */
  assistedMaxMeanDiff: number;
  /**
   * Aspect window for the `cardLike` signal — a landscape rectangle. Wide
   * enough for ID-1 (1.586) and passport (1.42) with slack, tight enough
   * to exclude a near-square/portrait face outline.
   */
  cardLikeAspectMin: number;
  cardLikeAspectMax: number;
}

export const DEFAULT_DETECTION_PARAMS: DetectionParams = {
  processingMaxDim: 480,
  gaussianKernelSize: 5,
  cannyClampMin: 30,
  cannyClampMax: 200,
  cannyLowerFactor: 0.66,
  cannyUpperFactor: 1.33,
  dilateKernelSize: 3,
  maxContourCandidates: 5,
  approxEpsilonFrac: 0.02,
  minFrameAreaFrac: 0.08,
  minGuideAreaFrac: 0.5,
  borderMarginPx: 8,
  aspectTolerance: 0.25,
  guideAreaMinFrac: 0.6,
  // 1.3: users naturally overfill the guide a little; 1.15 rejected that.
  guideAreaMaxFrac: 1.3,
  // Handheld reality: a card held in front of a webcam always tremors a
  // few px and acceptance flickers between direct/hull corners, so the
  // trigger is 4-of-6 frames with 3.5% drift — ~0.5 s of a normal hold.
  stabilityWindow: 6,
  minStableFrames: 4,
  maxCornerDriftFrac: 0.035,
  // Webcams are soft; the ring buffer still submits the SHARPEST frame,
  // and 60 comfortably rejects genuine motion blur.
  minSharpness: 60,
  ringBufferSize: 5,
  manualFallbackMs: 10_000,
  targetFps: 10,
  guideWidthFrac: 0.8,
  assistedFallbackMs: 3_000,
  assistedStableFrames: 4,
  assistedMaxMeanDiff: 10,
  cardLikeAspectMin: 1.25,
  cardLikeAspectMax: 2.4,
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
  const frameArea = width * height;
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

  // Step 5: dilate 3x3 rect kernel, 1 iteration.
  const kernel = cv.getStructuringElement(
    cv.MORPH_RECT,
    new cv.Size(params.dilateKernelSize, params.dilateKernelSize),
  );
  const dilated = new cv.Mat();
  cv.dilate(edges, dilated, kernel);
  edges.delete();
  kernel.delete();

  // Step 6: external contours, sorted by area desc, top N.
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  dilated.delete();
  hierarchy.delete();

  const indexed: Array<{ index: number; area: number }> = [];
  for (let i = 0; i < contours.size(); i++) {
    indexed.push({ index: i, area: cv.contourArea(contours.get(i)) });
  }
  indexed.sort((a, b) => b.area - a.area);
  const candidates = indexed.slice(0, params.maxContourCandidates);

  let accepted: Quad | null = null;
  let reason: RejectReason = 'noQuad';
  let cardLike = false;

  // Step 7: polygon approximation with epsilon = 0.02 x arcLength.
  // Returns 4 convex points or null.
  const fourPointApprox = (shape: InstanceType<typeof cv.Mat>): Point[] | null => {
    const peri = cv.arcLength(shape, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(shape, approx, params.approxEpsilonFrac * peri, true);
    try {
      if (approx.rows !== 4 || !cv.isContourConvex(approx)) return null;
      const pts: Point[] = [];
      const data = approx.data32S;
      for (let i = 0; i < 4; i++) pts.push({ x: data[i * 2], y: data[i * 2 + 1] });
      return pts;
    } finally {
      approx.delete();
    }
  };

  for (const { index } of candidates) {
    const contour = contours.get(index);
    let pts = fourPointApprox(contour);
    if (!pts) {
      // Fingers holding a card break its outline into >4 vertices; the
      // convex hull smooths those intrusions back into a quadrilateral.
      const hull = new cv.Mat();
      cv.convexHull(contour, hull, false, true);
      pts = fourPointApprox(hull);
      hull.delete();
    }

    {
      if (!pts) continue;
      const quad = orderCorners(pts);

      // Interior angles within [60, 120].
      if (!anglesOk(quad)) continue;

      const area = quadArea(quad);
      // Area >= 8% of the processed frame.
      if (area < params.minFrameAreaFrac * frameArea) continue;

      // All corners >= borderMarginPx inside the processed frame border.
      const inBorder = quad.every(
        (p) =>
          p.x >= params.borderMarginPx &&
          p.y >= params.borderMarginPx &&
          p.x <= width - params.borderMarginPx &&
          p.y <= height - params.borderMarginPx,
      );
      if (!inBorder) continue;

      // From here on the candidate LOOKS like a document, so failures
      // produce actionable UX reasons instead of silent rejection.
      const aspect = aspectRatio(quad);
      // "Card-like present": a substantial (>= 50% of guide) rectangle
      // with a landscape aspect. Faces/heads never yield a large 4-point
      // convex landscape quad, so assisted capture gates on this instead
      // of raw pixel motion (a still face was passing the motion gate).
      if (
        area >= params.minGuideAreaFrac * guideArea &&
        aspect >= params.cardLikeAspectMin &&
        aspect <= params.cardLikeAspectMax
      ) {
        cardLike = true;
      }

      if (area < params.minGuideAreaFrac * guideArea) {
        reason = 'moveCloser'; // step 7 area floor vs guide
        continue;
      }
      if (area < params.guideAreaMinFrac * guideArea) {
        reason = 'moveCloser'; // step 8: < 60% of guide area
        continue;
      }

      const c = centroid(quad);
      const centroidInGuide =
        c.x >= guideRect.x &&
        c.x <= guideRect.x + guideRect.width &&
        c.y >= guideRect.y &&
        c.y <= guideRect.y + guideRect.height;
      if (
        !aspectAccepted(aspect, targetAspect, params.aspectTolerance) ||
        !centroidInGuide ||
        area > params.guideAreaMaxFrac * guideArea
      ) {
        reason = 'alignCard'; // step 8: aspect / centroid / oversize failure
        continue;
      }

      accepted = quad;
      break;
    }
  }
  contours.delete();

  return {
    quad: accepted,
    reason: accepted ? null : reason,
    cardLike: accepted !== null || cardLike,
    gray,
    scaleBack,
    processedWidth: width,
    processedHeight: height,
  };
}
