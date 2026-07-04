/**
 * Geometry against the SHARED test vectors (identical files live in
 * flutter/test/fixtures/vectors/). Do not edit the vectors here.
 */
import { describe, expect, it } from 'vitest';
import {
  anglesOk,
  aspectRatio,
  orderCorners,
  quadShapeAccepted,
  ASPECT_ID1,
  ASPECT_PASSPORT,
  type Point,
  type Quad,
} from '../src/vision/geometry';
import cornerOrdering from './fixtures/vectors/corner_ordering.json';
import quadChecks from './fixtures/vectors/quad_checks.json';

const toPoints = (pairs: number[][]): Point[] => pairs.map(([x, y]) => ({ x, y }));
const toQuad = (pairs: number[][]): Quad => toPoints(pairs) as Quad;

describe('orderCorners (vectors: corner_ordering.json)', () => {
  for (const testCase of cornerOrdering.cases) {
    it(testCase.name, () => {
      const ordered = orderCorners(toPoints(testCase.input));
      const actual = ordered.map((p) => [p.x, p.y]);
      expect(actual).toEqual(testCase.expected);
    });
  }
});

describe('quad shape checks (vectors: quad_checks.json)', () => {
  for (const testCase of quadChecks.cases) {
    it(testCase.name, () => {
      const quad = toQuad(testCase.points);
      if (testCase.expectedAspect !== undefined) {
        // Vector file gives aspect to 4 decimals.
        expect(aspectRatio(quad)).toBeCloseTo(testCase.expectedAspect, 3);
      }
      // Angle tolerance for tests: +/- 0.5 deg per the vector _comment —
      // anglesOk is a boolean so the tolerance is inherent to the vectors.
      expect(anglesOk(quad)).toBe(testCase.expectedAnglesOk);
      expect(quadShapeAccepted(quad, ASPECT_ID1)).toBe(testCase.expectedAcceptId1);
      expect(quadShapeAccepted(quad, ASPECT_PASSPORT)).toBe(testCase.expectedAcceptPassport);
    });
  }
});
