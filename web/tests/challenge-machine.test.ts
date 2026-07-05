/**
 * ChallengeMachine scenario tests (docs/ACTIVE_LIVENESS.md) with an
 * injectable RNG + clock and scripted FaceObservation streams.
 */
import { describe, expect, it } from 'vitest';
import {
  ChallengeMachine,
  type ChallengeMachineConfig,
  type FaceObservation,
} from '../src/active-liveness/challenge-machine';

/** Deterministic clock, advanced manually between frames. */
function makeClock(start = 1_767_500_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    get time() {
      return t;
    },
  };
}

/** RNG replaying a fixed sequence (then 0s). */
function rngFromSequence(seq: number[]): () => number {
  let i = 0;
  return () => (i < seq.length ? seq[i++] : 0);
}

const face = (overrides: Partial<FaceObservation> = {}): FaceObservation => ({
  count: 1,
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  leftEyeOpen: 0.95,
  rightEyeOpen: 0.95,
  smile: 0.05,
  faceWidthFrac: 0.4,
  centerOffsetFrac: 0.02,
  ...overrides,
});

const NO_FACE = face({
  count: 0,
  leftEyeOpen: 0,
  rightEyeOpen: 0,
  faceWidthFrac: 0,
  centerOffsetFrac: 1,
});

interface Rig {
  machine: ChallengeMachine;
  clock: ReturnType<typeof makeClock>;
  /** Process one frame then advance the clock by `frameMs` (default 100). */
  frame: (obs: FaceObservation, frameMs?: number) => ReturnType<ChallengeMachine['process']>;
  frames: (obs: FaceObservation, n: number, frameMs?: number) => void;
}

/**
 * rng [0, 0, 0.6] over pool [blink, turnLeft, turnRight, smile] draws:
 * blink (idx 0 of 4), turnLeft (idx 0 of 3), smile (idx 1 of 2).
 */
function makeRig(config: Partial<ChallengeMachineConfig> = {}): Rig {
  const clock = makeClock();
  const machine = new ChallengeMachine({
    rng: rngFromSequence([0, 0, 0.6]),
    now: clock.now,
    sessionId: '00000000-0000-4000-8000-000000000000',
    ...config,
  });
  const frame: Rig['frame'] = (obs, frameMs = 100) => {
    const snap = machine.process(obs);
    clock.advance(frameMs);
    return snap;
  };
  return {
    machine,
    clock,
    frame,
    frames: (obs, n, frameMs = 100) => {
      for (let i = 0; i < n; i++) frame(obs, frameMs);
    },
  };
}

/** Drive findFace to completion (20 consecutive frontal frames). */
function passFindFace(rig: Rig): void {
  rig.frames(face(), 20);
  expect(rig.machine.state.phase).toBe('challenge');
}

function completeBlink(rig: Rig): void {
  rig.frame(face({ leftEyeOpen: 0.05, rightEyeOpen: 0.05 })); // closed
  rig.frame(face({ leftEyeOpen: 0.05, rightEyeOpen: 0.05 }));
  rig.frame(face()); // reopened within 1.5 s
}

function completeTurnLeft(rig: Rig): void {
  rig.frame(face({ yawDeg: 10 }));
  rig.frame(face({ yawDeg: 20 })); // delta >= +18 from baseline 0
  rig.frame(face({ yawDeg: 20 }));
  rig.frame(face({ yawDeg: 5 })); // returned to |yaw| < 12
}

function completeSmile(rig: Rig): void {
  for (let i = 0; i < 7; i++) rig.frame(face({ smile: 0.9 })); // >= 500 ms
}

describe('ChallengeMachine — happy path', () => {
  it('walks init → findFace → 3 challenges → recenter → capture', () => {
    const rig = makeRig();
    expect(rig.machine.state.phase).toBe('init');
    rig.machine.start();
    expect(rig.machine.state.phase).toBe('findFace');

    passFindFace(rig);
    expect(rig.machine.state.currentChallenge).toBe('blink');

    completeBlink(rig);
    expect(rig.machine.state.phase).toBe('challenge');
    expect(rig.machine.state.currentChallenge).toBe('turnLeft');

    completeTurnLeft(rig);
    expect(rig.machine.state.currentChallenge).toBe('smile');

    completeSmile(rig);
    expect(rig.machine.state.phase).toBe('recenter');

    rig.frames(face(), 20);
    expect(rig.machine.state.phase).toBe('capture');

    const completed = rig.machine.completedChallenges;
    expect(completed.map((c) => c.type)).toEqual(['blink', 'turnLeft', 'smile']);
    expect(completed.every((c) => c.passed)).toBe(true);
    // Real wall-clock times, strictly monotonic.
    for (const c of completed) expect(c.completedAt).toBeGreaterThan(c.issuedAt);
    for (let i = 1; i < completed.length; i++) {
      expect(completed[i].issuedAt).toBeGreaterThanOrEqual(completed[i - 1].completedAt);
    }
    expect(rig.machine.finishedAt).toBeGreaterThan(rig.machine.startedAt);
  });

  it('findFace requires 20 CONSECUTIVE frontal frames', () => {
    const rig = makeRig();
    rig.machine.start();
    rig.frames(face(), 19);
    rig.frame(NO_FACE); // breaks the run
    expect(rig.machine.state.phase).toBe('findFace');
    rig.frames(face(), 19);
    expect(rig.machine.state.phase).toBe('findFace');
    rig.frame(face());
    expect(rig.machine.state.phase).toBe('challenge');
  });

  it('rejects off-center / too-small / turned faces during findFace', () => {
    const rig = makeRig();
    rig.machine.start();
    rig.frames(face({ faceWidthFrac: 0.2 }), 25); // too small
    expect(rig.machine.state.phase).toBe('findFace');
    rig.frames(face({ yawDeg: 16 }), 25); // |yaw| >= 15
    expect(rig.machine.state.phase).toBe('findFace');
    rig.frames(face({ pitchDeg: 13 }), 25); // |pitch| >= 12
    expect(rig.machine.state.phase).toBe('findFace');
    rig.frames(face({ centerOffsetFrac: 0.2 }), 25); // off center
    expect(rig.machine.state.phase).toBe('findFace');
  });

  it('draws distinct challenges from the pool', () => {
    for (let seed = 0; seed < 20; seed++) {
      const clock = makeClock();
      let s = seed + 1;
      const lcg = () => {
        s = (s * 48271) % 2147483647;
        return s / 2147483647;
      };
      const machine = new ChallengeMachine({ rng: lcg, now: clock.now });
      machine.start();
      for (let i = 0; i < 20; i++) {
        machine.process(face());
        clock.advance(100);
      }
      const drawn: string[] = [];
      // Walk all three challenges via snapshots.
      for (let c = 0; c < 3; c++) {
        const snap = machine.state;
        expect(snap.phase).toBe('challenge');
        const type = snap.currentChallenge;
        expect(type).not.toBeNull();
        drawn.push(type as string);
        // Complete whatever was drawn.
        if (type === 'blink') {
          machine.process(face({ leftEyeOpen: 0.05, rightEyeOpen: 0.05 }));
          clock.advance(300);
          machine.process(face());
          clock.advance(100);
        } else if (type === 'turnLeft' || type === 'turnRight') {
          const yaw = type === 'turnLeft' ? 25 : -25;
          machine.process(face({ yawDeg: yaw }));
          clock.advance(300);
          machine.process(face({ yawDeg: 0 }));
          clock.advance(100);
        } else {
          machine.process(face({ smile: 0.95 }));
          clock.advance(600);
          machine.process(face({ smile: 0.95 }));
          clock.advance(100);
        }
      }
      expect(new Set(drawn).size).toBe(3); // distinct
    }
  });
});

describe('ChallengeMachine — blink specifics', () => {
  const blinkRig = () => {
    const rig = makeRig(); // first challenge drawn = blink
    rig.machine.start();
    passFindFace(rig);
    expect(rig.machine.state.currentChallenge).toBe('blink');
    return rig;
  };

  it('PHOTO ATTACK: eyes stay closed and never reopen — must NOT complete', () => {
    const rig = blinkRig();
    // 15+ s of closed-eye frames (a printed photo of closed eyes).
    for (let i = 0; i < 160 && rig.machine.state.phase === 'challenge'; i++) {
      rig.frame(face({ leftEyeOpen: 0.05, rightEyeOpen: 0.05 }));
      // The challenge must never be marked complete.
      expect(rig.machine.completedChallenges.length).toBe(0);
    }
    // Timeout eventually fails the session; blink never passed.
    expect(rig.machine.state.phase).toBe('failed');
    expect(rig.machine.state.failReason).toBe('timeout');
    expect(rig.machine.completedChallenges.length).toBe(0);
  });

  it('reopen must happen within 1.5 s of the closed sample', () => {
    const rig = blinkRig();
    rig.frame(face({ leftEyeOpen: 0.05, rightEyeOpen: 0.05 }));
    // Eyes half-open (neither closed nor open) for > 1.5 s...
    for (let i = 0; i < 20; i++) rig.frame(face({ leftEyeOpen: 0.5, rightEyeOpen: 0.5 }));
    rig.frame(face()); // ...then fully open — too late.
    expect(rig.machine.state.currentChallenge).toBe('blink');
    expect(rig.machine.completedChallenges.length).toBe(0);
    // A fresh close → open inside the window completes it.
    rig.frame(face({ leftEyeOpen: 0.05, rightEyeOpen: 0.05 }));
    rig.frame(face());
    expect(rig.machine.completedChallenges.map((c) => c.type)).toEqual(['blink']);
  });

  it('one eye closed is not a blink', () => {
    const rig = blinkRig();
    rig.frame(face({ leftEyeOpen: 0.05, rightEyeOpen: 0.9 }));
    rig.frame(face());
    expect(rig.machine.completedChallenges.length).toBe(0);
  });

  it('GLASSES: shallow blink is detected via the adaptive baseline', () => {
    // A glasses user whose eye-open blendshape idles at ~0.55 and only dips
    // to ~0.28 when blinking — invisible to the absolute 0.2/0.7 thresholds.
    const rig = makeRig();
    rig.machine.start();
    const glassesFace = { leftEyeOpen: 0.55, rightEyeOpen: 0.55 };
    for (let i = 0; i < 25; i++) rig.frame(face(glassesFace));
    expect(rig.machine.state.currentChallenge).toBe('blink');
    // baseline ≈ 0.55 → closed < ~0.30, reopen > ~0.47.
    rig.frame(face({ leftEyeOpen: 0.28, rightEyeOpen: 0.28 }));
    rig.frame(face({ leftEyeOpen: 0.5, rightEyeOpen: 0.5 }));
    expect(rig.machine.completedChallenges.map((c) => c.type)).toEqual(['blink']);
  });
});

describe('ChallengeMachine — turn specifics', () => {
  it('turnRight needs yaw delta <= -18 then return to |yaw| < 12', () => {
    // rng [0.6, 0.6, 0] over [blink,turnLeft,turnRight,smile]:
    // idx 2 of 4 -> turnRight; then turnLeft... just verify the first.
    const rig = makeRig({ rng: rngFromSequence([0.6, 0, 0]) });
    rig.machine.start();
    passFindFace(rig);
    expect(rig.machine.state.currentChallenge).toBe('turnRight');
    rig.frame(face({ yawDeg: -10 })); // not enough
    expect(rig.machine.completedChallenges.length).toBe(0);
    rig.frame(face({ yawDeg: -20 })); // excursion
    expect(rig.machine.completedChallenges.length).toBe(0); // not yet returned
    rig.frame(face({ yawDeg: -13 })); // still |yaw| >= 12
    expect(rig.machine.completedChallenges.length).toBe(0);
    rig.frame(face({ yawDeg: -5 })); // returned
    expect(rig.machine.completedChallenges.map((c) => c.type)).toEqual(['turnRight']);
  });

  it('turning the WRONG way never completes the challenge', () => {
    const rig = makeRig({ rng: rngFromSequence([0.6, 0, 0]) }); // turnRight
    rig.machine.start();
    passFindFace(rig);
    rig.frame(face({ yawDeg: 25 })); // turned LEFT instead
    rig.frame(face({ yawDeg: 0 }));
    expect(rig.machine.completedChallenges.length).toBe(0);
    expect(rig.machine.state.currentChallenge).toBe('turnRight');
  });
});

describe('ChallengeMachine — anti-cheat', () => {
  const startedChallenge = () => {
    const rig = makeRig();
    rig.machine.start();
    passFindFace(rig);
    return rig;
  };

  it('face lost > 1 s restarts the current challenge', () => {
    const rig = startedChallenge();
    expect(rig.machine.state.restarts).toBe(0);
    rig.frames(NO_FACE, 12); // 1.2 s without a face
    expect(rig.machine.state.phase).toBe('challenge');
    expect(rig.machine.state.currentChallenge).toBe('blink'); // same challenge
    expect(rig.machine.state.restarts).toBe(1);
    // The challenge still completes after the restart.
    rig.frame(face({ leftEyeOpen: 0.05, rightEyeOpen: 0.05 }));
    rig.frame(face());
    expect(rig.machine.completedChallenges.map((c) => c.type)).toEqual(['blink']);
  });

  it('brief face loss (<= 1 s) does NOT restart', () => {
    const rig = startedChallenge();
    rig.frames(NO_FACE, 9); // 0.9 s
    rig.frame(face());
    expect(rig.machine.state.restarts).toBe(0);
  });

  it('multiple faces restart immediately', () => {
    const rig = startedChallenge();
    rig.frame(face({ count: 2 }));
    expect(rig.machine.state.restarts).toBe(1);
    expect(rig.machine.state.phase).toBe('challenge');
  });

  it('3 restarts of one challenge fail the session', () => {
    const rig = startedChallenge();
    rig.frames(NO_FACE, 12); // restart 1
    rig.frame(face());
    rig.frames(NO_FACE, 12); // restart 2
    rig.frame(face());
    expect(rig.machine.state.restarts).toBe(2);
    rig.frames(NO_FACE, 12); // restart 3 -> failed
    expect(rig.machine.state.phase).toBe('failed');
    expect(rig.machine.state.failReason).toBe('tooManyRestarts');
  });

  it('15 s per-challenge timeout fails the session', () => {
    const rig = startedChallenge();
    // Neutral face frames — no blink ever happens.
    for (let i = 0; i < 155 && rig.machine.state.phase === 'challenge'; i++) {
      rig.frame(face());
    }
    expect(rig.machine.state.phase).toBe('failed');
    expect(rig.machine.state.failReason).toBe('timeout');
  });

  it('restart resets challenge progress (turn excursion forgotten)', () => {
    const rig = makeRig({ rng: rngFromSequence([0.3, 0, 0]) }); // turnLeft first
    rig.machine.start();
    passFindFace(rig);
    expect(rig.machine.state.currentChallenge).toBe('turnLeft');
    rig.frame(face({ yawDeg: 25 })); // excursion reached...
    rig.frames(NO_FACE, 12); // ...but the face is lost -> restart
    expect(rig.machine.state.restarts).toBe(1);
    rig.frame(face({ yawDeg: 5 })); // would complete if `turned` survived
    expect(rig.machine.completedChallenges.length).toBe(0);
  });
});

describe('ChallengeMachine — misc', () => {
  it('observations are ignored after failure', () => {
    const rig = makeRig();
    rig.machine.start();
    passFindFace(rig);
    for (let i = 0; i < 160 && rig.machine.state.phase !== 'failed'; i++) rig.frame(face());
    expect(rig.machine.state.phase).toBe('failed');
    const snap = rig.machine.process(face());
    expect(snap.phase).toBe('failed');
  });

  it('markFinalizing/markDone drive the post-capture phases', () => {
    const rig = makeRig();
    rig.machine.start();
    passFindFace(rig);
    completeBlink(rig);
    completeTurnLeft(rig);
    completeSmile(rig);
    rig.frames(face(), 20);
    expect(rig.machine.state.phase).toBe('capture');
    rig.machine.markFinalizing();
    expect(rig.machine.state.phase).toBe('finalizing');
    rig.machine.markDone();
    expect(rig.machine.state.phase).toBe('done');
  });

  it('challengeCount larger than the pool throws', () => {
    expect(
      () => new ChallengeMachine({ challengeCount: 5 }),
    ).toThrow();
  });
});
