import 'package:opencv_dart/opencv_dart.dart' as cv;

/// Sharpness scoring via variance of the Laplacian
/// (docs/ALGORITHM.md step 10).
///
/// Sharp iff `laplacianVariance(...) >= 120` (`minSharpness`).
double laplacianVariance(cv.Mat gray) {
  final lap = cv.laplacian(gray, cv.MatType.CV_64F);
  try {
    final (mean, stddev) = cv.meanStdDev(lap);
    final sigma = stddev.val1;
    mean.dispose();
    stddev.dispose();
    return sigma * sigma;
  } finally {
    lap.dispose();
  }
}
