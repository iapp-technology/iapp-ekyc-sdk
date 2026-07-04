/**
 * Stability tracker per docs/ALGORITHM.md step 9. Pure code, no OpenCV —
 * unit-tested against the shared vectors (tests/fixtures/vectors/stability.json).
 *
 * Sliding window over the last `windowSize` PROCESSED frames. A frame is
 * *stable* iff it was accepted AND its maximum corner displacement vs the
 * PREVIOUS ACCEPTED frame is < `maxCornerDriftFrac` of the frame diagonal.
 * The first accepted frame has no reference and is NOT stable.
 * The trigger fires when >= `minStableFrames` of the window are stable.
 */
import { maxCornerDistance, type Quad } from './geometry';

export interface StabilityTrackerOptions {
  frameWidth: number;
  frameHeight: number;
  /** Sliding window length (default 8). */
  windowSize?: number;
  /** Stable frames required within the window to trigger (default 6). */
  minStableFrames?: number;
  /** Max corner drift as a fraction of the frame diagonal (default 0.02). */
  maxCornerDriftFrac?: number;
}

export class StabilityTracker {
  private readonly windowSize: number;
  private readonly minStableFrames: number;
  private readonly maxDriftPx: number;

  /** Stable-flags for the last `windowSize` processed frames. */
  private window: boolean[] = [];
  private lastAcceptedCorners: Quad | null = null;
  private latched = false;

  constructor(options: StabilityTrackerOptions) {
    this.windowSize = options.windowSize ?? 8;
    this.minStableFrames = options.minStableFrames ?? 6;
    const diagonal = Math.hypot(options.frameWidth, options.frameHeight);
    this.maxDriftPx = (options.maxCornerDriftFrac ?? 0.02) * diagonal;
  }

  /**
   * Record one processed frame: ordered quad corners, or null for a
   * rejected frame (no accepted quad).
   */
  push(corners: Quad | null): void {
    let stable = false;
    if (corners !== null) {
      if (this.lastAcceptedCorners !== null) {
        stable = maxCornerDistance(corners, this.lastAcceptedCorners) < this.maxDriftPx;
      }
      // First accepted frame: no reference -> NOT stable (spec rule).
      this.lastAcceptedCorners = corners;
    }
    this.window.push(stable);
    if (this.window.length > this.windowSize) this.window.shift();
    if (this.stableCount >= this.minStableFrames) this.latched = true;
  }

  /** Number of stable frames currently inside the window. */
  get stableCount(): number {
    let n = 0;
    for (const s of this.window) if (s) n++;
    return n;
  }

  /** 0..1 progress toward the trigger, for UI progress bars. */
  get progress(): number {
    return Math.min(1, this.stableCount / this.minStableFrames);
  }

  /** True once the trigger condition has been met (latched until reset). */
  get triggered(): boolean {
    return this.latched;
  }

  /** Clear all state (e.g. after a capture or a UX restart). */
  reset(): void {
    this.window = [];
    this.lastAcceptedCorners = null;
    this.latched = false;
  }
}
