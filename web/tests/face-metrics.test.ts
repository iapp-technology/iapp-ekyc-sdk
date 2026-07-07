/**
 * face-metrics: Euler decomposition against hand-built rotation matrices
 * (pure yaw 20 deg, pure pitch 10 deg, identity) and blendshape mapping
 * per docs/ACTIVE_LIVENESS.md.
 */
import { describe, expect, it } from 'vitest';
import {
  eulerFromMatrix,
  mapObservation,
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

  it('reports count for multi-face frames', () => {
    const base = fakeResult();
    const obs = mapObservation(
      { ...base, faceLandmarks: [base.faceLandmarks[0], base.faceLandmarks[0]] },
      opts,
    );
    expect(obs.count).toBe(2);
  });
});
