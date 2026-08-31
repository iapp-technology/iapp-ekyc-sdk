/**
 * Instruction cues: a short tone and a vibration pulse whenever the
 * on-screen instruction changes, so the user does not have to keep reading
 * the chip mid-flow (field feedback: instruction changes went unnoticed and
 * the flow felt stuck).
 *
 * Everything here is best-effort and silent on failure: WebAudio may be
 * suspended until a user gesture (the flow is always started by one, but
 * some WebViews still deny it) and navigator.vibrate does not exist on iOS.
 * Neither ever affects the flow itself.
 */

export type CueKind = 'instruction' | 'challenge' | 'success' | 'failure';

export interface CuePreferences {
  /** Tones on instruction changes and results (default true). */
  sound?: boolean;
  /** Vibration pulses on the same events (default true; no-op on iOS). */
  vibrate?: boolean;
}

let audioCtx: AudioContext | null = null;
let lastInstructionCueAt = 0;

/** Instruction cues are rate-limited so rapid hint flapping stays calm. */
const MIN_INSTRUCTION_GAP_MS = 350;

type AudioContextCtor = new () => AudioContext;

function context(): AudioContext | null {
  try {
    const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function tone(ctx: AudioContext, freq: number, startMs: number, durMs: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + startMs / 1000;
  const t1 = t0 + durMs / 1000;
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Short attack/release envelope so the tone does not click.
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.08, t0 + 0.01);
  gain.gain.setValueAtTime(0.08, t1 - 0.02);
  gain.gain.linearRampToValueAtTime(0, t1);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.01);
}

function vibrate(pattern: number | number[]): void {
  try {
    (navigator as { vibrate?: (p: number | number[]) => boolean }).vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

/** Play one cue. Never throws. */
export function playCue(kind: CueKind, prefs?: CuePreferences): void {
  try {
    if (kind === 'instruction') {
      const now = Date.now();
      if (now - lastInstructionCueAt < MIN_INSTRUCTION_GAP_MS) return;
      lastInstructionCueAt = now;
    }
    if (prefs?.vibrate !== false) {
      vibrate(kind === 'failure' ? [70, 50, 70] : kind === 'success' ? [40, 40, 40] : 40);
    }
    if (prefs?.sound === false) return;
    const ctx = context();
    if (!ctx) return;
    switch (kind) {
      case 'instruction':
        tone(ctx, 660, 0, 70);
        break;
      case 'challenge':
        tone(ctx, 784, 0, 70);
        tone(ctx, 988, 90, 90);
        break;
      case 'success':
        tone(ctx, 660, 0, 90);
        tone(ctx, 880, 100, 150);
        break;
      case 'failure':
        tone(ctx, 220, 0, 220);
        break;
    }
  } catch {
    /* cues are never allowed to break the flow */
  }
}

/** Test hook. */
export function resetFeedbackForTests(): void {
  audioCtx = null;
  lastInstructionCueAt = 0;
}
