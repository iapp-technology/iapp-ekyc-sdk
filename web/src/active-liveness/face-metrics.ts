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
 * - eyeOpen = 1 - eyeBlink{Left,Right}; smile = mean(mouthSmileLeft/Right).
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

export interface MapObservationOptions {
  frameWidth: number;
  frameHeight: number;
  /** Oval guide center in NORMALIZED (0..1) frame coordinates. Default center. */
  ovalCenterX?: number;
  ovalCenterY?: number;
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
};

/** Normalized-landmark bounding box of face 0 (all coords 0..1). */
export function faceBoundingBox(
  result: FaceLandmarkerResultLike,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const landmarks = result.faceLandmarks[0];
  if (!landmarks || landmarks.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Map one FaceLandmarker result to a FaceObservation. */
export function mapObservation(
  result: FaceLandmarkerResultLike,
  options: MapObservationOptions,
): FaceObservation {
  const count = result.faceLandmarks.length;
  if (count === 0) return { ...EMPTY_OBSERVATION };

  const bbox = faceBoundingBox(result);
  if (!bbox) return { ...EMPTY_OBSERVATION };

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
  const matrix = result.facialTransformationMatrixes[0];
  if (matrix && matrix.data.length >= 16) {
    const euler = eulerFromMatrix(matrix.data);
    yawDeg = euler.yawDeg;
    pitchDeg = euler.pitchDeg;
    rollDeg = euler.rollDeg;
  }

  const categories = result.faceBlendshapes[0]?.categories;
  const leftEyeOpen = 1 - blendshapeScore(categories, 'eyeBlinkLeft');
  const rightEyeOpen = 1 - blendshapeScore(categories, 'eyeBlinkRight');
  const smile =
    (blendshapeScore(categories, 'mouthSmileLeft') +
      blendshapeScore(categories, 'mouthSmileRight')) /
    2;

  return {
    count,
    yawDeg,
    pitchDeg,
    rollDeg,
    leftEyeOpen,
    rightEyeOpen,
    smile,
    faceWidthFrac,
    centerOffsetFrac,
  };
}
