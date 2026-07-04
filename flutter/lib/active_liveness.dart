/// iApp eKYC SDK — face active-liveness flow.
///
/// ```dart
/// import 'package:iapp_ekyc_sdk/active_liveness.dart';
///
/// final result = await ActiveLivenessView.start(
///   context,
///   client: IappEkycClient(apiKey: '...'),
/// );
/// if (result != null && result.passed) { /* verified */ }
/// ```
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
export 'src/core/i18n/ekyc_strings.dart';
export 'src/core/theme/ekyc_theme.dart';
