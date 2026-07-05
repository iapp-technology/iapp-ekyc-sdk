import 'dart:math' as math;
import 'dart:typed_data';

import 'package:opencv_dart/opencv_dart.dart' as cv;

import 'blur_scorer.dart';
import 'quad_geometry.dart' as geo;

/// All tunable constants of the detection pipeline, with the defaults
/// mandated by docs/ALGORITHM.md. The Web SDK's `DetectionParams` carries
/// identical values.
class DetectionConfig {
  /// Longest dimension of the processing frame (step 2).
  final int processingMaxDim;

  /// Canny threshold clamp range (step 4).
  final double cannyClampLow;
  final double cannyClampHigh;

  /// Contours examined per frame, sorted by area descending (step 6).
  final int maxContourCandidates;

  /// approxPolyDP epsilon as a fraction of arc length (step 7).
  final double approxEpsilonFrac;

  /// Minimum contour area as a fraction of the processed frame (step 7).
  final double minFrameAreaFrac;

  /// Minimum contour area as a fraction of the guide rect (step 7).
  final double minGuideAreaFrac;

  /// Corners must be at least this many px inside the processed frame.
  final double borderMarginPx;

  /// Aspect-ratio acceptance tolerance (step 8).
  final double aspectTolerance;

  /// Guide-alignment window: quad area vs guide area (step 8).
  final double guideAreaMinFrac;
  final double guideAreaMaxFrac;

  /// Stability tracking (step 9).
  final int stabilityWindow;
  final int minStableFrames;
  final double maxCornerDriftFrac;

  /// Laplacian-variance sharpness threshold (step 10).
  final double minSharpness;

  /// Accepted-frame ring buffer length (step 10).
  final int frameBufferSize;

  /// Manual capture button appears after this long without auto-capture.
  final int manualFallbackMs;

  /// Assisted fallback: if no quad has been accepted after this many ms,
  /// auto-capture switches to guide-region mode — fingers over the card
  /// edge routinely break contour-based quad detection, and users should
  /// not need the manual button for that.
  final int assistedFallbackMs;

  /// Consecutive sharp+stable guide frames required in assisted mode.
  final int assistedStableFrames;

  /// Max mean abs pixel diff (0–255) between guide crops to count stable.
  final double assistedMaxMeanDiff;

  /// Frame-processing budget (frames per second).
  final int maxProcessingFps;

  const DetectionConfig({
    this.processingMaxDim = 480,
    this.cannyClampLow = 30,
    this.cannyClampHigh = 200,
    this.maxContourCandidates = 5,
    this.approxEpsilonFrac = 0.02,
    this.minFrameAreaFrac = 0.08,
    this.minGuideAreaFrac = 0.5,
    this.borderMarginPx = 8,
    this.aspectTolerance = 0.25,
    this.guideAreaMinFrac = 0.6,
    // 1.3: users naturally overfill the guide a little; 1.15 rejected that.
    this.guideAreaMaxFrac = 1.3,
    // Handheld reality: a card held in front of a camera always tremors a
    // few px and acceptance flickers between direct/hull corners, so the
    // trigger is 4-of-6 frames with 3.5% drift — ~0.5 s of a normal hold.
    this.stabilityWindow = 6,
    this.minStableFrames = 4,
    this.maxCornerDriftFrac = 0.035,
    // Cameras are soft; the frame buffer still submits the SHARPEST frame,
    // and 60 comfortably rejects genuine motion blur.
    this.minSharpness = 60,
    this.frameBufferSize = 5,
    this.manualFallbackMs = 10000,
    this.assistedFallbackMs = 3000,
    this.assistedStableFrames = 4,
    this.assistedMaxMeanDiff = 10,
    this.maxProcessingFps = 10,
  });
}

/// Why a frame did not produce an accepted quad (drives the UX state).
enum QuadStatus {
  /// Accepted quad.
  found,

  /// No plausible quad in frame.
  notFound,

  /// Quad found but too small vs the guide (area < 60% of guide).
  moveCloser,

  /// Quad found but aspect/centroid/size checks failed.
  alignCard,
}

/// Outcome of one processed frame.
class QuadDetectionResult {
  final QuadStatus status;

  /// Ordered corners TL, TR, BR, BL in SOURCE image coordinates
  /// (only when [status] == [QuadStatus.found]).
  final List<math.Point<double>>? corners;

  /// Aspect ratio of the accepted quad.
  final double? aspect;

  /// Laplacian variance of the quad's bounding-box crop (0 if not found).
  final double sharpness;

  const QuadDetectionResult._(
    this.status, {
    this.corners,
    this.aspect,
    this.sharpness = 0,
  });

  bool get isFound => status == QuadStatus.found;

  bool isSharp(DetectionConfig config) => sharpness >= config.minSharpness;
}

/// OpenCV implementation of docs/ALGORITHM.md steps 1–8 (+10 sharpness).
class QuadDetector {
  final DetectionConfig config;

  QuadDetector({this.config = const DetectionConfig()});

  /// Builds a grayscale Mat from the Y plane of an NV21/YUV420 camera
  /// image, respecting [strideBytes] (`bytesPerRow`).
  static cv.Mat grayFromNv21Y(
    Uint8List yPlane,
    int width,
    int height, {
    int? strideBytes,
  }) {
    final stride = strideBytes ?? width;
    if (stride == width) {
      final mat = cv.Mat.fromList(
        height,
        width,
        cv.MatType.CV_8UC1,
        yPlane.length == width * height
            ? yPlane
            : Uint8List.sublistView(yPlane, 0, width * height),
      );
      return mat;
    }
    // Strip the row padding.
    final packed = Uint8List(width * height);
    for (var row = 0; row < height; row++) {
      packed.setRange(
        row * width,
        (row + 1) * width,
        Uint8List.sublistView(yPlane, row * stride, row * stride + width),
      );
    }
    return cv.Mat.fromList(height, width, cv.MatType.CV_8UC1, packed);
  }

  /// Builds a grayscale Mat from BGRA8888 bytes (iOS camera stream).
  static cv.Mat grayFromBgra(
    Uint8List bgra,
    int width,
    int height, {
    int? strideBytes,
  }) {
    final stride = strideBytes ?? width * 4;
    Uint8List packed;
    if (stride == width * 4) {
      packed = bgra.length == width * height * 4
          ? bgra
          : Uint8List.sublistView(bgra, 0, width * height * 4);
    } else {
      packed = Uint8List(width * height * 4);
      for (var row = 0; row < height; row++) {
        packed.setRange(
          row * width * 4,
          (row + 1) * width * 4,
          Uint8List.sublistView(bgra, row * stride, row * stride + width * 4),
        );
      }
    }
    final bgraMat = cv.Mat.fromList(height, width, cv.MatType.CV_8UC4, packed);
    try {
      return cv.cvtColor(bgraMat, cv.COLOR_BGRA2GRAY);
    } finally {
      bgraMat.dispose();
    }
  }

  /// Builds a BGR Mat from a full NV21 buffer (Y + interleaved VU), used
  /// for the stream-frame capture fallback.
  static cv.Mat bgrFromNv21(Uint8List nv21, int width, int height) {
    final yuv = cv.Mat.fromList(
      height * 3 ~/ 2,
      width,
      cv.MatType.CV_8UC1,
      nv21.length == width * height * 3 ~/ 2
          ? nv21
          : Uint8List.sublistView(nv21, 0, width * height * 3 ~/ 2),
    );
    try {
      return cv.cvtColor(yuv, cv.COLOR_YUV2BGR_NV21);
    } finally {
      yuv.dispose();
    }
  }

  /// Rotates a Mat so the image is upright. [rotationDegrees] is the
  /// clockwise rotation needed (0/90/180/270), e.g. the camera sensor
  /// orientation on Android.
  static cv.Mat rotateUpright(cv.Mat src, int rotationDegrees) {
    switch (rotationDegrees % 360) {
      case 90:
        return cv.rotate(src, cv.ROTATE_90_CLOCKWISE);
      case 180:
        return cv.rotate(src, cv.ROTATE_180);
      case 270:
        return cv.rotate(src, cv.ROTATE_90_COUNTERCLOCKWISE);
      default:
        return src.clone();
    }
  }

  /// Runs steps 2–8 (+ sharpness) on an upright grayscale frame.
  ///
  /// [guideRect] is the on-screen guide rectangle mapped into SOURCE image
  /// coordinates. [targetAspect] is 1.586 (ID-1) or 1.42 (passport).
  /// Returned corners are in SOURCE image coordinates.
  QuadDetectionResult detect(
    cv.Mat gray, {
    required math.Rectangle<double> guideRect,
    required double targetAspect,
  }) {
    final srcW = gray.cols, srcH = gray.rows;
    final maxDim = math.max(srcW, srcH);
    final scale = maxDim > config.processingMaxDim
        ? config.processingMaxDim / maxDim
        : 1.0;
    final procW = (srcW * scale).round();
    final procH = (srcH * scale).round();

    final mats = <cv.Mat>[];
    try {
      cv.Mat proc;
      if (scale < 1.0) {
        proc = cv.resize(gray, (procW, procH), interpolation: cv.INTER_AREA);
        mats.add(proc);
      } else {
        proc = gray;
      }

      // Step 3: Gaussian blur 5×5, sigma 0.
      final blurred = cv.gaussianBlur(proc, (5, 5), 0);
      mats.add(blurred);

      // Step 4: adaptive Canny from the grayscale median.
      final m = _median(blurred);
      final lower = (0.66 * m).clamp(
        config.cannyClampLow,
        config.cannyClampHigh,
      );
      final upper = (1.33 * m).clamp(
        config.cannyClampLow,
        config.cannyClampHigh,
      );
      final edges = cv.canny(blurred, lower, upper);
      mats.add(edges);

      // Step 5: dilate 3×3 rect, 1 iteration.
      final kernel = cv.getStructuringElement(cv.MORPH_RECT, (3, 3));
      mats.add(kernel);
      final dilated = cv.dilate(edges, kernel, iterations: 1);
      mats.add(dilated);

      // Step 6: external contours, top candidates by area.
      final (contours, hierarchy) = cv.findContours(
        dilated,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE,
      );
      hierarchy.dispose();
      try {
        final ranked = <(double, cv.VecPoint)>[
          for (final c in contours) (cv.contourArea(c), c),
        ]..sort((a, b) => b.$1.compareTo(a.$1));

        final guideProc = math.Rectangle<double>(
          guideRect.left * scale,
          guideRect.top * scale,
          guideRect.width * scale,
          guideRect.height * scale,
        );
        final guideArea = guideProc.width * guideProc.height;
        final frameArea = (procW * procH).toDouble();

        var rejection = QuadStatus.notFound;
        final limit = math.min(config.maxContourCandidates, ranked.length);

        for (var i = 0; i < limit; i++) {
          final contour = ranked[i].$2;
          // Step 7: quadrilateral test.
          var pts = _fourPointApprox(contour);
          if (pts == null) {
            // Fingers holding a card break its outline into >4 vertices;
            // the convex hull smooths those intrusions back into a
            // quadrilateral.
            final hullMat = cv.convexHull(contour);
            final hull = cv.VecPoint.fromMat(hullMat);
            try {
              pts = _fourPointApprox(hull);
            } finally {
              hull.dispose();
              hullMat.dispose();
            }
          }
          if (pts == null) continue;

          final ordered = geo.orderCorners(pts);
          if (!geo.anglesOk(ordered)) continue;

          final area = geo.quadArea(ordered);
          if (area < config.minFrameAreaFrac * frameArea) continue;
          if (area < config.minGuideAreaFrac * guideArea) continue;

          final insideBorder = ordered.every(
            (p) =>
                p.x >= config.borderMarginPx &&
                p.y >= config.borderMarginPx &&
                p.x <= procW - config.borderMarginPx &&
                p.y <= procH - config.borderMarginPx,
          );
          if (!insideBorder) continue;

          // Step 8: shape + guide-alignment checks.
          final aspect = geo.aspectRatio(ordered);
          if (!geo.aspectAccepted(
            aspect,
            targetAspect,
            tolerance: config.aspectTolerance,
          )) {
            rejection = QuadStatus.alignCard;
            continue;
          }

          final centroid = geo.quadCentroid(ordered);
          if (!guideProc.containsPoint(
            math.Point<double>(centroid.x, centroid.y),
          )) {
            rejection = QuadStatus.alignCard;
            continue;
          }

          if (area < config.guideAreaMinFrac * guideArea) {
            rejection = QuadStatus.moveCloser;
            continue;
          }
          if (area > config.guideAreaMaxFrac * guideArea) {
            rejection = QuadStatus.alignCard;
            continue;
          }

          // Step 10: sharpness on the quad's bounding-box crop of the
          // processed grayscale.
          final sharpness = _quadSharpness(proc, ordered, procW, procH);

          final sourceCorners = [
            for (final p in ordered)
              math.Point<double>(p.x / scale, p.y / scale),
          ];
          return QuadDetectionResult._(
            QuadStatus.found,
            corners: sourceCorners,
            aspect: aspect,
            sharpness: sharpness,
          );
        }
        return QuadDetectionResult._(rejection);
      } finally {
        contours.dispose();
      }
    } finally {
      for (final mat in mats) {
        mat.dispose();
      }
    }
  }

  /// Step 7 polygon approximation: `approxPolyDP` with
  /// ε = [DetectionConfig.approxEpsilonFrac] × arcLength. Returns the four
  /// corner points iff the approximation has exactly 4 points and is
  /// convex, else null (mirrors the Web SDK's `fourPointApprox`).
  List<math.Point<double>>? _fourPointApprox(cv.VecPoint shape) {
    final eps = config.approxEpsilonFrac * cv.arcLength(shape, true);
    final approx = cv.approxPolyDP(shape, eps, true);
    try {
      if (approx.length != 4) return null;
      if (!cv.isContourConvex(approx)) return null;
      return [
        for (final p in approx)
          math.Point<double>(p.x.toDouble(), p.y.toDouble()),
      ];
    } finally {
      approx.dispose();
    }
  }

  double _quadSharpness(
    cv.Mat proc,
    List<math.Point<double>> ordered,
    int procW,
    int procH,
  ) {
    var minX = double.infinity, minY = double.infinity;
    var maxX = -double.infinity, maxY = -double.infinity;
    for (final p in ordered) {
      minX = math.min(minX, p.x);
      minY = math.min(minY, p.y);
      maxX = math.max(maxX, p.x);
      maxY = math.max(maxY, p.y);
    }
    final x = minX.floor().clamp(0, procW - 2);
    final y = minY.floor().clamp(0, procH - 2);
    final w = (maxX.ceil() - x).clamp(1, procW - x);
    final h = (maxY.ceil() - y).clamp(1, procH - y);
    final roi = proc.region(cv.Rect(x, y, w, h));
    try {
      return laplacianVariance(roi);
    } finally {
      roi.dispose();
    }
  }

  /// Median gray level of a CV_8UC1 Mat via a 256-bin histogram.
  static double _median(cv.Mat gray8u) {
    final bytes = gray8u.data;
    final hist = List<int>.filled(256, 0);
    for (final b in bytes) {
      hist[b]++;
    }
    final half = bytes.length ~/ 2;
    var cumulative = 0;
    for (var v = 0; v < 256; v++) {
      cumulative += hist[v];
      if (cumulative > half) return v.toDouble();
    }
    return 255;
  }
}
