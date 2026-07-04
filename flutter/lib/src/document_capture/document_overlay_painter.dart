import 'package:flutter/widgets.dart';

import '../core/theme/ekyc_theme.dart';

/// Fractions defining where the document guide rect sits, shared between
/// the on-screen overlay and the in-image detection guide so the two stay
/// aligned.
class DocumentGuideLayout {
  /// Guide width as a fraction of the frame width.
  static const double widthFrac = 0.85;

  /// Guide center Y as a fraction of the frame height.
  static const double centerYFrac = 0.45;

  /// Computes the guide rect for a frame/canvas of [size] and a document
  /// aspect ratio (width / height).
  static Rect guideRect(Size size, double aspectRatio) {
    var width = size.width * widthFrac;
    var height = width / aspectRatio;
    final maxHeight = size.height * 0.6;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspectRatio;
    }
    return Rect.fromCenter(
      center: Offset(size.width / 2, size.height * centerYFrac),
      width: width,
      height: height,
    );
  }
}

/// Paints the scrim outside a rounded document guide rect plus the guide
/// stroke, colored by the current capture state.
class DocumentOverlayPainter extends CustomPainter {
  final EkycTheme theme;

  /// Document aspect ratio (1.586 ID-1 / 1.42 passport).
  final double aspectRatio;

  /// Stroke color for the guide frame (state-dependent).
  final Color strokeColor;

  const DocumentOverlayPainter({
    required this.theme,
    required this.aspectRatio,
    required this.strokeColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final guide = DocumentGuideLayout.guideRect(size, aspectRatio);
    final rrect = RRect.fromRectAndRadius(
      guide,
      Radius.circular(theme.borderRadius),
    );

    final scrim = Path.combine(
      PathOperation.difference,
      Path()..addRect(Offset.zero & size),
      Path()..addRRect(rrect),
    );
    canvas.drawPath(scrim, Paint()..color = theme.overlayScrim);

    canvas.drawRRect(
      rrect,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = theme.guideStrokeWidth
        ..color = strokeColor,
    );
  }

  @override
  bool shouldRepaint(DocumentOverlayPainter oldDelegate) =>
      oldDelegate.strokeColor != strokeColor ||
      oldDelegate.aspectRatio != aspectRatio ||
      oldDelegate.theme != theme;
}
