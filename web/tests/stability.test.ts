/**
 * StabilityTracker against the SHARED test vectors
 * (tests/fixtures/vectors/stability.json — identical file in Flutter).
 * Covers docs/ALGORITHM.md step 9 incl. the "first accepted frame is not
 * stable" rule.
 */
import { describe, expect, it } from 'vitest';
import type { Quad } from '../src/vision/geometry';
import { StabilityTracker } from '../src/vision/stability-tracker';
import stability from './fixtures/vectors/stability.json';

const toQuad = (pairs: number[][]): Quad =>
  pairs.map(([x, y]) => ({ x, y })) as Quad;

describe('StabilityTracker (vectors: stability.json)', () => {
  for (const testCase of stability.cases) {
    it(testCase.name, () => {
      const tracker = new StabilityTracker({
        frameWidth: stability.frameWidth,
        frameHeight: stability.frameHeight,
      });
      for (const frame of testCase.frames) {
        tracker.push(frame === null ? null : toQuad(frame));
      }
      expect(tracker.triggered).toBe(testCase.expectedTrigger);
    });
  }

  it('first accepted frame alone is never stable', () => {
    const tracker = new StabilityTracker({ frameWidth: 480, frameHeight: 360 });
    const quad = toQuad([
      [100, 100],
      [380, 100],
      [380, 260],
      [100, 260],
    ]);
    tracker.push(quad);
    expect(tracker.stableCount).toBe(0);
    expect(tracker.triggered).toBe(false);
  });

  it('reset clears the latch and the window', () => {
    const tracker = new StabilityTracker({ frameWidth: 480, frameHeight: 360 });
    const quad = toQuad([
      [100, 100],
      [380, 100],
      [380, 260],
      [100, 260],
    ]);
    for (let i = 0; i < 10; i++) tracker.push(quad);
    expect(tracker.triggered).toBe(true);
    tracker.reset();
    expect(tracker.triggered).toBe(false);
    expect(tracker.stableCount).toBe(0);
  });
});
