import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:opencv_dart/opencv_dart.dart' as cv;

import '../core/api/ekyc_api_client.dart';
import '../core/api/ekyc_exception.dart';
import '../core/api/models/document_result.dart';
import '../core/camera/ekyc_camera_view.dart';
import '../core/i18n/ekyc_strings.dart';
import '../core/theme/ekyc_theme.dart';
import '../vision/quad_detector.dart';
import 'document_capture_controller.dart';
import 'document_overlay_painter.dart';
import 'document_type.dart';

/// Full-screen document auto-capture flow: guide overlay, live quad
/// detection, stability-gated auto-capture, perspective correction and
/// upload.
class DocumentCaptureView extends StatefulWidget {
  final IappEkycClient client;
  final DocumentType documentType;
  final EkycTheme theme;
  final EkycLocale locale;
  final Map<String, String>? stringOverrides;

  const DocumentCaptureView({
    super.key,
    required this.client,
    required this.documentType,
    this.theme = EkycTheme.lightBlue,
    this.locale = EkycLocale.en,
    this.stringOverrides,
  });

  /// Pushes the flow full-screen. Resolves with the OCR result (with
  /// [DocumentResult.capturedImage] set), or `null` when cancelled.
  static Future<DocumentResult?> start(
    BuildContext context, {
    required IappEkycClient client,
    required DocumentType documentType,
    EkycTheme? theme,
    EkycLocale locale = EkycLocale.en,
    Map<String, String>? stringOverrides,
  }) {
    return Navigator.of(context).push<DocumentResult>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => DocumentCaptureView(
          client: client,
          documentType: documentType,
          theme: theme ?? EkycTheme.lightBlue,
          locale: locale,
          stringOverrides: stringOverrides,
        ),
      ),
    );
  }

  @override
  State<DocumentCaptureView> createState() => _DocumentCaptureViewState();
}

class _DocumentCaptureViewState extends State<DocumentCaptureView> {
  late final EkycStrings _strings = EkycStrings.of(
    widget.locale,
    overrides: widget.stringOverrides,
  );
  late final DocumentCaptureController _controller = DocumentCaptureController(
    documentType: widget.documentType,
  );

  CameraController? _camera;
  Timer? _manualTimer;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onControllerChanged);
    _controller.startDetection();
    // Re-evaluate the manual-capture visibility once per second.
    _manualTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _manualTimer?.cancel();
    _controller.removeListener(_onControllerChanged);
    _controller.dispose();
    super.dispose();
  }

  void _onControllerChanged() {
    if (mounted) setState(() {});
  }

  // -------------------------------------------------------------------
  // Frame processing
  // -------------------------------------------------------------------

  Future<void> _onFrame(EkycCameraFrame frame) async {
    if (_controller.captureLatched || _errorMessage != null || !mounted) {
      return;
    }
    final image = frame.image;
    if (image.planes.isEmpty) return;
    final plane = image.planes.first;

    // Copy immediately — the camera plugin reuses stream buffers.
    final rawBytes = Uint8List.fromList(plane.bytes);
    final isNv21 = Platform.isAndroid;

    cv.Mat? gray;
    cv.Mat? upright;
    var shouldCapture = false;
    try {
      gray = isNv21
          ? QuadDetector.grayFromNv21Y(
              rawBytes,
              image.width,
              image.height,
              strideBytes: plane.bytesPerRow,
            )
          : QuadDetector.grayFromBgra(
              rawBytes,
              image.width,
              image.height,
              strideBytes: plane.bytesPerRow,
            );
      upright = QuadDetector.rotateUpright(gray, frame.rotationDegrees);
      shouldCapture = _controller.processFrame(
        upright,
        rawBytes: rawBytes,
        rawWidth: image.width,
        rawHeight: image.height,
        rotationDegrees: frame.rotationDegrees,
        isNv21: isNv21,
      );
    } catch (_) {
      return; // A single bad frame must never break the loop.
    } finally {
      upright?.dispose();
      gray?.dispose();
    }

    if (shouldCapture) {
      await _capture();
    }
  }

  // -------------------------------------------------------------------
  // Capture + upload
  // -------------------------------------------------------------------

  Future<void> _capture({bool manual = false}) async {
    Uint8List? jpeg;

    // Try the full-resolution still first (docs/ALGORITHM.md step 11).
    cv.Mat? still;
    try {
      final camera = _camera;
      if (camera != null && camera.value.isInitialized) {
        final shot = await camera.takePicture();
        final bytes = await shot.readAsBytes();
        still = cv.imdecode(bytes, cv.IMREAD_COLOR);
      }
    } catch (_) {
      still = null; // Fall back to the buffered stream frame.
    }

    try {
      if (still != null && !still.isEmpty) {
        jpeg = _controller.captureFromStill(still);
      }
      // Detection on the still failed → best buffered stream frame.
      jpeg ??= _controller.captureFromBestBufferedFrame();
      // Manual capture with no accepted quad ever → guide-region crop.
      if (jpeg == null && manual && still != null && !still.isEmpty) {
        jpeg = _controller.captureGuideRegion(still);
      }
    } catch (_) {
      jpeg = null;
    } finally {
      still?.dispose();
    }

    if (jpeg == null) {
      _showError(_strings.get('error_generic'));
      return;
    }
    await _upload(jpeg);
  }

  Future<void> _upload(Uint8List jpeg) async {
    _controller.setFlowState(DocumentCaptureState.uploading);
    try {
      final result = await widget.client.submitDocument(
        widget.documentType,
        jpeg,
      );
      _controller.setFlowState(DocumentCaptureState.done);
      if (mounted) {
        Navigator.of(context).pop(result.withCapturedImage(jpeg));
      }
    } on EkycException catch (e) {
      _showError(_strings.get(e.userMessageKey));
    }
  }

  void _showError(String message) {
    _controller.setFlowState(DocumentCaptureState.error);
    if (mounted) {
      setState(() => _errorMessage = message);
    }
  }

  void _retry() {
    setState(() => _errorMessage = null);
    _controller.startDetection();
  }

  // -------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------

  Color get _strokeColor {
    final theme = widget.theme;
    switch (_controller.state) {
      case DocumentCaptureState.searching:
        return theme.primaryLight;
      case DocumentCaptureState.holdStill:
        return theme.primary;
      case DocumentCaptureState.tooBlurry:
      case DocumentCaptureState.moveCloser:
      case DocumentCaptureState.alignCard:
        return theme.warning;
      case DocumentCaptureState.capturing:
      case DocumentCaptureState.uploading:
      case DocumentCaptureState.done:
        return theme.success;
      case DocumentCaptureState.error:
        return theme.error;
    }
  }

  bool get _busy =>
      _controller.state == DocumentCaptureState.capturing ||
      _controller.state == DocumentCaptureState.uploading;

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
            lensDirection: CameraLensDirection.back,
            onFrame: _onFrame,
            onControllerReady: (controller) => _camera = controller,
            onError: (key, error) => _showError(_strings.get(key)),
          ),
          IgnorePointer(
            child: CustomPaint(
              painter: DocumentOverlayPainter(
                theme: theme,
                aspectRatio: widget.documentType.aspectRatio,
                strokeColor: _strokeColor,
              ),
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
                _statusChip(theme, radius),
                const SizedBox(height: 16),
                if (_controller.manualCaptureAvailable &&
                    !_busy &&
                    _errorMessage == null)
                  _manualCaptureButton(theme, radius),
                const SizedBox(height: 32),
              ],
            ),
          ),
          if (_busy) _busyOverlay(theme),
          if (_errorMessage != null) _errorOverlay(theme, radius),
        ],
      ),
    );
  }

  Widget _statusChip(EkycTheme theme, BorderRadius radius) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 24),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(color: theme.surface, borderRadius: radius),
      child: Text(
        _strings.get(_controller.state.instructionKey),
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

  Widget _manualCaptureButton(EkycTheme theme, BorderRadius radius) {
    return FilledButton.icon(
      style: FilledButton.styleFrom(
        backgroundColor: theme.primary,
        foregroundColor: theme.onPrimary,
        shape: RoundedRectangleBorder(borderRadius: radius),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      ),
      onPressed: () {
        _controller.triggerManualCapture();
        _capture(manual: true);
      },
      icon: const Icon(Icons.camera_alt),
      label: Text(_strings.get('manual_capture')),
    );
  }

  Widget _busyOverlay(EkycTheme theme) {
    return ColoredBox(
      color: Colors.black45,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: theme.primary),
            const SizedBox(height: 16),
            Text(
              _strings.get(_controller.state.instructionKey),
              style: TextStyle(
                color: theme.onPrimary,
                fontSize: 16,
                fontFamily: theme.fontFamily,
              ),
            ),
          ],
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
                    onPressed: _retry,
                    child: Text(_strings.get('retry')),
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
