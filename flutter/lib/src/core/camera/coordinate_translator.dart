import 'dart:io';
import 'dart:ui';

import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart'
    show InputImageRotation;

/// Translates detector coordinates (in the camera image's coordinate
/// space) to widget/canvas coordinates, accounting for the stream
/// rotation. Ported from the legacy `painters/coordinates_translator.dart`
/// and updated to the google_mlkit_* 0.13.x API.
double translateX(
  double x,
  InputImageRotation rotation,
  Size canvasSize,
  Size absoluteImageSize,
) {
  switch (rotation) {
    case InputImageRotation.rotation90deg:
      return x *
          canvasSize.width /
          (Platform.isIOS ? absoluteImageSize.width : absoluteImageSize.height);
    case InputImageRotation.rotation270deg:
      return canvasSize.width -
          x *
              canvasSize.width /
              (Platform.isIOS
                  ? absoluteImageSize.width
                  : absoluteImageSize.height);
    case InputImageRotation.rotation0deg:
    case InputImageRotation.rotation180deg:
      return x * canvasSize.width / absoluteImageSize.width;
  }
}

/// See [translateX].
double translateY(
  double y,
  InputImageRotation rotation,
  Size canvasSize,
  Size absoluteImageSize,
) {
  switch (rotation) {
    case InputImageRotation.rotation90deg:
    case InputImageRotation.rotation270deg:
      return y *
          canvasSize.height /
          (Platform.isIOS ? absoluteImageSize.height : absoluteImageSize.width);
    case InputImageRotation.rotation0deg:
    case InputImageRotation.rotation180deg:
      return y * canvasSize.height / absoluteImageSize.height;
  }
}
