/**
 * Best-frame candidate gate and scoring (docs/ACTIVE_LIVENESS.md).
 *
 * Regression cover for a session on a Galaxy A12 where a user with glasses
 * never produced a candidate under "both eyes > 0.8", so the selfie sent to
 * the server was the whole 1080p frame instead of a face crop.
 */
import { describe, expect, it } from 'vitest';
import { BestFrameSelector } from '../src/active-liveness/best-frame-selector';
import type { FaceObservation } from '../src/active-liveness/challenge-machine';

const face = (o: Partial<FaceObservation> = {}): FaceObservation => ({
  count: 1,
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  leftEyeOpen: 0.95,
  rightEyeOpen: 0.95,
  smile: 0,
  faceWidthFrac: 0.4,
  centerOffsetFrac: 0.02,
  ...o,
});

describe('BestFrameSelector candidate gate', () => {
  it('accepts glasses-compressed eye openness (0.6 / 0.65)', () => {
    const s = new BestFrameSelector();
    const glasses = face({ leftEyeOpen: 0.6, rightEyeOpen: 0.65 });
    s.track(glasses);
    expect(s.isCandidate(glasses)).toBe(true);
  });

  it('rejects a mid-blink frame', () => {
    const s = new BestFrameSelector();
    expect(s.isCandidate(face({ leftEyeOpen: 0.15, rightEyeOpen: 0.12 }))).toBe(false);
  });

  it('rejects one eye nearly shut even if the other is wide open', () => {
    const s = new BestFrameSelector();
    expect(s.isCandidate(face({ leftEyeOpen: 0.9, rightEyeOpen: 0.3 }))).toBe(false);
  });

  it('a wide-eyed user still loses half-closed frames (relative rule)', () => {
    const s = new BestFrameSelector();
    for (let i = 0; i < 10; i++) s.track(face()); // baseline ~0.95
    const drowsy = face({ leftEyeOpen: 0.6, rightEyeOpen: 0.6 }); // above the floors ...
    expect(s.isCandidate(drowsy)).toBe(false); // ... but < 80% of THIS user's baseline
    expect(s.isCandidate(face({ leftEyeOpen: 0.85, rightEyeOpen: 0.85 }))).toBe(true);
  });

  it('pitch tolerance is 12 degrees (phone held below eye level)', () => {
    const s = new BestFrameSelector();
    expect(s.isCandidate(face({ pitchDeg: 11 }))).toBe(true);
    expect(s.isCandidate(face({ pitchDeg: 13 }))).toBe(false);
    expect(s.isCandidate(face({ yawDeg: 11 }))).toBe(false);
  });

  it('never a candidate with a second person or a small face', () => {
    const s = new BestFrameSelector();
    expect(s.isCandidate(face({ count: 2 }))).toBe(false);
    expect(s.isCandidate(face({ faceWidthFrac: 0.2 }))).toBe(false);
  });
});

describe('BestFrameSelector scoring', () => {
  it('prefers the more open-eyed frame at equal sharpness and size', () => {
    const s = new BestFrameSelector();
    const open = s.score(100, face({ leftEyeOpen: 0.9, rightEyeOpen: 0.9 }));
    const squint = s.score(100, face({ leftEyeOpen: 0.5, rightEyeOpen: 0.5 }));
    expect(open).toBeGreaterThan(squint);
  });

  it('still scales with sharpness and face size squared', () => {
    const s = new BestFrameSelector();
    expect(s.score(200, face())).toBeGreaterThan(s.score(100, face()));
    expect(s.score(100, face({ faceWidthFrac: 0.5 }))).toBeGreaterThan(
      s.score(100, face({ faceWidthFrac: 0.4 })),
    );
  });

  it('offer keeps only a strictly better frame; reset clears the baseline too', () => {
    const s = new BestFrameSelector<string>();
    expect(s.offer(10, 'a')).toBe(true);
    expect(s.offer(10, 'b')).toBe(false);
    expect(s.offer(11, 'c')).toBe(true);
    expect(s.best?.payload).toBe('c');
    for (let i = 0; i < 10; i++) s.track(face());
    s.reset();
    expect(s.best).toBeNull();
    // After reset the relative rule is dormant again: floors alone decide.
    expect(s.isCandidate(face({ leftEyeOpen: 0.6, rightEyeOpen: 0.6 }))).toBe(true);
  });
});
