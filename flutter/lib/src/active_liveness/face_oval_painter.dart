import 'package:flutter/widgets.dart';

import '../core/theme/ekyc_theme.dart';

/// Paints the scrim with an oval face cut-out plus the oval stroke,
/// colored by the current flow state.
class FaceOvalPainter extends CustomPainter {
  final EkycTheme theme;

  /// Oval center as a fraction of the canvas.
  final Offset centerFrac;

  /// Oval width as a fraction of the canvas width.
  final double widthFrac;

  /// Oval height/width ratio.
  final double aspect;

  /// Stroke color for the oval (state-dependent).
  final Color strokeColor;

  const FaceOvalPainter({
    required this.theme,
    required this.strokeColor,
    this.centerFrac = const Offset(0.5, 0.45),
    this.widthFrac = 0.72,
    this.aspect = 1.35,
  });

  /// The oval rect for a given canvas size (shared with hit-testing and
  /// guide math).
  Rect ovalRect(Size size) {
    final width = size.width * widthFrac;
    final height = width * aspect;
    return Rect.fromCenter(
      center: Offset(size.width * centerFrac.dx, size.height * centerFrac.dy),
      width: width,
      height: height,
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    final oval = ovalRect(size);

    final scrim = Path.combine(
      PathOperation.difference,
      Path()..addRect(Offset.zero & size),
      Path()..addOval(oval),
    );
    canvas.drawPath(scrim, Paint()..color = theme.overlayScrim);

    canvas.drawOval(
      oval,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = theme.guideStrokeWidth
        ..color = strokeColor,
    );
  }

  @override
  bool shouldRepaint(FaceOvalPainter oldDelegate) =>
      oldDelegate.strokeColor != strokeColor ||
      oldDelegate.theme != theme ||
      oldDelegate.centerFrac != centerFrac ||
      oldDelegate.widthFrac != widthFrac ||
      oldDelegate.aspect != aspect;
}
