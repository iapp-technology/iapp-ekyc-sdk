/**
 * Best-frame selection — docs/ACTIVE_LIVENESS.md.
 *
 * Runs across the ENTIRE session: every processed frame with exactly one
 * face, |yaw| < 10 deg, |pitch| < 10 deg, both eyes > 0.8 and
 * faceWidthFrac >= 0.25 is a candidate, scored
 * `laplacianVariance x faceWidthFrac^2`. The final selfie is the argmax.
 *
 * The Laplacian variance here is a small pure-TS implementation (3x3
 * kernel on the luma channel) so the liveness flow does not need to load
 * OpenCV at all.
 */
import type { FaceObservation } from './challenge-machine';

export interface BestFrameSelectorConfig {
  maxAbsYawDeg: number;
  maxAbsPitchDeg: number;
  minEyeOpen: number;
  minFaceWidthFrac: number;
}

export const DEFAULT_BEST_FRAME_CONFIG: BestFrameSelectorConfig = {
  maxAbsYawDeg: 10,
  maxAbsPitchDeg: 10,
  minEyeOpen: 0.8,
  minFaceWidthFrac: 0.25,
};

/**
 * Variance of a 3x3 Laplacian ([0,1,0; 1,-4,1; 0,1,0]) over the luma of an
 * RGBA buffer. Pure TS equivalent of the OpenCV Laplacian-variance
 * sharpness score used elsewhere in the pipeline.
 */
export function laplacianVarianceRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) return 0;
  // Rec. 601 luma.
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  let sum = 0;
  let sumSq = 0;
  const n = (width - 2) * (height - 2);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const v =
        luma[i - width] + luma[i - 1] + luma[i + 1] + luma[i + width] - 4 * luma[i];
      sum += v;
      sumSq += v * v;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export class BestFrameSelector<TPayload> {
  private readonly cfg: BestFrameSelectorConfig;
  private bestScore = -Infinity;
  private bestPayload: TPayload | null = null;

  constructor(config: Partial<BestFrameSelectorConfig> = {}) {
    this.cfg = { ...DEFAULT_BEST_FRAME_CONFIG, ...config };
  }

  /** Candidate gate per the spec (frontal, eyes open, close enough). */
  isCandidate(obs: FaceObservation): boolean {
    return (
      obs.count === 1 &&
      Math.abs(obs.yawDeg) < this.cfg.maxAbsYawDeg &&
      Math.abs(obs.pitchDeg) < this.cfg.maxAbsPitchDeg &&
      obs.leftEyeOpen > this.cfg.minEyeOpen &&
      obs.rightEyeOpen > this.cfg.minEyeOpen &&
      obs.faceWidthFrac >= this.cfg.minFaceWidthFrac
    );
  }

  /** score = laplacianVariance x faceWidthFrac^2 */
  score(laplacianVar: number, obs: FaceObservation): number {
    return laplacianVar * obs.faceWidthFrac * obs.faceWidthFrac;
  }

  /**
   * Offer a scored frame; it is kept iff it beats the current best.
   * Returns true when the frame became the new best.
   */
  offer(score: number, payload: TPayload): boolean {
    if (score <= this.bestScore) return false;
    this.bestScore = score;
    this.bestPayload = payload;
    return true;
  }

  get best(): { score: number; payload: TPayload } | null {
    return this.bestPayload === null
      ? null
      : { score: this.bestScore, payload: this.bestPayload };
  }

  reset(): void {
    this.bestScore = -Infinity;
    this.bestPayload = null;
  }
}
