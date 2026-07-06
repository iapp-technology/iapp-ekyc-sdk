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
  aspectAccepted,
  aspectRatio,
  centroid,
  quadArea,
  type Point,
  type Quad,
} from './geometry';

/**
 * Fraction of sample points along each side of the quad that sit on (or
 * within ~2 px of) an edge pixel in the closed edge map; returns the MINIMUM
 * across the 4 sides. A real document boundary is a straight physical edge
 * supported on every side; a head/torso hull leaves its chords unsupported.
 */
function minEdgeSupport(closedEdges: CvMat, quad: Quad): number[] {
  const { cols, rows } = closedEdges;
  const data = closedEdges.data;
  const SAMPLES = 24;
  const supports: number[] = [];
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    let hit = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i + 0.5) / SAMPLES;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      let found = false;
      for (let dy = -2; dy <= 2 && !found; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= cols) continue;
          if (data[yy * cols + xx] !== 0) {
            found = true;
            break;
          }
        }
      }
      if (found) hit += 1;
    }
    supports.push(hit / SAMPLES);
  }
  supports.sort((a, b) => a - b);
  return supports;
}

/**
 * A quad "has document edges" when EITHER at most one side is weak
 * (second-lowest support >= minSupport) OR at least two sides are STRONGLY
 * supported (>= 0.5) — a held document routinely has fingers over one edge
 * AND glare washing another, but always 2+ crisp physical edges. A
 * head/torso hull almost never has even two straight supported chords.
 */
function hasDocumentEdges(closedEdges: CvMat, quad: Quad, minSupport: number): boolean {
  const supports = minEdgeSupport(closedEdges, quad);
  const secondLowest = supports[1];
  const strongSides = supports.filter((s) => s >= 0.5).length;
  return secondLowest >= minSupport || strongSides >= 2;
}

/**
 * Extract a document's 4 corners from a contour as the farthest point from
 * the contour centroid within each quadrant (jscanify, MIT — see NOTICE).
 * Returns corners already ordered TL, TR, BR, BL, or null if any quadrant
 * is empty (not a quadrilateral-ish blob).
 */
function extremeCornerQuad(contour: CvMat, clip?: GuideRect): Quad | null {
  const data = contour.data32S;
  const total = data.length / 2;
  if (total < 4) return null;
  // CLIP to the guide region (+margin): a document merged with the hand /
  // arm holding it becomes one giant blob whose extreme corners land in
  // the hand — but the part INSIDE the guide is just the document, so its
  // extreme corners are the document's corners. Everything outside the
  // clip box is ignored.
  const pts: Point[] = [];
  for (let i = 0; i < total; i++) {
    const x = data[i * 2];
    const y = data[i * 2 + 1];
    if (
      clip &&
      (x < clip.x || x > clip.x + clip.width || y < clip.y || y > clip.y + clip.height)
    ) {
      continue;
    }
    pts.push({ x, y });
  }
  const n = pts.length;
  if (n < 8) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += pts[i].x;
    cy += pts[i].y;
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
    const x = pts[i].x;
    const y = pts[i].y;
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
  /** cardLike quads must also be <= this fraction of the guide area. */
  cardLikeMaxGuideAreaFrac: number;
  /**
   * cardLike size floor (fraction of guide area) — lower than the main
   * acceptance floor so a passport DATA PAGE (~35% of the open-booklet
   * guide) still counts as a card in view.
   */
  cardLikeMinGuideAreaFrac: number;
  /**
   * Min per-side Canny-edge support for a cardLike quad (0..1). Documents
   * have straight supported boundaries; head/torso hulls do not.
   */
  cardLikeEdgeSupportMin: number;
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
  /**
   * Long-hold guarantee: occupied+stable+sharp for this many frames snaps
   * even without the card-shape gate (~3 s at 12 fps) — the engine's 420
   * resume makes a wrong snap cost nothing.
   */
  longHoldSnapFrames: number;
  /** Long-hold (and 'hold still' chip) require a cardLike sighting within
   *  this many frames (~2 s) — an empty frame never long-hold-snaps. */
  longHoldCardMemoryFrames: number;
  /**
   * ARMING: capture paths activate only after the guide content CHANGES by
   * at least this mean-abs-diff once (something ENTERED the frame). A
   * static empty scene — doorframes, cabinets, a seated user — never arms.
   */
  armMotionMeanDiff: number;
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
  // RETR_LIST yields inner+outer duplicates per boundary — examine more.
  maxContourCandidates: 12,
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
  // Loose geometry: the REAL discriminator is hasDocumentEdges (2 strong
  // straight sides) + the entry-arming in the capture flow. Held documents
  // merge with fingers and overfill the guide; bounds only exclude the
  // absurd.
  cardLikeAspectMin: 1.1,
  cardLikeAspectMax: 3.0,
  cardLikeMaxGuideAreaFrac: 2.0,
  cardLikeMinGuideAreaFrac: 0.3,
  // 0.32: blank documents (Thai ID BACK) have faint boundaries; the
  // face-guard holds because torso hulls score near zero on 2+ sides.
  cardLikeEdgeSupportMin: 0.32,
  // EMA smoothing: 0.45 damps jitter while still tracking real movement;
  // a >60px jump snaps to raw so fast repositions aren't laggy.
  cornerSmoothingAlpha: 0.45,
  cornerSmoothingResetPx: 60,
  // Easy occupancy snap: a text-filled card fills the guide with edges
  // (density well above 0.03); an empty wall stays near 0. Motion <= 14
  // mean-abs-diff tolerates a normal handheld wobble (OCR handles slight
  // motion; the freeze shows exactly what was sent); 3 such frames
  // (~0.25 s) fires capture. easyRun decays by 1 on a failing frame
  // instead of resetting (leaky accumulator, document-capture.ts).
  // 0.015: the Thai ID BACK is nearly blank — far fewer edge pixels than
  // a text-filled front — yet still well above an empty wall (<0.005).
  occupancyMinEdgeDensity: 0.015,
  easyMotionMaxMeanDiff: 14,
  easyStableFrames: 3,
  longHoldSnapFrames: 30,
  longHoldCardMemoryFrames: 24,
  armMotionMeanDiff: 25,
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

  // Step 6: ALL contours (RETR_LIST), largest first. RETR_EXTERNAL missed
  // the common real-world case: the hand gripping the document merges the
  // document+hand+arm into one giant external blob, and the document's own
  // crisp boundary (e.g. a passport data page) becomes an INTERIOR contour
  // that never surfaces as a candidate. `closed` stays alive for the
  // candidate loop's edge-support check and is deleted after it.
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  // CHAIN_APPROX_NONE: SIMPLE compresses straight edges to corner
  // VERTICES only, which breaks pointwise clipping (a segment crossing
  // the clip box can have both endpoints outside it). NONE keeps every
  // boundary pixel.
  cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
  hierarchy.delete();

  // Rank candidates by BOUNDING-BOX area, NOT cv.contourArea: a contour
  // that touches the image border (the arm holding the card always enters
  // from the frame edge!) is traced as a thin out-and-back band whose
  // SIGNED area cancels to ~0 — contourArea reported 3 for a card-spanning
  // structure, and a size floor on it silently discarded the only real
  // candidate. Bounding-box extent is immune to that.
  const indexed: Array<{ index: number; area: number }> = [];
  for (let i = 0; i < contours.size(); i++) {
    const d = contours.get(i).data32S;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < d.length; j += 2) {
      const x = d[j];
      const y = d[j + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    indexed.push({ index: i, area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY) });
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

  const candidateFloor = Math.min(params.minGuideAreaFrac, params.cardLikeMinGuideAreaFrac);
  // Contour points outside this box are ignored when extracting corners —
  // the hand/arm holding the document merges into its contour, but only
  // what is INSIDE the guide (+margin) defines the document's corners.
  const clipRect: GuideRect = {
    x: guideRect.x - marginX,
    y: guideRect.y - marginY,
    width: guideRect.width + 2 * marginX,
    height: guideRect.height + 2 * marginY,
  };
  for (const { index, area: contourArea } of indexed.slice(0, params.maxContourCandidates)) {
    if (contourArea < candidateFloor * guideArea) break; // sorted desc → rest smaller
    const quad = extremeCornerQuad(contours.get(index), clipRect);
    if (!quad) continue;

    const area = quadArea(quad);
    const aspect = aspectRatio(quad);
    // Orientation-agnostic card-like signal — a REQUIRED gate for the easy
    // snap (document-capture.ts): a card-sized rectangle IN THE GUIDE with
    // REAL STRAIGHT EDGES. The ratio window excludes near-round blobs; the
    // centroid + size bounds exclude background furniture; the edge-support
    // check kills head/torso hulls — a portrait guide (passport) matches
    // human torso geometry, but curved shoulders leave the quad's sides
    // without Canny-edge support, while a document boundary supports all 4.
    const ratio = aspect >= 1 ? aspect : 1 / aspect;
    const qc = centroid(quad);
    const cmx = guideRect.width * 0.15;
    const cmy = guideRect.height * 0.15;
    const centroidInGuideBox =
      qc.x >= guideRect.x - cmx &&
      qc.x <= guideRect.x + guideRect.width + cmx &&
      qc.y >= guideRect.y - cmy &&
      qc.y <= guideRect.y + guideRect.height + cmy;
    if (
      !cardLike &&
      centroidInGuideBox &&
      area >= params.cardLikeMinGuideAreaFrac * guideArea &&
      area <= params.cardLikeMaxGuideAreaFrac * guideArea &&
      ratio >= params.cardLikeAspectMin &&
      ratio <= params.cardLikeAspectMax &&
      hasDocumentEdges(closed, quad, params.cardLikeEdgeSupportMin)
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
  closed.delete();

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
