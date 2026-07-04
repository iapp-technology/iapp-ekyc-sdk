import 'dart:ui';

import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

import 'face_observation.dart';

export 'face_observation.dart';

/// Creates the [FaceDetector] configured per docs/ACTIVE_LIVENESS.md:
/// classification + tracking on, fast mode, minFaceSize 0.15, contours
/// OFF (≈2× latency for no benefit).
FaceDetector createLivenessFaceDetector() => FaceDetector(
  options: FaceDetectorOptions(
    enableClassification: true,
    enableTracking: true,
    performanceMode: FaceDetectorMode.fast,
    minFaceSize: 0.15,
    // enableContours deliberately left false.
  ),
);

/// Reduces raw ML Kit output to a [FaceObservation].
///
/// [frameSize] must be the UPRIGHT frame size (the coordinate space the
/// bounding boxes live in). [ovalCenter] is the oval guide center as a
/// fraction of the frame (defaults to (0.5, 0.45)).
///
/// The legacy Android yaw-sign flip (`headEulerAngleY *= -1`, which also
/// compensates the front-camera mirroring difference between platforms)
/// is applied HERE and nowhere else, so the state machine sees a single
/// sign convention on both platforms.
FaceObservation faceObservationFrom(
  List<Face> faces, {
  required Size frameSize,
  required bool isAndroid,
  Offset ovalCenter = const Offset(0.5, 0.45),
}) {
  if (faces.isEmpty || frameSize.width <= 0 || frameSize.height <= 0) {
    return FaceObservation.none;
  }
  // With multiple faces, report metrics of the largest one — the state
  // machine restarts on count != 1 regardless.
  var face = faces.first;
  if (faces.length > 1) {
    for (final f in faces.skip(1)) {
      if (f.boundingBox.width > face.boundingBox.width) face = f;
    }
  }

  var yaw = face.headEulerAngleY ?? 0;
  if (isAndroid) {
    yaw = -yaw; // Legacy Android sign flip + mirroring compensation.
  }
  final pitch = face.headEulerAngleX ?? 0;
  final roll = face.headEulerAngleZ ?? 0;

  final box = face.boundingBox;
  final faceWidthFrac = box.width / frameSize.width;

  final center = box.center;
  final target = Offset(
    ovalCenter.dx * frameSize.width,
    ovalCenter.dy * frameSize.height,
  );
  final centerOffsetFrac = (center - target).distance / frameSize.width;

  return FaceObservation(
    count: faces.length,
    yawDeg: yaw,
    pitchDeg: pitch,
    rollDeg: roll,
    leftEyeOpen: face.leftEyeOpenProbability ?? 0,
    rightEyeOpen: face.rightEyeOpenProbability ?? 0,
    smile: face.smilingProbability ?? 0,
    faceWidthFrac: faceWidthFrac,
    centerOffsetFrac: centerOffsetFrac,
    trackingId: face.trackingId,
  );
}
