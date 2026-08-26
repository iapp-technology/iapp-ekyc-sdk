/**
 * Reduce MediaPipe FaceLandmarker output to the normalized FaceObservation
 * shape (docs/ACTIVE_LIVENESS.md) so the challenge state machine sees a
 * single sign convention across platforms.
 *
 * - Euler angles come from decomposing the 4x4 facialTransformationMatrix
 *   (rotation part), assuming R = Ry(yaw) . Rx(pitch) . Rz(roll):
 *     yaw   = atan2(r02, r22)
 *     pitch = asin(-r12)
 *     roll  = atan2(r10, r11)
 *   Sign convention (spec): yaw + = user turned to THEIR left,
 *   pitch + = looking up. Unit-tested against hand-built rotation matrices.
 * - eyeOpen = 1 - eyeBlink{Left,Right}; smile = max(mouthSmileLeft/Right)
 *   (max, not mean: natural smiles are often asymmetric and the mean
 *   under-reports them).
 * - `count` is NOT the raw detector output: see selectFaces() below.
 */
import type { FaceObservation } from './challenge-machine';

export interface EulerAngles {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

/** Structural subset of MediaPipe's FaceLandmarkerResult that we consume. */
export interface BlendshapeCategoryLike {
  categoryName: string;
  score: number;
}

export interface FaceLandmarkerResultLike {
  faceLandmarks: Array<Array<{ x: number; y: number; z: number }>>;
  faceBlendshapes: Array<{ categories: BlendshapeCategoryLike[] }>;
  facialTransformationMatrixes: Array<{
    rows: number;
    columns: number;
    data: ArrayLike<number>;
  }>;
}

const RAD2DEG = 180 / Math.PI;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Decompose the rotation part of a flattened 4x4 transformation matrix
 * into yaw/pitch/roll degrees (R = Ry . Rx . Rz).
 *
 * Layout: row-major is assumed. If the translation column indicates the
 * buffer is column-major (translation at indices 12..14 with zeros at
 * 3/7/11), the matrix is transposed first — MediaPipe builds have shipped
 * both layouts.
 */
export function eulerFromMatrix(data: ArrayLike<number>): EulerAngles {
  if (data.length < 16) throw new Error('eulerFromMatrix expects a 4x4 (16-value) matrix');
  // Heuristic layout detection via the translation slot.
  const rowMajorT = Math.abs(data[3]) + Math.abs(data[7]) + Math.abs(data[11]);
  const colMajorT = Math.abs(data[12]) + Math.abs(data[13]) + Math.abs(data[14]);
  const columnMajor = colMajorT > rowMajorT;

  const r = (row: number, col: number): number =>
    columnMajor ? data[col * 4 + row] : data[row * 4 + col];

  const r02 = r(0, 2);
  const r10 = r(1, 0);
  const r11 = r(1, 1);
  const r12 = r(1, 2);
  const r22 = r(2, 2);

  const pitchRad = Math.asin(clamp(-r12, -1, 1));
  const yawRad = Math.atan2(r02, r22);
  const rollRad = Math.atan2(r10, r11);

  return {
    yawDeg: yawRad * RAD2DEG,
    pitchDeg: pitchRad * RAD2DEG,
    rollDeg: rollRad * RAD2DEG,
  };
}

function blendshapeScore(
  categories: BlendshapeCategoryLike[] | undefined,
  name: string,
): number {
  if (!categories) return 0;
  for (const c of categories) {
    if (c.categoryName === name) return c.score;
  }
  return 0;
}

/** Face bounding box in normalized (0..1) frame coordinates. */
export interface FaceBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Tuning for turning the detector's face list into "how many PEOPLE are in
 * front of the camera".
 *
 * The landmarker runs with numFaces = 2 so a second person can be seen at
 * all, which means the underlying detector keeps scanning the frame for a
 * second face on every frame. On wide-FOV, high-resolution front cameras
 * (Galaxy S25 Ultra and similar) that scan regularly returns a phantom:
 * either the subject's own face boxed a second time, or a small face-like
 * pattern in the background. Left unfiltered, the phantom pins the UI on
 * "only one face may be in view" and the flow can never start.
 */
export interface FaceSelectionConfig {
  /** Secondary detections narrower than this fraction of the FRAME are noise. */
  minFaceWidthFrac: number;
  /** intersection / min(area) at or above this = the SAME face, twice. */
  duplicateOverlap: number;
  /** A real second subject is at least this fraction of the primary's width. */
  minSecondaryWidthRatio: number;
}

export const DEFAULT_FACE_SELECTION_CONFIG: FaceSelectionConfig = {
  minFaceWidthFrac: 0.06,
  duplicateOverlap: 0.3,
  minSecondaryWidthRatio: 0.4,
};

export interface FaceSelection {
  /** Index of the subject's face in the result, or -1 when there is none. */
  index: number;
  /** Bounding box of the subject's face (normalized), or null. */
  box: FaceBox | null;
  /** People in frame: the subject plus every surviving second face. */
  count: number;
  /** Faces the detector reported, before filtering (diagnostics only). */
  rawCount: number;
  /**
   * Landmark sets discarded as numerically impossible (see
   * `isPlausiblyNormalized`). `rejected > 0 && count === 0` means the
   * detector is running but its output is unusable — the caller should
   * rebuild it on another delegate rather than show the user a hint they
   * cannot act on.
   */
  rejected: number;
}

/**
 * MediaPipe landmarks are normalized to the frame: 0..1, give or take a
 * little overshoot for a face at the very edge. A Galaxy S25 Ultra in the
 * field (Aug 2026) returned coordinates around 1e12 — the model was
 * running but its output was numerically garbage, which fed a face box of
 * width 1.37e12 straight into the centring check and pinned the flow on
 * "position your face inside the oval" forever.
 *
 * Bounds are deliberately generous: reject the impossible, not the merely
 * off-frame.
 */
const MIN_PLAUSIBLE_COORD = -1;
const MAX_PLAUSIBLE_COORD = 2;
const MAX_PLAUSIBLE_SIZE = 2;

function isPlausiblyNormalized(box: FaceBox): boolean {
  return (
    box.minX >= MIN_PLAUSIBLE_COORD &&
    box.minY >= MIN_PLAUSIBLE_COORD &&
    box.maxX <= MAX_PLAUSIBLE_COORD &&
    box.maxY <= MAX_PLAUSIBLE_COORD &&
    box.maxX - box.minX <= MAX_PLAUSIBLE_SIZE &&
    box.maxY - box.minY <= MAX_PLAUSIBLE_SIZE
  );
}

/** Normalized bounding box of one landmark set; null if degenerate. */
function boundingBoxOf(
  landmarks: Array<{ x: number; y: number }> | undefined,
): FaceBox | null {
  if (!landmarks || landmarks.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of landmarks) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/** intersection area / smaller box area (0..1). Nest-aware, unlike IoU. */
function overlapRatio(a: FaceBox, b: FaceBox): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (w <= 0 || h <= 0) return 0;
  const areaA = (a.maxX - a.minX) * (a.maxY - a.minY);
  const areaB = (b.maxX - b.minX) * (b.maxY - b.minY);
  const smaller = Math.min(areaA, areaB);
  return smaller > 0 ? (w * h) / smaller : 0;
}

/**
 * Pick the subject's face (the largest — the person holding the phone) and
 * count how many OTHER faces are genuinely a second person: big enough to
 * matter, and not just the subject's own face detected a second time.
 *
 * Dropping a detection only ever makes the flow more permissive on the
 * "one face" rule; it never affects the server-side verdict, which is the
 * only proof of liveness (docs/SECURITY.md).
 */
export function selectFaces(
  result: FaceLandmarkerResultLike,
  config: Partial<FaceSelectionConfig> = {},
): FaceSelection {
  const cfg = { ...DEFAULT_FACE_SELECTION_CONFIG, ...config };
  const faces = result.faceLandmarks ?? [];
  const boxes: Array<{ index: number; box: FaceBox; width: number; area: number }> = [];
  let rejected = 0;
  for (let i = 0; i < faces.length; i++) {
    const box = boundingBoxOf(faces[i]);
    if (!box) {
      rejected += 1;
      continue;
    }
    if (!isPlausiblyNormalized(box)) {
      rejected += 1;
      continue;
    }
    const width = box.maxX - box.minX;
    boxes.push({ index: i, box, width, area: width * (box.maxY - box.minY) });
  }
  if (boxes.length === 0) {
    return { index: -1, box: null, count: 0, rawCount: faces.length, rejected };
  }

  let primary = boxes[0];
  for (const b of boxes) if (b.area > primary.area) primary = b;

  let count = 1;
  for (const b of boxes) {
    if (b === primary) continue;
    if (b.width < cfg.minFaceWidthFrac) continue; // detector noise
    if (b.width < primary.width * cfg.minSecondaryWidthRatio) continue; // far background
    if (overlapRatio(b.box, primary.box) >= cfg.duplicateOverlap) continue; // same face twice
    count += 1;
  }
  return { index: primary.index, box: primary.box, count, rawCount: faces.length, rejected };
}

export interface MapObservationOptions {
  frameWidth: number;
  frameHeight: number;
  /** Oval guide center in NORMALIZED (0..1) frame coordinates. Default center. */
  ovalCenterX?: number;
  ovalCenterY?: number;
  /** Reuse a selection already computed for this frame. */
  selection?: FaceSelection;
  /** Face-filter tuning. Ignored when `selection` is supplied. */
  faceSelection?: Partial<FaceSelectionConfig>;
}

const EMPTY_OBSERVATION: FaceObservation = {
  count: 0,
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  leftEyeOpen: 0,
  rightEyeOpen: 0,
  smile: 0,
  faceWidthFrac: 0,
  centerOffsetFrac: 1,
  rawFaceCount: 0,
};

/**
 * Bounding box of the SUBJECT's face (the largest one), in normalized
 * coordinates. Pass a selection to avoid recomputing it.
 */
export function faceBoundingBox(
  result: FaceLandmarkerResultLike,
  selection?: FaceSelection,
): FaceBox | null {
  return (selection ?? selectFaces(result)).box;
}

/** Map one FaceLandmarker result to a FaceObservation. */
export function mapObservation(
  result: FaceLandmarkerResultLike,
  options: MapObservationOptions,
): FaceObservation {
  const selection = options.selection ?? selectFaces(result, options.faceSelection);
  const bbox = selection.box;
  if (selection.index < 0 || !bbox) {
    return { ...EMPTY_OBSERVATION, rawFaceCount: selection.rawCount };
  }

  const faceWidthFrac = bbox.maxX - bbox.minX;
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const ox = options.ovalCenterX ?? 0.5;
  const oy = options.ovalCenterY ?? 0.5;
  // Spec: distance normalized by FRAME WIDTH. Landmark coords are
  // width/height-normalized, so rescale dy by height/width.
  const aspect = options.frameHeight / options.frameWidth;
  const centerOffsetFrac = Math.hypot(cx - ox, (cy - oy) * aspect);

  let yawDeg = 0;
  let pitchDeg = 0;
  let rollDeg = 0;
  // Blendshapes and the transformation matrix are indexed in lockstep with
  // faceLandmarks, so every per-face read uses the SUBJECT's index — never
  // slot 0, which a phantom detection can occupy.
  // Optional chaining on the ARRAYS, not just the element: a detector that
  // returns landmarks without blendshapes or matrices would otherwise throw
  // here on every frame, and an exception inside the render loop freezes the
  // UI on its last message with no error surfaced to the host app.
  const matrix = result.facialTransformationMatrixes?.[selection.index];
  if (matrix && matrix.data.length >= 16) {
    const euler = eulerFromMatrix(matrix.data);
    yawDeg = euler.yawDeg;
    pitchDeg = euler.pitchDeg;
    rollDeg = euler.rollDeg;
  }

  const categories = result.faceBlendshapes?.[selection.index]?.categories;
  const leftEyeOpen = 1 - blendshapeScore(categories, 'eyeBlinkLeft');
  const rightEyeOpen = 1 - blendshapeScore(categories, 'eyeBlinkRight');
  const smile = Math.max(
    blendshapeScore(categories, 'mouthSmileLeft'),
    blendshapeScore(categories, 'mouthSmileRight'),
  );

  return {
    count: selection.count,
    yawDeg,
    pitchDeg,
    rollDeg,
    leftEyeOpen,
    rightEyeOpen,
    smile,
    faceWidthFrac,
    centerOffsetFrac,
    rawFaceCount: selection.rawCount,
  };
}
