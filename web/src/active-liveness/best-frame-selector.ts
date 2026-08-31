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
  /** 12: looking slightly down at a hand-held phone is the natural pose. */
  maxAbsPitchDeg: number;
  /**
   * Eyes-open gate. A fixed "both eyes > 0.8" never passed for a user with
   * glasses (glare compresses the blink blendshape to ~0.6-0.7 open), so a
   * whole session ended with NO candidate and the full 1080p frame was
   * uploaded instead of a face crop. Now: absolute floors that separate
   * "open" from "mid-blink", plus a relative rule against the user's own
   * open-eye baseline so a wide-eyed user's half-closed frames still lose.
   */
  minMeanEyeOpen: number;
  minEitherEyeOpen: number;
  minEyeOpenFracOfBaseline: number;
  minFaceWidthFrac: number;
}

export const DEFAULT_BEST_FRAME_CONFIG: BestFrameSelectorConfig = {
  maxAbsYawDeg: 10,
  maxAbsPitchDeg: 12,
  minMeanEyeOpen: 0.5,
  minEitherEyeOpen: 0.35,
  minEyeOpenFracOfBaseline: 0.8,
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
  /** EMA of the user's own open-eye level (mean of both eyes); null until seeded. */
  private eyeBaseline: number | null = null;

  constructor(config: Partial<BestFrameSelectorConfig> = {}) {
    this.cfg = { ...DEFAULT_BEST_FRAME_CONFIG, ...config };
  }

  /**
   * Feed every single-face frame so the eyes-open rule can be relative to
   * THIS user. Same rules as the challenge machine's blink baseline: seeded
   * by the first frame above 0.3, never pulled down by blinks (samples
   * below 80% of the baseline are ignored).
   */
  track(obs: FaceObservation): void {
    if (obs.count !== 1) return;
    const mean = (obs.leftEyeOpen + obs.rightEyeOpen) / 2;
    if (this.eyeBaseline === null) {
      if (mean > 0.3) this.eyeBaseline = mean;
      return;
    }
    if (mean >= this.eyeBaseline * 0.8) this.eyeBaseline = this.eyeBaseline * 0.8 + mean * 0.2;
  }

  /** Candidate gate: frontal, eyes open (see config), close enough. */
  isCandidate(obs: FaceObservation): boolean {
    const mean = (obs.leftEyeOpen + obs.rightEyeOpen) / 2;
    const weaker = Math.min(obs.leftEyeOpen, obs.rightEyeOpen);
    const relativeOk =
      this.eyeBaseline === null || mean >= this.eyeBaseline * this.cfg.minEyeOpenFracOfBaseline;
    return (
      obs.count === 1 &&
      Math.abs(obs.yawDeg) < this.cfg.maxAbsYawDeg &&
      Math.abs(obs.pitchDeg) < this.cfg.maxAbsPitchDeg &&
      mean >= this.cfg.minMeanEyeOpen &&
      weaker >= this.cfg.minEitherEyeOpen &&
      relativeOk &&
      obs.faceWidthFrac >= this.cfg.minFaceWidthFrac
    );
  }

  /**
   * score = laplacianVariance x faceWidthFrac^2 x (0.5 + 0.5 x mean eye
   * openness): among sharp, close frames prefer the one with the eyes most
   * open.
   */
  score(laplacianVar: number, obs: FaceObservation): number {
    const mean = (obs.leftEyeOpen + obs.rightEyeOpen) / 2;
    return laplacianVar * obs.faceWidthFrac * obs.faceWidthFrac * (0.5 + 0.5 * mean);
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
    this.eyeBaseline = null;
  }
}
