/**
 * face-metrics: Euler decomposition against hand-built rotation matrices
 * (pure yaw 20 deg, pure pitch 10 deg, identity) and blendshape mapping
 * per docs/ACTIVE_LIVENESS.md.
 */
import { describe, expect, it } from 'vitest';
import {
  eulerFromMatrix,
  mapObservation,
  selectFaces,
  type FaceLandmarkerResultLike,
} from '../src/active-liveness/face-metrics';

const DEG = Math.PI / 180;

/** Row-major 4x4 from a row-major 3x3 rotation. */
function mat4(r: number[][]): number[] {
  return [
    r[0][0], r[0][1], r[0][2], 0,
    r[1][0], r[1][1], r[1][2], 0,
    r[2][0], r[2][1], r[2][2], 0,
    0, 0, 0, 1,
  ];
}

const rotY = (deg: number) => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
};

const rotX = (deg: number) => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
};

const rotZ = (deg: number) => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
};

const matMul = (a: number[][], b: number[][]) =>
  a.map((row, i) =>
    row.map((_, j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]),
  );

describe('eulerFromMatrix', () => {
  it('identity -> all zeros', () => {
    const euler = eulerFromMatrix(mat4([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]));
    expect(euler.yawDeg).toBeCloseTo(0, 5);
    expect(euler.pitchDeg).toBeCloseTo(0, 5);
    expect(euler.rollDeg).toBeCloseTo(0, 5);
  });

  it('pure yaw 20 deg', () => {
    const euler = eulerFromMatrix(mat4(rotY(20)));
    expect(euler.yawDeg).toBeCloseTo(20, 4);
    expect(euler.pitchDeg).toBeCloseTo(0, 4);
    expect(euler.rollDeg).toBeCloseTo(0, 4);
  });

  it('pure pitch 10 deg', () => {
    const euler = eulerFromMatrix(mat4(rotX(10)));
    expect(euler.yawDeg).toBeCloseTo(0, 4);
    expect(euler.pitchDeg).toBeCloseTo(10, 4);
    expect(euler.rollDeg).toBeCloseTo(0, 4);
  });

  it('pure roll 15 deg', () => {
    const euler = eulerFromMatrix(mat4(rotZ(15)));
    expect(euler.rollDeg).toBeCloseTo(15, 4);
    expect(euler.yawDeg).toBeCloseTo(0, 4);
    expect(euler.pitchDeg).toBeCloseTo(0, 4);
  });

  it('composed Ry(20)·Rx(10)·Rz(5) decomposes back exactly', () => {
    const R = matMul(matMul(rotY(20), rotX(10)), rotZ(5));
    const euler = eulerFromMatrix(mat4(R));
    expect(euler.yawDeg).toBeCloseTo(20, 3);
    expect(euler.pitchDeg).toBeCloseTo(10, 3);
    expect(euler.rollDeg).toBeCloseTo(5, 3);
  });

  it('accepts a column-major buffer (translation-slot heuristic)', () => {
    const rowMajor = mat4(rotY(20));
    // Transpose 4x4 and put a translation in the column-major slot.
    const colMajor = new Array<number>(16);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) colMajor[j * 4 + i] = rowMajor[i * 4 + j];
    colMajor[12] = 1.5; // tx
    colMajor[13] = -2.0; // ty
    colMajor[14] = -30.0; // tz
    const euler = eulerFromMatrix(colMajor);
    expect(euler.yawDeg).toBeCloseTo(20, 4);
  });
});

function fakeResult(overrides: Partial<FaceLandmarkerResultLike> = {}): FaceLandmarkerResultLike {
  const landmarks = [
    { x: 0.3, y: 0.3, z: 0 },
    { x: 0.7, y: 0.3, z: 0 },
    { x: 0.7, y: 0.8, z: 0 },
    { x: 0.3, y: 0.8, z: 0 },
  ];
  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [
      {
        categories: [
          { categoryName: 'eyeBlinkLeft', score: 0.1 },
          { categoryName: 'eyeBlinkRight', score: 0.2 },
          { categoryName: 'mouthSmileLeft', score: 0.6 },
          { categoryName: 'mouthSmileRight', score: 0.8 },
        ],
      },
    ],
    facialTransformationMatrixes: [
      { rows: 4, columns: 4, data: mat4(rotY(20)) },
    ],
    ...overrides,
  };
}

describe('mapObservation', () => {
  const opts = { frameWidth: 640, frameHeight: 480 };

  it('maps blendshapes: eyeOpen = 1 - blink, smile = max(L, R)', () => {
    const obs = mapObservation(fakeResult(), opts);
    expect(obs.count).toBe(1);
    expect(obs.leftEyeOpen).toBeCloseTo(0.9, 6);
    expect(obs.rightEyeOpen).toBeCloseTo(0.8, 6);
    expect(obs.smile).toBeCloseTo(0.8, 6);
    expect(obs.yawDeg).toBeCloseTo(20, 3);
  });

  it('computes faceWidthFrac from the landmark bbox', () => {
    const obs = mapObservation(fakeResult(), opts);
    expect(obs.faceWidthFrac).toBeCloseTo(0.4, 6); // 0.7 - 0.3
  });

  it('centerOffsetFrac is 0 for a face centered on the oval center', () => {
    // bbox center = (0.5, 0.55).
    const obs = mapObservation(fakeResult(), {
      ...opts,
      ovalCenterX: 0.5,
      ovalCenterY: 0.55,
    });
    expect(obs.centerOffsetFrac).toBeCloseTo(0, 6);
  });

  it('normalizes the vertical offset by frame WIDTH per the spec', () => {
    // Face center y = 0.55; oval at y = 0.35 -> dy = 0.2 in height units
    // = 0.2 * (480/640) = 0.15 in width units.
    const obs = mapObservation(fakeResult(), {
      ...opts,
      ovalCenterX: 0.5,
      ovalCenterY: 0.35,
    });
    expect(obs.centerOffsetFrac).toBeCloseTo(0.15, 6);
  });

  it('returns a zeroed observation when no face is present', () => {
    const obs = mapObservation(
      fakeResult({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] }),
      opts,
    );
    expect(obs.count).toBe(0);
    expect(obs.faceWidthFrac).toBe(0);
    expect(obs.leftEyeOpen).toBe(0);
  });

  it('tolerates a result with no blendshapes or matrices', () => {
    // A detector returning landmarks but neither auxiliary array used to
    // throw on every frame, freezing the flow with no error.
    const base = fakeResult();
    const obs = mapObservation(
      { faceLandmarks: base.faceLandmarks } as unknown as FaceLandmarkerResultLike,
      opts,
    );
    expect(obs.count).toBe(1);
    expect(obs.yawDeg).toBe(0);
    expect(obs.leftEyeOpen).toBe(1);
    expect(obs.faceWidthFrac).toBeCloseTo(0.4, 6);
  });

  it('reports count for multi-face frames', () => {
    const base = fakeResult();
    const obs = mapObservation(
      { ...base, faceLandmarks: [base.faceLandmarks[0], secondPerson()] },
      opts,
    );
    expect(obs.count).toBe(2);
  });

  it('reads blendshapes and pose from the SUBJECT, not from slot 0', () => {
    // A phantom detection landed in slot 0; the real (larger) face is
    // second, and so are its blendshapes / transformation matrix.
    const base = fakeResult();
    const obs = mapObservation(
      {
        faceLandmarks: [box(0.05, 0.05, 0.15, 0.2), base.faceLandmarks[0]],
        faceBlendshapes: [{ categories: [{ categoryName: 'eyeBlinkLeft', score: 0.9 }] },
          base.faceBlendshapes[0]],
        facialTransformationMatrixes: [
          { rows: 4, columns: 4, data: mat4(rotY(-40)) },
          base.facialTransformationMatrixes[0],
        ],
      },
      opts,
    );
    expect(obs.count).toBe(1);
    expect(obs.leftEyeOpen).toBeCloseTo(0.9, 6); // the subject's, not 0.1
    expect(obs.yawDeg).toBeCloseTo(20, 3);
    expect(obs.faceWidthFrac).toBeCloseTo(0.4, 6);
  });
});

/** Axis-aligned rectangle of landmarks (the bbox is all selectFaces reads). */
function box(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    { x: minX, y: minY, z: 0 },
    { x: maxX, y: minY, z: 0 },
    { x: maxX, y: maxY, z: 0 },
    { x: minX, y: maxY, z: 0 },
  ];
}

/** A genuine second person: comparable size, no overlap with the subject. */
function secondPerson() {
  return box(0.75, 0.3, 0.98, 0.72); // width 0.23 vs the subject's 0.4
}

/**
 * Regression cover for the Galaxy S25 Ultra report (Aug 2026): a phantom
 * second detection pinned the flow on "only one face may be in view".
 */
describe('selectFaces', () => {
  const withFaces = (faces: Array<Array<{ x: number; y: number; z: number }>>) =>
    ({ faceLandmarks: faces, faceBlendshapes: [], facialTransformationMatrixes: [] }) as
      unknown as FaceLandmarkerResultLike;

  it('no faces -> count 0, index -1', () => {
    const sel = selectFaces(withFaces([]));
    expect(sel).toEqual({ index: -1, box: null, count: 0, rawCount: 0, rejected: 0 });
  });

  it('rejects landmark sets that are not normalized to the frame', () => {
    // Verbatim from a Galaxy S25 Ultra field report (Aug 2026): the model
    // ran and returned two "faces", with coordinates around 1e12. Feeding
    // that box to the centring check produced an offset of 2.2e11 against a
    // 0.12 threshold, pinning the flow on "position your face inside the
    // oval" with no error and no callback.
    const junk = box(-606609145856, -277947580416, 767892127744, 511785238528);
    const junk2 = box(-402275532800, -121554010112, 181751250944, 178385174528);
    const sel = selectFaces(withFaces([junk, junk2]));
    expect(sel.count).toBe(0);
    expect(sel.index).toBe(-1);
    expect(sel.rawCount).toBe(2);
    expect(sel.rejected).toBe(2);
  });

  it('a real face alongside an impossible one still works', () => {
    const junk = box(-606609145856, -277947580416, 767892127744, 511785238528);
    const sel = selectFaces(withFaces([junk, box(0.3, 0.3, 0.7, 0.8)]));
    expect(sel.count).toBe(1);
    expect(sel.index).toBe(1);
    expect(sel.rejected).toBe(1);
  });

  it('tolerates the small overshoot of a face at the frame edge', () => {
    const sel = selectFaces(withFaces([box(-0.05, -0.02, 0.42, 0.6)]));
    expect(sel.count).toBe(1);
    expect(sel.rejected).toBe(0);
  });

  it('the same face detected twice counts once', () => {
    const sel = selectFaces(withFaces([box(0.3, 0.3, 0.7, 0.8), box(0.32, 0.28, 0.69, 0.79)]));
    expect(sel.count).toBe(1);
    expect(sel.rawCount).toBe(2);
  });

  it('a ghost nested inside the subject counts once', () => {
    const sel = selectFaces(withFaces([box(0.3, 0.3, 0.7, 0.8), box(0.4, 0.4, 0.6, 0.65)]));
    expect(sel.count).toBe(1);
  });

  it('a small background face does not block the flow', () => {
    const sel = selectFaces(withFaces([box(0.3, 0.3, 0.7, 0.8), box(0.02, 0.1, 0.12, 0.24)]));
    expect(sel.count).toBe(1);
  });

  it('a genuine second person still counts', () => {
    const sel = selectFaces(withFaces([box(0.3, 0.3, 0.7, 0.8), secondPerson()]));
    expect(sel.count).toBe(2);
    expect(sel.rawCount).toBe(2);
  });

  it('the subject is the LARGEST face, whatever its slot', () => {
    const sel = selectFaces(withFaces([secondPerson(), box(0.3, 0.3, 0.7, 0.8)]));
    expect(sel.index).toBe(1);
    expect(sel.box?.minX).toBeCloseTo(0.3, 6);
  });

  it('an unusable frame is distinguishable from an empty one', () => {
    // rejected > 0 && count === 0 is the signal the flow acts on to rebuild
    // the detector on the CPU delegate.
    const junk = selectFaces(withFaces([box(-6e11, -2e11, 7e11, 5e11)]));
    expect(junk.count).toBe(0);
    expect(junk.rejected).toBeGreaterThan(0);
    const empty = selectFaces(withFaces([]));
    expect(empty.count).toBe(0);
    expect(empty.rejected).toBe(0);
  });

  it('degenerate landmark sets (zero area / NaN) are dropped', () => {
    const nan = [{ x: NaN, y: 0.2, z: 0 }, { x: 0.5, y: 0.5, z: 0 }];
    const flat = box(0.4, 0.4, 0.4, 0.9);
    const sel = selectFaces(withFaces([box(0.3, 0.3, 0.7, 0.8), nan, flat]));
    expect(sel.count).toBe(1);
    expect(sel.rawCount).toBe(3);
  });

  it('thresholds are overridable (strict mode keeps every detection)', () => {
    const strict = { duplicateOverlap: 1.1, minSecondaryWidthRatio: 0, minFaceWidthFrac: 0 };
    const sel = selectFaces(withFaces([box(0.3, 0.3, 0.7, 0.8), box(0.4, 0.4, 0.6, 0.65)]), strict);
    expect(sel.count).toBe(2);
  });
});
