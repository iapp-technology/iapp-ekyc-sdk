import 'dart:math' as math;
import 'dart:typed_data';

import 'package:opencv_dart/opencv_dart.dart' as cv;

/// Perspective correction + JPEG encoding (docs/ALGORITHM.md step 12).
class PerspectiveCropper {
  /// Maximum encoded output size (spec: assert result < 10 MB).
  static const int maxOutputBytes = 10 * 1024 * 1024;

  /// JPEG quality used for all SDK outputs.
  static const int jpegQuality = 92;

  /// Warps [srcBgr] so that [corners] (ordered TL, TR, BR, BL, in the
  /// source image's coordinate space) map onto a `outputWidth` ×
  /// `outputHeight` rectangle, then encodes JPEG quality 92.
  ///
  /// Destination sizes at ~300 DPI: 1011×637 (ID-1) or 1476×1039
  /// (passport).
  static Uint8List cropAndEncode(
    cv.Mat srcBgr, {
    required List<math.Point<double>> corners,
    required int outputWidth,
    required int outputHeight,
  }) {
    assert(corners.length == 4, 'corners must be ordered TL, TR, BR, BL');
    final src = cv.VecPoint2f.fromList([
      for (final p in corners) cv.Point2f(p.x, p.y),
    ]);
    final dst = cv.VecPoint2f.fromList([
      cv.Point2f(0, 0),
      cv.Point2f(outputWidth.toDouble(), 0),
      cv.Point2f(outputWidth.toDouble(), outputHeight.toDouble()),
      cv.Point2f(0, outputHeight.toDouble()),
    ]);
    final transform = cv.getPerspectiveTransform2f(src, dst);
    final warped = cv.warpPerspective(srcBgr, transform, (
      outputWidth,
      outputHeight,
    ), flags: cv.INTER_LINEAR);
    try {
      return encodeJpeg(warped);
    } finally {
      warped.dispose();
      transform.dispose();
      src.dispose();
      dst.dispose();
    }
  }

  /// Encodes a Mat as JPEG quality 92 and asserts the < 10 MB API limit.
  static Uint8List encodeJpeg(cv.Mat image) {
    final (ok, bytes) = cv.imencode(
      '.jpg',
      image,
      params: cv.VecI32.fromList([cv.IMWRITE_JPEG_QUALITY, jpegQuality]),
    );
    if (!ok) {
      throw StateError('JPEG encoding failed');
    }
    if (bytes.length >= maxOutputBytes) {
      throw StateError(
        'Encoded image is ${bytes.length} bytes — exceeds the 10 MB '
        'upload limit',
      );
    }
    return bytes;
  }
}
