/**
 * Perspective correction — docs/ALGORITHM.md step 12.
 * getPerspectiveTransform + warpPerspective(INTER_LINEAR) to the ~300 DPI
 * document size (1011x637 ID-1 / 1476x1039 passport), then JPEG q92.
 */
import type { CV, CvMat } from '../core/opencv-loader';
import type { Quad } from './geometry';

/** JPEG encode quality per the spec (0.92). */
export const JPEG_QUALITY = 0.92;
/** Uploads must stay under 10 MB (docs/API_CONTRACTS.md). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Warp `sourceRgba` (CV_8UC4) so `corners` (TL,TR,BR,BL in source coords)
 * map onto a `outWidth` x `outHeight` rectangle. Caller deletes the result.
 */
export function warpQuad(
  cv: CV,
  sourceRgba: CvMat,
  corners: Quad,
  outWidth: number,
  outHeight: number,
): CvMat {
  const [tl, tr, br, bl] = corners;
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x, tl.y,
    tr.x, tr.y,
    br.x, br.y,
    bl.x, bl.y,
  ]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    outWidth, 0,
    outWidth, outHeight,
    0, outHeight,
  ]);
  const transform = cv.getPerspectiveTransform(srcPts, dstPts);
  const dst = new cv.Mat();
  cv.warpPerspective(sourceRgba, dst, transform, new cv.Size(outWidth, outHeight));
  srcPts.delete();
  dstPts.delete();
  transform.delete();
  return dst;
}

/**
 * Encode an RGBA mat to a JPEG Blob via a canvas (browser only).
 * Quality defaults to the spec's 0.92.
 */
export function matToJpegBlob(mat: CvMat, quality: number = JPEG_QUALITY): Promise<Blob> {
  const width = mat.cols;
  const height = mat.rows;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not create 2D canvas context'));
  const imageData = new ImageData(new Uint8ClampedArray(mat.data), width, height);
  ctx.putImageData(imageData, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null'));
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Full step-12 helper: warp `sourceRgba` by `corners` and encode to JPEG.
 */
export async function warpToJpegBlob(
  cv: CV,
  sourceRgba: CvMat,
  corners: Quad,
  outWidth: number,
  outHeight: number,
  quality: number = JPEG_QUALITY,
): Promise<Blob> {
  const warped = warpQuad(cv, sourceRgba, corners, outWidth, outHeight);
  try {
    return await matToJpegBlob(warped, quality);
  } finally {
    warped.delete();
  }
}
