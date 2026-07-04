/// iApp eKYC SDK for Flutter — umbrella export.
///
/// Modular entry points are also available to keep imports narrow:
/// - `package:iapp_ekyc_sdk/document_capture.dart`
/// - `package:iapp_ekyc_sdk/active_liveness.dart`
/// - `package:iapp_ekyc_sdk/face_api.dart`
library;

export 'src/active_liveness/active_liveness_view.dart';
export 'src/active_liveness/best_frame_selector.dart';
export 'src/active_liveness/challenge.dart';
export 'src/active_liveness/challenge_state_machine.dart';
export 'src/active_liveness/face_metrics.dart';
export 'src/active_liveness/face_observation.dart';
export 'src/active_liveness/face_oval_painter.dart';
export 'src/core/api/ekyc_api_client.dart';
export 'src/core/api/ekyc_exception.dart';
export 'src/core/api/models/active_liveness_result.dart';
export 'src/core/api/models/document_result.dart';
export 'src/core/api/models/face_verification_result.dart';
export 'src/core/api/models/passive_liveness_result.dart';
export 'src/core/camera/coordinate_translator.dart';
export 'src/core/camera/ekyc_camera_view.dart';
export 'src/core/camera/frame_throttler.dart';
export 'src/core/i18n/ekyc_strings.dart';
export 'src/core/theme/ekyc_theme.dart';
export 'src/document_capture/document_capture_controller.dart'
    show
        DocumentCaptureController,
        DocumentCaptureState,
        DocumentCaptureStateKey;
export 'src/document_capture/document_capture_view.dart';
export 'src/document_capture/document_overlay_painter.dart';
export 'src/document_capture/document_type.dart';
export 'src/vision/quad_geometry.dart';
export 'src/vision/stability_tracker.dart';
