/// Pure-Dart quadrilateral geometry per docs/ALGORITHM.md step 8.
///
/// No OpenCV / Flutter imports — unit tested against the shared vectors in
/// `test/fixtures/vectors/` (identical files live in the Web package).
library;

import 'dart:math' as math;

/// Target aspect ratio for ID-1 cards (85.60 × 53.98 mm).
const double kId1Aspect = 1.586;

/// Target aspect ratio for passports (ID-3 data page, 125 × 88 mm).
const double kPassportAspect = 1.42;

/// Accepted deviation from the target aspect ratio.
const double kAspectTolerance = 0.25;

/// Interior-angle acceptance range in degrees.
const double kMinInteriorAngleDeg = 60;
const double kMaxInteriorAngleDeg = 120;

/// Orders 4 corners TL, TR, BR, BL:
/// TL = min(x+y), BR = max(x+y), TR = max(x−y), BL = min(x−y).
List<math.Point<double>> orderCorners(List<math.Point<double>> points) {
  assert(points.length == 4, 'orderCorners requires exactly 4 points');
  var tl = points[0], tr = points[0], br = points[0], bl = points[0];
  for (final p in points) {
    if (p.x + p.y < tl.x + tl.y) tl = p;
    if (p.x + p.y > br.x + br.y) br = p;
    if (p.x - p.y > tr.x - tr.y) tr = p;
    if (p.x - p.y < bl.x - bl.y) bl = p;
  }
  return [tl, tr, br, bl];
}

/// Interior angles in degrees at each vertex of an ordered quad
/// (TL, TR, BR, BL).
List<double> interiorAngles(List<math.Point<double>> ordered) {
  assert(ordered.length == 4);
  final angles = <double>[];
  for (var i = 0; i < 4; i++) {
    final prev = ordered[(i + 3) % 4];
    final curr = ordered[i];
    final next = ordered[(i + 1) % 4];
    final v1x = prev.x - curr.x, v1y = prev.y - curr.y;
    final v2x = next.x - curr.x, v2y = next.y - curr.y;
    final dot = v1x * v2x + v1y * v2y;
    final n1 = math.sqrt(v1x * v1x + v1y * v1y);
    final n2 = math.sqrt(v2x * v2x + v2y * v2y);
    if (n1 == 0 || n2 == 0) {
      angles.add(0);
      continue;
    }
    final cosine = (dot / (n1 * n2)).clamp(-1.0, 1.0);
    angles.add(math.acos(cosine) * 180 / math.pi);
  }
  return angles;
}

/// True iff every interior angle is within
/// [[kMinInteriorAngleDeg], [kMaxInteriorAngleDeg]].
bool anglesOk(List<math.Point<double>> ordered) => interiorAngles(
  ordered,
).every((a) => a >= kMinInteriorAngleDeg && a <= kMaxInteriorAngleDeg);

/// Aspect ratio of an ordered quad (TL, TR, BR, BL):
/// mean(top edge, bottom edge) / mean(left edge, right edge).
double aspectRatio(List<math.Point<double>> ordered) {
  assert(ordered.length == 4);
  final tl = ordered[0], tr = ordered[1], br = ordered[2], bl = ordered[3];
  final top = tl.distanceTo(tr);
  final bottom = bl.distanceTo(br);
  final left = tl.distanceTo(bl);
  final right = tr.distanceTo(br);
  final horizontal = (top + bottom) / 2;
  final vertical = (left + right) / 2;
  if (vertical == 0) return double.infinity;
  return horizontal / vertical;
}

/// True iff [aspect] is within ±[tolerance] of [target].
bool aspectAccepted(
  double aspect,
  double target, {
  double tolerance = kAspectTolerance,
}) => (aspect - target).abs() <= tolerance;

/// Combined ID-1 acceptance: interior angles in range AND aspect within
/// [kId1Aspect] ± [kAspectTolerance].
bool acceptsId1(List<math.Point<double>> ordered) =>
    anglesOk(ordered) && aspectAccepted(aspectRatio(ordered), kId1Aspect);

/// Combined passport acceptance: interior angles in range AND aspect within
/// [kPassportAspect] ± [kAspectTolerance].
bool acceptsPassport(List<math.Point<double>> ordered) =>
    anglesOk(ordered) && aspectAccepted(aspectRatio(ordered), kPassportAspect);

/// Shoelace area of an ordered quad.
double quadArea(List<math.Point<double>> ordered) {
  assert(ordered.length == 4);
  var sum = 0.0;
  for (var i = 0; i < 4; i++) {
    final a = ordered[i];
    final b = ordered[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum.abs() / 2;
}

/// Centroid of an ordered quad (mean of the 4 corners).
math.Point<double> quadCentroid(List<math.Point<double>> ordered) {
  assert(ordered.length == 4);
  var sx = 0.0, sy = 0.0;
  for (final p in ordered) {
    sx += p.x;
    sy += p.y;
  }
  return math.Point<double>(sx / 4, sy / 4);
}
