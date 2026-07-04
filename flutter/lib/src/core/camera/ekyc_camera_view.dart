import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart'
    show
        InputImage,
        InputImageFormat,
        InputImageFormatValue,
        InputImageMetadata,
        InputImageRotation,
        InputImageRotationValue;

import 'frame_throttler.dart';

/// One camera stream frame plus the context needed to interpret it.
class EkycCameraFrame {
  final CameraImage image;
  final CameraDescription camera;
  final DeviceOrientation deviceOrientation;

  const EkycCameraFrame({
    required this.image,
    required this.camera,
    required this.deviceOrientation,
  });

  int get width => image.width;
  int get height => image.height;

  bool get isFrontCamera => camera.lensDirection == CameraLensDirection.front;

  static const Map<DeviceOrientation, int> _orientations = {
    DeviceOrientation.portraitUp: 0,
    DeviceOrientation.landscapeLeft: 90,
    DeviceOrientation.portraitDown: 180,
    DeviceOrientation.landscapeRight: 270,
  };

  /// Clockwise rotation (0/90/180/270) that maps the raw buffer to an
  /// upright image, compensating for sensor orientation and, on Android,
  /// the current device orientation. This matches the rotation handed to
  /// ML Kit.
  int get rotationDegrees {
    final sensorOrientation = camera.sensorOrientation;
    if (Platform.isIOS) {
      return sensorOrientation;
    }
    final deviceRotation = _orientations[deviceOrientation] ?? 0;
    if (isFrontCamera) {
      return (sensorOrientation + deviceRotation) % 360;
    }
    return (sensorOrientation - deviceRotation + 360) % 360;
  }

  /// Frame size after upright rotation — the coordinate space ML Kit
  /// results live in.
  Size get uprightSize {
    final rotation = rotationDegrees;
    if (!Platform.isIOS && (rotation == 90 || rotation == 270)) {
      return Size(image.height.toDouble(), image.width.toDouble());
    }
    return Size(image.width.toDouble(), image.height.toDouble());
  }

  /// Converts this frame to an ML Kit [InputImage] following the
  /// google_mlkit_* 0.13.x single-plane pattern (NV21 on Android,
  /// BGRA8888 on iOS). Returns `null` for unsupported formats.
  InputImage? toInputImage() {
    final rotation = InputImageRotationValue.fromRawValue(rotationDegrees);
    if (rotation == null) return null;

    final format = InputImageFormatValue.fromRawValue(image.format.raw);
    if (format == null ||
        (Platform.isAndroid && format != InputImageFormat.nv21) ||
        (Platform.isIOS && format != InputImageFormat.bgra8888)) {
      return null;
    }
    if (image.planes.isEmpty) return null;
    final plane = image.planes.first;

    return InputImage.fromBytes(
      bytes: plane.bytes,
      metadata: InputImageMetadata(
        size: Size(image.width.toDouble(), image.height.toDouble()),
        rotation: rotation, // used on Android only
        format: format, // used on iOS only
        bytesPerRow: plane.bytesPerRow, // used on iOS only
      ),
    );
  }

  /// The [InputImageRotation] for painters/translators.
  InputImageRotation? get inputImageRotation =>
      InputImageRotationValue.fromRawValue(rotationDegrees);
}

/// Called for every frame that passes the throttler.
typedef EkycFrameProcessor = Future<void> Function(EkycCameraFrame frame);

/// Reusable camera widget: front/back camera at [ResolutionPreset.high],
/// audio disabled, NV21 (Android) / BGRA8888 (iOS) stream with a ≤ 10 fps
/// busy-flag throttler, cover-scaled preview.
class EkycCameraView extends StatefulWidget {
  final CameraLensDirection lensDirection;

  /// Frame processor, invoked under the throttler. Heavy work here simply
  /// causes intermediate frames to be dropped, never queued.
  final EkycFrameProcessor onFrame;

  /// Called once the controller is initialized (e.g. for `takePicture`).
  final ValueChanged<CameraController>? onControllerReady;

  /// Called when the camera cannot be started. The first argument is an
  /// i18n key (`camera_permission_denied` / `camera_error`).
  final void Function(String messageKey, Object error)? onError;

  /// Optional custom throttler (defaults to 10 fps).
  final FrameThrottler? throttler;

  const EkycCameraView({
    super.key,
    required this.lensDirection,
    required this.onFrame,
    this.onControllerReady,
    this.onError,
    this.throttler,
  });

  @override
  State<EkycCameraView> createState() => _EkycCameraViewState();
}

class _EkycCameraViewState extends State<EkycCameraView>
    with WidgetsBindingObserver {
  CameraController? _controller;
  CameraDescription? _camera;
  late final FrameThrottler _throttler = widget.throttler ?? FrameThrottler();
  bool _streaming = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _start();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stop();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      _stop();
    } else if (state == AppLifecycleState.resumed && _controller == null) {
      _start();
    }
  }

  Future<void> _start() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        widget.onError?.call('camera_error', StateError('No cameras'));
        return;
      }
      // Prefer the legacy-proven sensorOrientation == 90 module when
      // several cameras share the requested lens direction.
      final matching = cameras
          .where((c) => c.lensDirection == widget.lensDirection)
          .toList();
      final camera = matching.isEmpty
          ? cameras.first
          : matching.firstWhere(
              (c) => c.sensorOrientation == 90,
              orElse: () => matching.first,
            );
      _camera = camera;

      final controller = CameraController(
        camera,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: Platform.isAndroid
            ? ImageFormatGroup.nv21
            : ImageFormatGroup.bgra8888,
      );
      _controller = controller;
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      await controller.startImageStream(_onImage);
      _streaming = true;
      widget.onControllerReady?.call(controller);
      setState(() {});
    } on CameraException catch (e) {
      final denied =
          e.code == 'CameraAccessDenied' ||
          e.code == 'CameraAccessDeniedWithoutPrompt' ||
          e.code == 'cameraPermission';
      widget.onError?.call(
        denied ? 'camera_permission_denied' : 'camera_error',
        e,
      );
    } catch (e) {
      widget.onError?.call('camera_error', e);
    }
  }

  Future<void> _stop() async {
    final controller = _controller;
    _controller = null;
    if (controller == null) return;
    try {
      if (_streaming && controller.value.isStreamingImages) {
        await controller.stopImageStream();
      }
    } catch (_) {
      // Already stopped.
    }
    _streaming = false;
    await controller.dispose();
  }

  void _onImage(CameraImage image) {
    final controller = _controller;
    final camera = _camera;
    if (controller == null || camera == null) return;
    final frame = EkycCameraFrame(
      image: image,
      camera: camera,
      deviceOrientation: controller.value.deviceOrientation,
    );
    // Drop (never queue) frames while busy or over the fps budget.
    _throttler.run(() => widget.onFrame(frame));
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      return const ColoredBox(color: Colors.black);
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        // Cover-scale the preview (camera reports landscape aspect).
        var scale = size.aspectRatio * controller.value.aspectRatio;
        if (scale < 1) scale = 1 / scale;
        return ColoredBox(
          color: Colors.black,
          child: ClipRect(
            child: Transform.scale(
              scale: scale,
              child: Center(child: CameraPreview(controller)),
            ),
          ),
        );
      },
    );
  }
}
