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

/// Secondary detections narrower than this fraction of the FRAME are noise.
const double kMinSecondaryFaceWidthFrac = 0.06;

/// A real second subject is at least this fraction of the subject's width;
/// anything smaller is a bystander in the background, not a co-actor.
const double kMinSecondaryWidthRatio = 0.40;

/// intersection / min(area) at or above this = the SAME face, detected twice.
const double kDuplicateFaceOverlap = 0.30;

/// intersection area / smaller box area (0..1). Nest-aware, unlike IoU.
double _overlapRatio(Rect a, Rect b) {
  final w = (a.right < b.right ? a.right : b.right) -
      (a.left > b.left ? a.left : b.left);
  final h = (a.bottom < b.bottom ? a.bottom : b.bottom) -
      (a.top > b.top ? a.top : b.top);
  if (w <= 0 || h <= 0) return 0;
  final smaller = (a.width * a.height) < (b.width * b.height)
      ? a.width * a.height
      : b.width * b.height;
  return smaller > 0 ? (w * h) / smaller : 0;
}

/// PEOPLE in frame: the subject plus every detection that is genuinely a
/// second person — big enough to matter, and not the subject's own face
/// boxed twice. Detectors do emit the occasional phantom, and an
/// unfiltered count pins the flow on "only one face may be in view"
/// (see docs/ACTIVE_LIVENESS.md).
int _peopleCount(List<Face> faces, Face subject, double frameWidth) {
  var count = 1;
  for (final f in faces) {
    if (identical(f, subject)) continue;
    final box = f.boundingBox;
    if (box.width <= 0 || box.height <= 0) continue;
    if (box.width / frameWidth < kMinSecondaryFaceWidthFrac) continue;
    if (box.width < subject.boundingBox.width * kMinSecondaryWidthRatio) {
      continue;
    }
    if (_overlapRatio(box, subject.boundingBox) >= kDuplicateFaceOverlap) {
      continue;
    }
    count++;
  }
  return count;
}

/// The subject's face: the LARGEST detection, i.e. the person holding the
/// phone. Never `faces.first` — detector order is not significance order,
/// and a phantom detection can occupy slot 0.
Face? subjectFace(List<Face> faces) {
  if (faces.isEmpty) return null;
  var subject = faces.first;
  for (final f in faces.skip(1)) {
    if (f.boundingBox.width > subject.boundingBox.width) subject = f;
  }
  return subject;
}

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
  // The subject is the LARGEST face — the person holding the phone. Every
  // metric below describes that face; `count` reports how many PEOPLE the
  // frame holds (see _peopleCount).
  final face = subjectFace(faces)!;

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
    count: _peopleCount(faces, face, frameSize.width),
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
