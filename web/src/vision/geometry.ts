/**
 * Pure quadrilateral geometry per docs/ALGORITHM.md step 8. No OpenCV.
 * Must behave identically to flutter/lib/src/vision/geometry.dart —
 * both are asserted against the shared vectors in tests/fixtures/vectors/.
 */

export interface Point {
  x: number;
  y: number;
}

/** Ordered TL, TR, BR, BL. */
export type Quad = [Point, Point, Point, Point];

/** ID-1 card aspect (85.60 / 53.98 mm). */
export const ASPECT_ID1 = 1.586;
/** ID-3 passport data page aspect (125 / 88 mm). */
export const ASPECT_PASSPORT = 1.42;
/** Accept aspect within +/- this of the target (docs/ALGORITHM.md). */
export const ASPECT_TOLERANCE = 0.25;
/** Interior angle acceptance window in degrees. */
export const MIN_INTERIOR_ANGLE_DEG = 60;
export const MAX_INTERIOR_ANGLE_DEG = 120;

/**
 * Order 4 arbitrary corners as TL, TR, BR, BL:
 * TL = min(x+y), BR = max(x+y), TR = max(x−y), BL = min(x−y).
 */
export function orderCorners(points: readonly Point[]): Quad {
  if (points.length !== 4) {
    throw new Error(`orderCorners expects 4 points, got ${points.length}`);
  }
  let tl = points[0];
  let tr = points[0];
  let br = points[0];
  let bl = points[0];
  for (const p of points) {
    if (p.x + p.y < tl.x + tl.y) tl = p;
    if (p.x + p.y > br.x + br.y) br = p;
    if (p.x - p.y > tr.x - tr.y) tr = p;
    if (p.x - p.y < bl.x - bl.y) bl = p;
  }
  return [tl, tr, br, bl];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Interior angle (degrees) at each vertex of an ordered quad,
 * in TL, TR, BR, BL order.
 */
export function interiorAngles(quad: Quad): [number, number, number, number] {
  const angles: number[] = [];
  for (let i = 0; i < 4; i++) {
    const prev = quad[(i + 3) % 4];
    const curr = quad[i];
    const next = quad[(i + 1) % 4];
    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const dot = v1x * v2x + v1y * v2y;
    const n1 = Math.hypot(v1x, v1y);
    const n2 = Math.hypot(v2x, v2y);
    if (n1 === 0 || n2 === 0) {
      angles.push(0);
      continue;
    }
    const cos = Math.min(1, Math.max(-1, dot / (n1 * n2)));
    angles.push((Math.acos(cos) * 180) / Math.PI);
  }
  return angles as [number, number, number, number];
}

/** Every interior angle within [60, 120] degrees. */
export function anglesOk(quad: Quad): boolean {
  return interiorAngles(quad).every(
    (a) => a >= MIN_INTERIOR_ANGLE_DEG && a <= MAX_INTERIOR_ANGLE_DEG,
  );
}

/** aspect = mean(top edge, bottom edge) / mean(left edge, right edge). */
export function aspectRatio(quad: Quad): number {
  const [tl, tr, br, bl] = quad;
  const top = distance(tl, tr);
  const bottom = distance(bl, br);
  const left = distance(tl, bl);
  const right = distance(tr, br);
  const horizontal = (top + bottom) / 2;
  const vertical = (left + right) / 2;
  if (vertical === 0) return 0;
  return horizontal / vertical;
}

/** |aspect − target| ≤ tolerance. */
export function aspectAccepted(
  aspect: number,
  targetAspect: number,
  tolerance: number = ASPECT_TOLERANCE,
): boolean {
  return Math.abs(aspect - targetAspect) <= tolerance;
}

/** Combined shape acceptance: angles in range AND aspect near target. */
export function quadShapeAccepted(
  quad: Quad,
  targetAspect: number,
  tolerance: number = ASPECT_TOLERANCE,
): boolean {
  return anglesOk(quad) && aspectAccepted(aspectRatio(quad), targetAspect, tolerance);
}

/** Polygon area via the shoelace formula (absolute value). */
export function quadArea(quad: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Arithmetic centroid of the 4 corners. */
export function centroid(quad: Quad): Point {
  return {
    x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
    y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
  };
}

/** Maximum per-corner displacement between two ordered quads. */
export function maxCornerDistance(a: Quad, b: Quad): number {
  let max = 0;
  for (let i = 0; i < 4; i++) {
    const d = distance(a[i], b[i]);
    if (d > max) max = d;
  }
  return max;
}
