/**
 * Loader delegate handling. The recovery path in active-liveness.ts reloads
 * with `delegate: 'CPU'` after the default (GPU-first) landmarker returns
 * unusable output — so the loader must NOT hand back the cached broken
 * instance for that call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const created: Array<Record<string, unknown>> = [];

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  FaceLandmarker: {
    createFromOptions: async (_fs: unknown, options: Record<string, unknown>) => {
      created.push(options);
      return { id: created.length, options, detectForVideo: () => ({}), close: () => {} };
    },
  },
}));

import {
  loadFaceLandmarker,
  resetFaceLandmarkerLoaderForTests,
} from '../src/active-liveness/mediapipe-loader';

const delegateOf = (o: Record<string, unknown>) =>
  (o.baseOptions as { delegate: string }).delegate;

describe('loadFaceLandmarker', () => {
  beforeEach(() => {
    created.length = 0;
    resetFaceLandmarkerLoaderForTests();
  });

  it('defaults to the GPU delegate and caches the instance', async () => {
    const a = await loadFaceLandmarker();
    const b = await loadFaceLandmarker();
    expect(a).toBe(b);
    expect(created).toHaveLength(1);
    expect(delegateOf(created[0])).toBe('GPU');
  });

  it('a CPU reload returns a NEW instance, not the cached GPU one', async () => {
    const gpu = await loadFaceLandmarker();
    const cpu = await loadFaceLandmarker({ delegate: 'CPU' });
    expect(cpu).not.toBe(gpu);
    expect(created).toHaveLength(2);
    expect(delegateOf(created[1])).toBe('CPU');
  });

  it('CPU reloads are themselves cached', async () => {
    const first = await loadFaceLandmarker({ delegate: 'CPU' });
    const second = await loadFaceLandmarker({ delegate: 'CPU' });
    expect(first).toBe(second);
    expect(created).toHaveLength(1);
  });

  it('a pinned delegate does not fall back to the other one', async () => {
    await loadFaceLandmarker({ delegate: 'CPU' });
    expect(created.map(delegateOf)).toEqual(['CPU']);
  });

  it('__iappEkycSimulateBrokenGpu corrupts GPU output, leaves CPU real', async () => {
    (globalThis as { __iappEkycSimulateBrokenGpu?: boolean }).__iappEkycSimulateBrokenGpu = true;
    try {
      const gpu = await loadFaceLandmarker();
      const out = gpu.detectForVideo(null as unknown as HTMLVideoElement, 0) as {
        faceLandmarks: Array<Array<{ x: number }>>;
      };
      expect(out.faceLandmarks).toHaveLength(2);
      expect(Math.abs(out.faceLandmarks[0][0].x)).toBeGreaterThan(1e11);
      const cpu = await loadFaceLandmarker({ delegate: 'CPU' });
      const real = cpu.detectForVideo(null as unknown as HTMLVideoElement, 0) as Record<
        string,
        unknown
      >;
      expect(real.faceLandmarks).toBeUndefined(); // the stub's passthrough result
    } finally {
      delete (globalThis as { __iappEkycSimulateBrokenGpu?: boolean }).__iappEkycSimulateBrokenGpu;
    }
  });

  it('hook modes: throw and empty', async () => {
    const g = globalThis as { __iappEkycSimulateBrokenGpu?: boolean | string };
    try {
      g.__iappEkycSimulateBrokenGpu = 'throw';
      const throwing = await loadFaceLandmarker();
      expect(() => throwing.detectForVideo(null as unknown as HTMLVideoElement, 0)).toThrow();
      resetFaceLandmarkerLoaderForTests();
      g.__iappEkycSimulateBrokenGpu = 'empty';
      const empty = await loadFaceLandmarker();
      const out = empty.detectForVideo(null as unknown as HTMLVideoElement, 0) as {
        faceLandmarks: unknown[];
      };
      expect(out.faceLandmarks).toHaveLength(0);
    } finally {
      delete g.__iappEkycSimulateBrokenGpu;
    }
  });

  it('tracks 2 faces so a second person can be seen', async () => {
    await loadFaceLandmarker();
    expect(created[0].numFaces).toBe(2);
  });
});
