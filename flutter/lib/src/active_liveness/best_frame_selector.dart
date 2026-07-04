import 'face_observation.dart';

/// Session-wide best-selfie selection (docs/ACTIVE_LIVENESS.md).
///
/// Every processed frame with 1 face, |yaw| < 10°, |pitch| < 10°, both
/// eyes > 0.8 and faceWidthFrac ≥ 0.25 is a candidate, scored
/// `laplacianVariance × faceWidthFrac²`. The final selfie is the argmax,
/// cropped to the face bounding box expanded by 40% margin, JPEG q92
/// (cropping/encoding is done by the caller that owns the pixel data).
///
/// Pure Dart: sharpness is computed by the caller (OpenCV lives outside),
/// and the retained frame payload is opaque to this class.
class BestFrameSelector<T> {
  final double maxAbsYawDeg;
  final double maxAbsPitchDeg;
  final double minEyeOpen;
  final double minFaceWidthFrac;

  BestFrameSelector({
    this.maxAbsYawDeg = 10,
    this.maxAbsPitchDeg = 10,
    this.minEyeOpen = 0.8,
    this.minFaceWidthFrac = 0.25,
  });

  T? _bestFrame;
  double _bestScore = double.negativeInfinity;

  /// Whether any candidate has been accepted this session.
  bool get hasCandidate => _bestFrame != null;

  /// The retained argmax frame payload.
  T? get bestFrame => _bestFrame;

  /// Score of the retained frame.
  double get bestScore => hasCandidate ? _bestScore : 0;

  /// Whether [obs] qualifies as a selfie candidate at all.
  bool qualifies(FaceObservation obs) =>
      obs.count == 1 &&
      obs.yawDeg.abs() < maxAbsYawDeg &&
      obs.pitchDeg.abs() < maxAbsPitchDeg &&
      obs.leftEyeOpen > minEyeOpen &&
      obs.rightEyeOpen > minEyeOpen &&
      obs.faceWidthFrac >= minFaceWidthFrac;

  /// Scores a qualifying frame: `laplacianVariance × faceWidthFrac²`.
  static double score({
    required double laplacianVariance,
    required double faceWidthFrac,
  }) => laplacianVariance * faceWidthFrac * faceWidthFrac;

  /// Offers a frame. Returns `true` when it qualified and became the new
  /// best. [frame] is only retained when it wins, so callers may pass a
  /// copy of the pixel data.
  bool offer(
    FaceObservation obs, {
    required double laplacianVariance,
    required T Function() frameBuilder,
  }) {
    if (!qualifies(obs)) return false;
    final s = score(
      laplacianVariance: laplacianVariance,
      faceWidthFrac: obs.faceWidthFrac,
    );
    if (s <= _bestScore) return false;
    _bestScore = s;
    _bestFrame = frameBuilder();
    return true;
  }

  /// Clears the buffer (e.g. when the whole session restarts).
  void reset() {
    _bestFrame = null;
    _bestScore = double.negativeInfinity;
  }
}
