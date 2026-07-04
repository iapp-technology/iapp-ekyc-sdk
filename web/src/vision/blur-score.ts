/**
 * Sharpness scoring — docs/ALGORITHM.md step 10.
 * Laplacian(CV_64F) variance over the quad's bounding-box crop of the
 * processed grayscale. Sharp iff score >= params.minSharpness (120).
 */
import type { CV, CvMat } from '../core/opencv-loader';
import type { Quad } from './geometry';

export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned bounding box of a quad, clamped to the mat dimensions. */
export function quadBoundingBox(quad: Quad, matWidth: number, matHeight: number): BoundsRect {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(matWidth, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(matHeight, Math.ceil(Math.max(...ys)));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/**
 * Laplacian variance of `gray` restricted to `bounds` (whole mat if omitted).
 * Higher = sharper. Returns 0 for degenerate crops.
 */
export function laplacianVariance(cv: CV, gray: CvMat, bounds?: BoundsRect): number {
  let roi: CvMat | null = null;
  const lap = new cv.Mat();
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  try {
    let src = gray;
    if (bounds) {
      const rect = new cv.Rect(
        Math.max(0, Math.floor(bounds.x)),
        Math.max(0, Math.floor(bounds.y)),
        Math.min(gray.cols - Math.max(0, Math.floor(bounds.x)), Math.floor(bounds.width)),
        Math.min(gray.rows - Math.max(0, Math.floor(bounds.y)), Math.floor(bounds.height)),
      );
      if (rect.width <= 0 || rect.height <= 0) return 0;
      roi = gray.roi(rect);
      src = roi;
    }
    cv.Laplacian(src, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, stddev);
    const sigma = stddev.data64F[0];
    return sigma * sigma;
  } finally {
    lap.delete();
    mean.delete();
    stddev.delete();
    if (roi) roi.delete();
  }
}
