import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart'
    show Face;
import 'package:opencv_dart/opencv_dart.dart' as cv;

import '../core/api/ekyc_api_client.dart';
import '../core/api/ekyc_exception.dart';
import '../core/api/models/active_liveness_result.dart';
import '../core/camera/ekyc_camera_view.dart';
import '../core/i18n/ekyc_strings.dart';
import '../core/theme/ekyc_theme.dart';
import '../vision/blur_scorer.dart';
import '../vision/perspective_cropper.dart';
import '../vision/quad_detector.dart';
import 'best_frame_selector.dart';
import 'challenge_state_machine.dart';
import 'face_metrics.dart';
import 'face_oval_painter.dart';

/// SDK identity reported in the challenge log.
const String kSdkName = 'iapp-ekyc-sdk-flutter';
const String kSdkVersion = '0.1.0';

/// Retained pixel data for the winning selfie candidate.
class _CandidateFrame {
  final Uint8List bytes; // NV21 (Android) or BGRA8888 (iOS), copied.
  final int width;
  final int height;
  final int rotationDegrees;
  final Rect faceBox; // In detector coordinate space.

  const _CandidateFrame({
    required this.bytes,
    required this.width,
    required this.height,
    required this.rotationDegrees,
    required this.faceBox,
  });
}

/// Full-screen active-liveness flow: oval guide, randomized challenges,
/// best-frame selfie selection and server-side finalization.
class ActiveLivenessView extends StatefulWidget {
  final IappEkycClient client;
  final EkycTheme theme;
  final EkycLocale locale;
  final Map<String, String>? stringOverrides;

  /// Ask the server to echo the selfie back as base64.
  final bool returnImage;

  const ActiveLivenessView({
    super.key,
    required this.client,
    this.theme = EkycTheme.lightBlue,
    this.locale = EkycLocale.en,
    this.stringOverrides,
    this.returnImage = false,
  });

  /// Pushes the flow full-screen. Resolves with the signed
  /// [ActiveLivenessResult], or `null` when the user cancelled.
  static Future<ActiveLivenessResult?> start(
    BuildContext context, {
    required IappEkycClient client,
    EkycTheme? theme,
    EkycLocale locale = EkycLocale.en,
    Map<String, String>? stringOverrides,
    bool returnImage = false,
  }) {
    return Navigator.of(context).push<ActiveLivenessResult>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => ActiveLivenessView(
          client: client,
          theme: theme ?? EkycTheme.lightBlue,
          locale: locale,
          stringOverrides: stringOverrides,
          returnImage: returnImage,
        ),
      ),
    );
  }

  @override
  State<ActiveLivenessView> createState() => _ActiveLivenessViewState();
}

class _ActiveLivenessViewState extends State<ActiveLivenessView> {
  late final EkycStrings _strings = EkycStrings.of(
    widget.locale,
    overrides: widget.stringOverrides,
  );

  late final _faceDetector = createLivenessFaceDetector();
  late ChallengeStateMachine _machine;
  late BestFrameSelector<_CandidateFrame> _selector;
  _CandidateFrame? _fallbackFrame;

  String _instructionKey = 'position_face';
  String? _errorMessage;
  bool _busy = false; // Finalizing / uploading.
  bool _sessionOver = false; // Stop feeding frames.

  @override
  void initState() {
    super.initState();
    _resetSession();
  }

  void _resetSession() {
    _machine = ChallengeStateMachine(random: math.Random.secure());
    _machine.start();
    _selector = BestFrameSelector<_CandidateFrame>();
    _fallbackFrame = null;
    _instructionKey = 'position_face';
    _errorMessage = null;
    _busy = false;
    _sessionOver = false;
  }

  @override
  void dispose() {
    _faceDetector.close();
    super.dispose();
  }

  // -------------------------------------------------------------------
  // Frame processing
  // -------------------------------------------------------------------

  Future<void> _onFrame(EkycCameraFrame frame) async {
    if (_sessionOver || !mounted) return;

    final inputImage = frame.toInputImage();
    if (inputImage == null) return;

    final faces = await _faceDetector.processImage(inputImage);
    if (_sessionOver || !mounted) return;

    final obs = faceObservationFrom(
      faces,
      frameSize: frame.uprightSize,
      isAndroid: Platform.isAndroid,
    );

    // Best-frame candidates accumulate across the ENTIRE session.
    if (faces.isNotEmpty && _selector.qualifies(obs)) {
      _offerCandidate(frame, faces, obs);
    }

    final update = _machine.process(obs);

    // Keep a relaxed fallback frame during recenter in case no strict
    // candidate ever qualified.
    if (update.phase == LivenessPhase.recenter &&
        !_selector.hasCandidate &&
        faces.length == 1) {
      _fallbackFrame = _copyFrame(frame, faces.first.boundingBox);
    }

    if (update.instructionKey != _instructionKey && mounted) {
      setState(() => _instructionKey = update.instructionKey);
    } else if (update.event != LivenessEvent.none && mounted) {
      setState(() {});
    }

    if (update.event == LivenessEvent.readyToCapture) {
      _sessionOver = true;
      await _finalize();
    } else if (update.event == LivenessEvent.failed) {
      _sessionOver = true;
      if (mounted) {
        setState(() => _errorMessage = _strings.get(update.instructionKey));
      }
    }
  }

  void _offerCandidate(
    EkycCameraFrame frame,
    List<Face> faces,
    FaceObservation obs,
  ) {
    final box = faces.first.boundingBox;
    double sharpness;
    cv.Mat? gray;
    cv.Mat? upright;
    try {
      gray = _grayFromFrame(frame);
      if (gray == null) return;
      upright = QuadDetector.rotateUpright(gray, frame.rotationDegrees);
      final cropRect = _detectorBoxToUprightRect(
        frame,
        box,
        upright.cols,
        upright.rows,
      );
      final roi = upright.region(cropRect);
      try {
        sharpness = laplacianVariance(roi);
      } finally {
        roi.dispose();
      }
    } catch (_) {
      return; // Never let scoring break the flow.
    } finally {
      upright?.dispose();
      gray?.dispose();
    }

    _selector.offer(
      obs,
      laplacianVariance: sharpness,
      frameBuilder: () => _copyFrame(frame, box),
    );
  }

  cv.Mat? _grayFromFrame(EkycCameraFrame frame) {
    final image = frame.image;
    if (image.planes.isEmpty) return null;
    final plane = image.planes.first;
    if (Platform.isAndroid) {
      return QuadDetector.grayFromNv21Y(
        plane.bytes,
        image.width,
        image.height,
        strideBytes: plane.bytesPerRow,
      );
    }
    return QuadDetector.grayFromBgra(
      plane.bytes,
      image.width,
      image.height,
      strideBytes: plane.bytesPerRow,
    );
  }

  /// Maps a detector-space bounding box to a clamped rect in upright Mat
  /// coordinates. On Android the detector space IS upright space; on iOS
  /// the detector space is the raw buffer, so rotate the rect.
  cv.Rect _detectorBoxToUprightRect(
    EkycCameraFrame frame,
    Rect box,
    int uprightW,
    int uprightH,
  ) {
    Rect mapped = box;
    if (Platform.isIOS) {
      final rotation = frame.rotationDegrees % 360;
      final w = frame.image.width.toDouble();
      final h = frame.image.height.toDouble();
      mapped = switch (rotation) {
        90 => Rect.fromLTRB(h - box.bottom, box.left, h - box.top, box.right),
        180 => Rect.fromLTRB(
          w - box.right,
          h - box.bottom,
          w - box.left,
          h - box.top,
        ),
        270 => Rect.fromLTRB(box.top, w - box.right, box.bottom, w - box.left),
        _ => box,
      };
    }
    final x = mapped.left.floor().clamp(0, uprightW - 2);
    final y = mapped.top.floor().clamp(0, uprightH - 2);
    final w = mapped.width.ceil().clamp(1, uprightW - x);
    final h = mapped.height.ceil().clamp(1, uprightH - y);
    return cv.Rect(x, y, w, h);
  }

  _CandidateFrame _copyFrame(EkycCameraFrame frame, Rect faceBox) {
    final image = frame.image;
    // The camera plugin reuses stream buffers — retain a copy.
    final bytes = Uint8List.fromList(image.planes.first.bytes);
    return _CandidateFrame(
      bytes: bytes,
      width: image.width,
      height: image.height,
      rotationDegrees: frame.rotationDegrees,
      faceBox: faceBox,
    );
  }

  // -------------------------------------------------------------------
  // Selfie + finalize
  // -------------------------------------------------------------------

  Future<void> _finalize() async {
    final candidate = _selector.bestFrame ?? _fallbackFrame;
    if (candidate == null) {
      _machine.failSession(LivenessFailureReason.finalizeError);
      if (mounted) {
        setState(() => _errorMessage = _strings.get('liveness_failed'));
      }
      return;
    }

    if (mounted) setState(() => _busy = true);

    Uint8List selfie;
    try {
      selfie = _buildSelfieJpeg(candidate);
    } catch (_) {
      _machine.failSession(LivenessFailureReason.finalizeError);
      if (mounted) {
        setState(() {
          _busy = false;
          _errorMessage = _strings.get('error_generic');
        });
      }
      return;
    }

    _machine.beginFinalizing();
    final challengeLog = _machine.buildChallengeLog(
      sessionId: _uuidV4(),
      sdkName: kSdkName,
      sdkVersion: kSdkVersion,
      platform: Platform.isAndroid ? 'android' : 'ios',
    );

    try {
      final result = await widget.client.finalizeActiveLiveness(
        selfie,
        challengeLog,
        returnImage: widget.returnImage,
      );
      _machine.completeSession();
      if (mounted) Navigator.of(context).pop(result);
    } on EkycException catch (e) {
      _machine.failSession(LivenessFailureReason.finalizeError);
      if (mounted) {
        setState(() {
          _busy = false;
          _errorMessage = _strings.get(e.userMessageKey);
        });
      }
    }
  }

  /// Converts the retained frame to upright BGR, crops the face box
  /// expanded by 40% margin, and encodes JPEG q92.
  Uint8List _buildSelfieJpeg(_CandidateFrame candidate) {
    cv.Mat color;
    if (Platform.isAndroid) {
      color = QuadDetector.bgrFromNv21(
        candidate.bytes,
        candidate.width,
        candidate.height,
      );
    } else {
      final bgra = cv.Mat.fromList(
        candidate.height,
        candidate.width,
        cv.MatType.CV_8UC4,
        candidate.bytes.length == candidate.width * candidate.height * 4
            ? candidate.bytes
            : Uint8List.sublistView(
                candidate.bytes,
                0,
                candidate.width * candidate.height * 4,
              ),
      );
      color = cv.cvtColor(bgra, cv.COLOR_BGRA2BGR);
      bgra.dispose();
    }

    final upright = QuadDetector.rotateUpright(
      color,
      candidate.rotationDegrees,
    );
    color.dispose();
    try {
      // Detector space == upright space on Android; on iOS the detector
      // space is the raw buffer, so rotate the box into upright space.
      final mappedBox = Platform.isIOS
          ? _rotateRect(
              candidate.faceBox,
              candidate.rotationDegrees,
              candidate.width.toDouble(),
              candidate.height.toDouble(),
            )
          : candidate.faceBox;

      final expanded = Rect.fromLTRB(
        mappedBox.left - mappedBox.width * 0.4,
        mappedBox.top - mappedBox.height * 0.4,
        mappedBox.right + mappedBox.width * 0.4,
        mappedBox.bottom + mappedBox.height * 0.4,
      );
      final x = expanded.left.floor().clamp(0, upright.cols - 2);
      final y = expanded.top.floor().clamp(0, upright.rows - 2);
      final w = expanded.width.ceil().clamp(1, upright.cols - x);
      final h = expanded.height.ceil().clamp(1, upright.rows - y);
      final crop = upright.region(cv.Rect(x, y, w, h));
      try {
        return PerspectiveCropper.encodeJpeg(crop);
      } finally {
        crop.dispose();
      }
    } finally {
      upright.dispose();
    }
  }

  static Rect _rotateRect(Rect box, int rotationDegrees, double w, double h) {
    return switch (rotationDegrees % 360) {
      90 => Rect.fromLTRB(h - box.bottom, box.left, h - box.top, box.right),
      180 => Rect.fromLTRB(
        w - box.right,
        h - box.bottom,
        w - box.left,
        h - box.top,
      ),
      270 => Rect.fromLTRB(box.top, w - box.right, box.bottom, w - box.left),
      _ => box,
    };
  }

  static String _uuidV4() {
    final rng = math.Random.secure();
    final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4.
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10.
    String hex(int b) => b.toRadixString(16).padLeft(2, '0');
    final s = bytes.map(hex).join();
    return '${s.substring(0, 8)}-${s.substring(8, 12)}-'
        '${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20)}';
  }

  // -------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------

  Color get _strokeColor {
    switch (_machine.phase) {
      case LivenessPhase.findFace:
        return widget.theme.primaryLight;
      case LivenessPhase.challenge:
      case LivenessPhase.recenter:
        return widget.theme.primary;
      case LivenessPhase.capture:
      case LivenessPhase.finalizing:
      case LivenessPhase.done:
        return widget.theme.success;
      case LivenessPhase.failed:
        return widget.theme.error;
      case LivenessPhase.init:
        return widget.theme.primaryLight;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;
    final radius = BorderRadius.circular(theme.borderRadius);

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          EkycCameraView(
            lensDirection: CameraLensDirection.front,
            onFrame: _onFrame,
            onError: (key, error) {
              if (mounted) {
                setState(() => _errorMessage = _strings.get(key));
              }
            },
          ),
          IgnorePointer(
            child: CustomPaint(
              painter: FaceOvalPainter(theme: theme, strokeColor: _strokeColor),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: IconButton(
                    icon: Icon(Icons.close, color: theme.onPrimary),
                    tooltip: _strings.get('cancel'),
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                ),
                const Spacer(),
                _progressDots(theme),
                const SizedBox(height: 12),
                _instructionChip(theme, radius),
                const SizedBox(height: 32),
              ],
            ),
          ),
          if (_busy)
            ColoredBox(
              color: Colors.black45,
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(color: theme.primary),
                    const SizedBox(height: 16),
                    Text(
                      _strings.get('finalizing'),
                      style: TextStyle(
                        color: theme.onPrimary,
                        fontSize: 16,
                        fontFamily: theme.fontFamily,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (_errorMessage != null) _errorOverlay(theme, radius),
        ],
      ),
    );
  }

  Widget _progressDots(EkycTheme theme) {
    final total = _machine.challenges.isEmpty ? 3 : _machine.challenges.length;
    final completed = _machine.log.length;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < total; i++)
          Container(
            width: 10,
            height: 10,
            margin: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: i < completed ? theme.success : theme.primaryLight,
            ),
          ),
      ],
    );
  }

  Widget _instructionChip(EkycTheme theme, BorderRadius radius) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 24),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(color: theme.surface, borderRadius: radius),
      child: Text(
        _strings.get(_instructionKey),
        textAlign: TextAlign.center,
        style: TextStyle(
          color: theme.primaryDark,
          fontSize: 16,
          fontWeight: FontWeight.w600,
          fontFamily: theme.fontFamily,
        ),
      ),
    );
  }

  Widget _errorOverlay(EkycTheme theme, BorderRadius radius) {
    return ColoredBox(
      color: Colors.black54,
      child: Center(
        child: Container(
          margin: const EdgeInsets.all(24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(color: theme.surface, borderRadius: radius),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, color: theme.error, size: 48),
              const SizedBox(height: 12),
              Text(
                _errorMessage!,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: theme.primaryDark,
                  fontSize: 16,
                  fontFamily: theme.fontFamily,
                ),
              ),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: Text(
                      _strings.get('cancel'),
                      style: TextStyle(color: theme.primaryDark),
                    ),
                  ),
                  const SizedBox(width: 12),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: theme.primary,
                      foregroundColor: theme.onPrimary,
                      shape: RoundedRectangleBorder(borderRadius: radius),
                    ),
                    onPressed: () => setState(_resetSession),
                    child: Text(_strings.get('try_again')),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
