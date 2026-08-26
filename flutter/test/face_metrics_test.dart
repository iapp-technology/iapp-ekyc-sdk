// Face-list filtering: turning the detector's output into "how many
// PEOPLE are in front of the camera" (docs/ACTIVE_LIVENESS.md).
//
// Regression cover for the Aug 2026 field report where a phantom second
// detection pinned the flow on "only one face may be in view".
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:iapp_ekyc_sdk/src/active_liveness/face_metrics.dart';

const _frame = Size(1000, 1000);

Face _face(
  Rect box, {
  double? yaw,
  double? leftEye,
  double? rightEye,
  double? smile,
}) => Face(
  boundingBox: box,
  landmarks: const {},
  contours: const {},
  headEulerAngleY: yaw,
  leftEyeOpenProbability: leftEye,
  rightEyeOpenProbability: rightEye,
  smilingProbability: smile,
);

/// The subject: 400 px wide, centered.
final _subject = _face(
  const Rect.fromLTWH(300, 250, 400, 500),
  yaw: 5,
  leftEye: 0.9,
  rightEye: 0.9,
  smile: 0.1,
);

int _countOf(List<Face> faces) =>
    faceObservationFrom(faces, frameSize: _frame, isAndroid: false).count;

void main() {
  test('no faces -> the empty observation', () {
    expect(_countOf([]), 0);
  });

  test('one face -> one person', () {
    expect(_countOf([_subject]), 1);
  });

  test('the same face detected twice counts once', () {
    final ghost = _face(const Rect.fromLTWH(310, 240, 390, 500));
    expect(_countOf([_subject, ghost]), 1);
  });

  test('a ghost nested inside the subject counts once', () {
    final ghost = _face(const Rect.fromLTWH(400, 400, 200, 200));
    expect(_countOf([_subject, ghost]), 1);
  });

  test('a small background face does not block the flow', () {
    final far = _face(const Rect.fromLTWH(20, 100, 50, 60));
    expect(_countOf([_subject, far]), 1);
  });

  test('a genuine second person still counts', () {
    final other = _face(const Rect.fromLTWH(750, 250, 230, 420));
    expect(_countOf([_subject, other]), 2);
  });

  test('metrics come from the SUBJECT, whatever the detector order', () {
    final other = _face(
      const Rect.fromLTWH(750, 250, 230, 420),
      yaw: -40,
      leftEye: 0.1,
      rightEye: 0.1,
      smile: 0.9,
    );
    final obs = faceObservationFrom(
      [other, _subject],
      frameSize: _frame,
      isAndroid: false,
    );
    expect(obs.count, 2);
    expect(obs.yawDeg, 5); // the subject's, not the bystander's
    expect(obs.leftEyeOpen, 0.9);
    expect(obs.faceWidthFrac, 0.4);
  });

  test('subjectFace picks the largest, not the first', () {
    final other = _face(const Rect.fromLTWH(750, 250, 230, 420));
    expect(subjectFace([other, _subject]), same(_subject));
    expect(subjectFace([]), isNull);
  });
}
