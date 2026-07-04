// Shared geometry/stability test vectors — identical files live in
// web/tests/fixtures/vectors/ and both suites must assert identical
// outcomes (docs/ALGORITHM.md).
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:iapp_ekyc_sdk/src/vision/quad_geometry.dart' as geo;
import 'package:iapp_ekyc_sdk/src/vision/stability_tracker.dart';

Map<String, dynamic> loadVectors(String name) {
  final file = File('test/fixtures/vectors/$name.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

List<math.Point<double>> pointsFrom(List<dynamic> raw) => [
  for (final p in raw)
    math.Point<double>((p[0] as num).toDouble(), (p[1] as num).toDouble()),
];

void main() {
  group('corner_ordering vectors', () {
    final cases = loadVectors('corner_ordering')['cases'] as List<dynamic>;
    for (final c in cases.cast<Map<String, dynamic>>()) {
      test(c['name'], () {
        final input = pointsFrom(c['input'] as List<dynamic>);
        final expected = pointsFrom(c['expected'] as List<dynamic>);
        final ordered = geo.orderCorners(input);
        expect(ordered, hasLength(4));
        for (var i = 0; i < 4; i++) {
          expect(ordered[i].x, closeTo(expected[i].x, 1e-9));
          expect(ordered[i].y, closeTo(expected[i].y, 1e-9));
        }
      });
    }
  });

  group('quad_checks vectors', () {
    final cases = loadVectors('quad_checks')['cases'] as List<dynamic>;
    for (final c in cases.cast<Map<String, dynamic>>()) {
      test(c['name'], () {
        final points = pointsFrom(c['points'] as List<dynamic>);

        if (c.containsKey('expectedAspect')) {
          expect(
            geo.aspectRatio(points),
            closeTo((c['expectedAspect'] as num).toDouble(), 1e-3),
          );
        }

        if (c.containsKey('expectedAnglesOk')) {
          // Angle tolerance for tests: ±0.5 deg — anglesOk uses exact
          // bounds, matching the vector expectations.
          expect(geo.anglesOk(points), c['expectedAnglesOk'] as bool);
        }

        expect(
          geo.acceptsId1(points),
          c['expectedAcceptId1'] as bool,
          reason: 'acceptId1 mismatch',
        );
        expect(
          geo.acceptsPassport(points),
          c['expectedAcceptPassport'] as bool,
          reason: 'acceptPassport mismatch',
        );
      });
    }
  });

  group('stability vectors', () {
    final data = loadVectors('stability');
    final frameWidth = (data['frameWidth'] as num).toDouble();
    final frameHeight = (data['frameHeight'] as num).toDouble();
    final cases = data['cases'] as List<dynamic>;

    for (final c in cases.cast<Map<String, dynamic>>()) {
      test(c['name'], () {
        final tracker = StabilityTracker(
          frameWidth: frameWidth,
          frameHeight: frameHeight,
        );
        var triggered = false;
        for (final frame in c['frames'] as List<dynamic>) {
          tracker.addFrame(
            frame == null ? null : pointsFrom(frame as List<dynamic>),
          );
          triggered = triggered || tracker.isTriggered;
        }
        expect(triggered, c['expectedTrigger'] as bool);
      });
    }
  });

  test('first accepted frame is never stable', () {
    final tracker = StabilityTracker(frameWidth: 480, frameHeight: 360);
    final quad = pointsFrom([
      [100, 100],
      [380, 100],
      [380, 260],
      [100, 260],
    ]);
    expect(tracker.addFrame(quad), isFalse);
    expect(tracker.addFrame(quad), isTrue); // Zero drift vs previous.
  });
}
