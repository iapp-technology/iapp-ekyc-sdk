import 'dart:collection';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:opencv_dart/opencv_dart.dart' as cv;

import '../vision/perspective_cropper.dart';
import '../vision/quad_detector.dart';
import '../vision/stability_tracker.dart';
import 'document_overlay_painter.dart' show DocumentGuideLayout;
import 'document_type.dart';

/// UX states of the capture flow (docs/ALGORITHM.md).
enum DocumentCaptureState {
  searching,
  holdStill,
  tooBlurry,
  moveCloser,
  alignCard,
  capturing,
  uploading,
  done,
  error,
}

/// i18n key for each state's status chip.
extension DocumentCaptureStateKey on DocumentCaptureState {
  String get instructionKey {
    switch (this) {
      case DocumentCaptureState.searching:
        return 'searching_card';
      case DocumentCaptureState.holdStill:
        return 'hold_still';
      case DocumentCaptureState.tooBlurry:
        return 'too_blurry';
      case DocumentCaptureState.moveCloser:
        return 'move_closer';
      case DocumentCaptureState.alignCard:
        return 'align_card';
      case DocumentCaptureState.capturing:
        return 'capturing';
      case DocumentCaptureState.uploading:
        return 'uploading';
      case DocumentCaptureState.done:
        return 'done';
      case DocumentCaptureState.error:
        return 'error_generic';
    }
  }
}

/// One accepted stream frame kept in the ring buffer for the capture
/// fallback (raw NV21/BGRA bytes + quad + sharpness).
class BufferedFrame {
  /// Raw camera bytes: full NV21 buffer (Android) or BGRA8888 (iOS).
  final Uint8List bytes;
  final int width;
  final int height;
  final int rotationDegrees;
  final bool isNv21;

  /// Accepted quad corners TL,TR,BR,BL in UPRIGHT source coordinates.
  final List<math.Point<double>> corners;
  final double sharpness;

  const BufferedFrame({
    required this.bytes,
    required this.width,
    required this.height,
    required this.rotationDegrees,
    required this.isNv21,
    required this.corners,
    required this.sharpness,
  });

  /// Decodes and rotates the raw frame to an upright BGR Mat.
  cv.Mat toUprightBgr() {
    cv.Mat color;
    if (isNv21) {
      color = QuadDetector.bgrFromNv21(bytes, width, height);
    } else {
      final bgra = cv.Mat.fromList(
        height,
        width,
        cv.MatType.CV_8UC4,
        bytes.length == width * height * 4
            ? bytes
            : Uint8List.sublistView(bytes, 0, width * height * 4),
      );
      color = cv.cvtColor(bgra, cv.COLOR_BGRA2BGR);
      bgra.dispose();
    }
    final upright = QuadDetector.rotateUpright(color, rotationDegrees);
    color.dispose();
    return upright;
  }
}

/// Detection-loop and state logic for the document capture flow,
/// separated from the widget for testability.
class DocumentCaptureController extends ChangeNotifier {
  final DocumentType documentType;
  final DetectionConfig config;
  final QuadDetector detector;
  final DateTime Function() _now;

  DocumentCaptureController({
    required this.documentType,
    this.config = const DetectionConfig(),
    QuadDetector? detector,
    DateTime Function()? clock,
  }) : detector = detector ?? QuadDetector(config: config),
       _now = clock ?? DateTime.now;

  DocumentCaptureState _state = DocumentCaptureState.searching;
  DocumentCaptureState get state => _state;

  StabilityTracker? _stability;
  final Queue<BufferedFrame> _buffer = Queue<BufferedFrame>();
  DateTime? _searchStartedAt;
  bool _captureLatched = false;

  /// Corners of the most recent accepted frame (upright source coords).
  List<math.Point<double>>? get lastCorners =>
      _buffer.isEmpty ? null : _buffer.last.corners;

  /// The sharpest buffered accepted frame.
  BufferedFrame? get bestBufferedFrame {
    BufferedFrame? best;
    for (final f in _buffer) {
      if (best == null || f.sharpness > best.sharpness) best = f;
    }
    return best;
  }

  /// Whether the manual capture button should be visible
  /// (≥ `manualFallbackMs` in the detection loop without auto-capture).
  bool get manualCaptureAvailable {
    final started = _searchStartedAt;
    if (started == null || _captureLatched) return false;
    return _now().difference(started).inMilliseconds >= config.manualFallbackMs;
  }

  /// True once auto/manual capture has fired; frame processing stops.
  bool get captureLatched => _captureLatched;

  /// (Re)enters the live detection loop.
  void startDetection() {
    _state = DocumentCaptureState.searching;
    _stability = null;
    _buffer.clear();
    _searchStartedAt = _now();
    _captureLatched = false;
    notifyListeners();
  }

  void setFlowState(DocumentCaptureState next) {
    if (_state == next) return;
    _state = next;
    notifyListeners();
  }

  /// Processes one upright grayscale stream frame. [rawBytes] must be a
  /// COPY of the camera buffer (NV21 full buffer on Android, BGRA on
  /// iOS) so it can outlive the callback; [rawWidth]/[rawHeight] are the
  /// raw (pre-rotation) dimensions.
  ///
  /// Returns `true` when auto-capture should fire.
  bool processFrame(
    cv.Mat uprightGray, {
    required Uint8List rawBytes,
    required int rawWidth,
    required int rawHeight,
    required int rotationDegrees,
    required bool isNv21,
  }) {
    if (_captureLatched) return false;
    _searchStartedAt ??= _now();

    final width = uprightGray.cols.toDouble();
    final height = uprightGray.rows.toDouble();
    final guide = _guideRectForFrame(width, height);

    final tracker = _stability ??= StabilityTracker(
      frameWidth: width,
      frameHeight: height,
      window: config.stabilityWindow,
      minStableFrames: config.minStableFrames,
      maxCornerDriftFrac: config.maxCornerDriftFrac,
    );

    final result = detector.detect(
      uprightGray,
      guideRect: guide,
      targetAspect: documentType.aspectRatio,
    );

    if (!result.isFound) {
      tracker.addFrame(null);
      setFlowState(switch (result.status) {
        QuadStatus.moveCloser => DocumentCaptureState.moveCloser,
        QuadStatus.alignCard => DocumentCaptureState.alignCard,
        _ => DocumentCaptureState.searching,
      });
      return false;
    }

    tracker.addFrame(result.corners);

    _buffer.addLast(
      BufferedFrame(
        bytes: rawBytes,
        width: rawWidth,
        height: rawHeight,
        rotationDegrees: rotationDegrees,
        isNv21: isNv21,
        corners: result.corners!,
        sharpness: result.sharpness,
      ),
    );
    while (_buffer.length > config.frameBufferSize) {
      _buffer.removeFirst();
    }

    final bestSharpness = bestBufferedFrame?.sharpness ?? 0;
    if (tracker.isTriggered && bestSharpness >= config.minSharpness) {
      _captureLatched = true;
      setFlowState(DocumentCaptureState.capturing);
      return true;
    }

    setFlowState(
      result.isSharp(config)
          ? DocumentCaptureState.holdStill
          : DocumentCaptureState.tooBlurry,
    );
    return false;
  }

  /// Latches capture for the manual button.
  void triggerManualCapture() {
    if (_captureLatched) return;
    _captureLatched = true;
    setFlowState(DocumentCaptureState.capturing);
  }

  /// Runs detection on the full-resolution still ([stillBgr], upright)
  /// using the last stream quad (scaled) as a sanity prior, then crops
  /// and encodes. Returns `null` when the still must be rejected (caller
  /// falls back to [captureFromBestBufferedFrame]).
  Uint8List? captureFromStill(cv.Mat stillBgr) {
    final gray = cv.cvtColor(stillBgr, cv.COLOR_BGR2GRAY);
    try {
      final width = stillBgr.cols.toDouble();
      final height = stillBgr.rows.toDouble();
      final result = detector.detect(
        gray,
        guideRect: _guideRectForFrame(width, height),
        targetAspect: documentType.aspectRatio,
      );
      if (!result.isFound) return null;

      final prior = lastCorners;
      if (prior != null && _buffer.isNotEmpty) {
        final last = _buffer.last;
        final priorSize = _uprightSize(last);
        final sx = width / priorSize.$1;
        final sy = height / priorSize.$2;
        final priorCentroid = _centroid([
          for (final p in prior) math.Point<double>(p.x * sx, p.y * sy),
        ]);
        final stillCentroid = _centroid(result.corners!);
        final diag = math.sqrt(width * width + height * height);
        if (priorCentroid.distanceTo(stillCentroid) > 0.2 * diag) {
          return null; // Still disagrees with the stream prior.
        }
      }

      return PerspectiveCropper.cropAndEncode(
        stillBgr,
        corners: result.corners!,
        outputWidth: documentType.outputWidth,
        outputHeight: documentType.outputHeight,
      );
    } finally {
      gray.dispose();
    }
  }

  /// Fallback: perspective-crops the sharpest buffered stream frame.
  Uint8List? captureFromBestBufferedFrame() {
    final frame = bestBufferedFrame;
    if (frame == null) return null;
    final upright = frame.toUprightBgr();
    try {
      return PerspectiveCropper.cropAndEncode(
        upright,
        corners: frame.corners,
        outputWidth: documentType.outputWidth,
        outputHeight: documentType.outputHeight,
      );
    } finally {
      upright.dispose();
    }
  }

  /// Last-resort manual capture: crops the guide rect region of the
  /// still and scales it to the output size (no quad was ever detected).
  Uint8List captureGuideRegion(cv.Mat stillBgr) {
    final width = stillBgr.cols.toDouble();
    final height = stillBgr.rows.toDouble();
    final guide = _guideRectForFrame(width, height);
    final corners = [
      math.Point<double>(guide.left, guide.top),
      math.Point<double>(guide.left + guide.width, guide.top),
      math.Point<double>(guide.left + guide.width, guide.top + guide.height),
      math.Point<double>(guide.left, guide.top + guide.height),
    ];
    return PerspectiveCropper.cropAndEncode(
      stillBgr,
      corners: corners,
      outputWidth: documentType.outputWidth,
      outputHeight: documentType.outputHeight,
    );
  }

  /// Guide rect in upright frame coordinates, mirroring the on-screen
  /// overlay geometry (`DocumentGuideLayout`).
  math.Rectangle<double> _guideRectForFrame(double width, double height) {
    const widthFrac = DocumentGuideLayout.widthFrac;
    const centerYFrac = DocumentGuideLayout.centerYFrac;
    var guideW = width * widthFrac;
    var guideH = guideW / documentType.aspectRatio;
    final maxH = height * 0.6;
    if (guideH > maxH) {
      guideH = maxH;
      guideW = guideH * documentType.aspectRatio;
    }
    return math.Rectangle<double>(
      (width - guideW) / 2,
      height * centerYFrac - guideH / 2,
      guideW,
      guideH,
    );
  }

  (double, double) _uprightSize(BufferedFrame frame) {
    final rotated = frame.rotationDegrees % 180 != 0;
    return rotated
        ? (frame.height.toDouble(), frame.width.toDouble())
        : (frame.width.toDouble(), frame.height.toDouble());
  }

  static math.Point<double> _centroid(List<math.Point<double>> pts) {
    var sx = 0.0, sy = 0.0;
    for (final p in pts) {
      sx += p.x;
      sy += p.y;
    }
    return math.Point<double>(sx / pts.length, sy / pts.length);
  }
}
