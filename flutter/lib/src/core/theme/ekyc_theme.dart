import 'dart:ui';

/// Immutable design tokens for all iApp eKYC SDK UI.
///
/// `EkycTheme` is a plain immutable class — it has no dependency on
/// `Theme.of`, so it works in any app regardless of Material/Cupertino
/// setup. Token names and default values are identical to the Web SDK
/// (see docs/THEMING.md).
///
/// ```dart
/// const theme = EkycTheme.lightBlue;             // default
/// final custom = EkycTheme.lightBlue.copyWith(
///   primary: Color(0xFF113F7B),
///   borderRadius: 12,
/// );
/// ```
class EkycTheme {
  /// Buttons, active guide frame, progress indicators.
  final Color primary;

  /// Headings, instruction text.
  final Color primaryDark;

  /// Idle guide frame, subtle accents.
  final Color primaryLight;

  /// Sheets, instruction chips.
  final Color surface;

  /// Text/icons drawn on [primary].
  final Color onPrimary;

  /// Quad locked, challenge passed.
  final Color success;

  /// Hold still / too blurry.
  final Color warning;

  /// Failures.
  final Color error;

  /// Camera overlay outside the guide (already includes alpha).
  final Color overlayScrim;

  /// Optional iApp brand accent.
  final Color brandDeep;

  /// Chips, buttons, result cards.
  final double borderRadius;

  /// Guide frame stroke width.
  final double guideStrokeWidth;

  /// Optional font family override; `null` = platform default.
  final String? fontFamily;

  const EkycTheme({
    this.primary = const Color(0xFF0284C7),
    this.primaryDark = const Color(0xFF0C4A6E),
    this.primaryLight = const Color(0xFFBAE6FD),
    this.surface = const Color(0xFFF0F9FF),
    this.onPrimary = const Color(0xFFFFFFFF),
    this.success = const Color(0xFF22C55E),
    this.warning = const Color(0xFFF59E0B),
    this.error = const Color(0xFFEF4444),
    this.overlayScrim = const Color(0x990C4A6E), // #0C4A6E at 60%
    this.brandDeep = const Color(0xFF113F7B),
    this.borderRadius = 16,
    this.guideStrokeWidth = 3,
    this.fontFamily,
  });

  /// The default light-blue theme shared with the Web SDK.
  static const EkycTheme lightBlue = EkycTheme();

  EkycTheme copyWith({
    Color? primary,
    Color? primaryDark,
    Color? primaryLight,
    Color? surface,
    Color? onPrimary,
    Color? success,
    Color? warning,
    Color? error,
    Color? overlayScrim,
    Color? brandDeep,
    double? borderRadius,
    double? guideStrokeWidth,
    String? fontFamily,
  }) {
    return EkycTheme(
      primary: primary ?? this.primary,
      primaryDark: primaryDark ?? this.primaryDark,
      primaryLight: primaryLight ?? this.primaryLight,
      surface: surface ?? this.surface,
      onPrimary: onPrimary ?? this.onPrimary,
      success: success ?? this.success,
      warning: warning ?? this.warning,
      error: error ?? this.error,
      overlayScrim: overlayScrim ?? this.overlayScrim,
      brandDeep: brandDeep ?? this.brandDeep,
      borderRadius: borderRadius ?? this.borderRadius,
      guideStrokeWidth: guideStrokeWidth ?? this.guideStrokeWidth,
      fontFamily: fontFamily ?? this.fontFamily,
    );
  }
}
