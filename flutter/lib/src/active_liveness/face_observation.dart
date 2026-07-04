/// Normalized face detector output — the ONLY shape the challenge state
/// machine ever sees (docs/ACTIVE_LIVENESS.md). Pure Dart, no Flutter or
/// ML Kit imports.
///
/// Sign conventions: [yawDeg] positive = user turned to THEIR left;
/// [pitchDeg] positive = looking up. Platform sign flips are applied in
/// `face_metrics.dart` and nowhere else.
class FaceObservation {
  /// Faces in frame.
  final int count;

  /// + = user turned to THEIR left.
  final double yawDeg;

  /// + = looking up.
  final double pitchDeg;

  final double rollDeg;

  /// 0..1 open probability.
  final double leftEyeOpen;

  /// 0..1 open probability.
  final double rightEyeOpen;

  /// 0..1 smiling probability.
  final double smile;

  /// Face bbox width / frame width.
  final double faceWidthFrac;

  /// Face center distance from the oval center / frame width.
  final double centerOffsetFrac;

  /// Detector tracking ID (anti-cheat: a change restarts the challenge).
  final int? trackingId;

  const FaceObservation({
    required this.count,
    this.yawDeg = 0,
    this.pitchDeg = 0,
    this.rollDeg = 0,
    this.leftEyeOpen = 0,
    this.rightEyeOpen = 0,
    this.smile = 0,
    this.faceWidthFrac = 0,
    this.centerOffsetFrac = 1,
    this.trackingId,
  });

  /// An observation for a frame with no detectable face.
  static const FaceObservation none = FaceObservation(count: 0);

  @override
  String toString() =>
      'FaceObservation(count: $count, yaw: ${yawDeg.toStringAsFixed(1)}, '
      'pitch: ${pitchDeg.toStringAsFixed(1)}, '
      'eyes: (${leftEyeOpen.toStringAsFixed(2)}, '
      '${rightEyeOpen.toStringAsFixed(2)}), '
      'smile: ${smile.toStringAsFixed(2)}, '
      'widthFrac: ${faceWidthFrac.toStringAsFixed(2)}, '
      'offsetFrac: ${centerOffsetFrac.toStringAsFixed(2)})';
}
