/// iApp eKYC SDK — document auto-capture flow.
///
/// ```dart
/// import 'package:iapp_ekyc_sdk/document_capture.dart';
///
/// final result = await DocumentCaptureView.start(
///   context,
///   client: IappEkycClient(apiKey: '...'),
///   documentType: DocumentType.thaiIdFront,
/// );
/// ```
library;

export 'src/core/api/ekyc_api_client.dart';
export 'src/core/api/ekyc_exception.dart';
export 'src/core/api/models/document_result.dart';
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
