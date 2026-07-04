/**
 * Canonical challenge-log wire shape — must match docs/ACTIVE_LIVENESS.md
 * exactly (snake_case field names, epoch-ms timestamps).
 */
import { describe, expect, it } from 'vitest';
import {
  ChallengeMachine,
  CHALLENGE_WIRE_TYPE,
  type FaceObservation,
} from '../src/active-liveness/challenge-machine';

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

function runHappySession() {
  let t = 1_767_500_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  // rng zeros -> blink, turnLeft, turnRight.
  const machine = new ChallengeMachine({
    rng: () => 0,
    now: clock.now,
    sessionId: 'b0e7aaaa-1111-4222-8333-444455556666',
  });
  machine.start();
  const step = (obs: FaceObservation, ms = 100) => {
    machine.process(obs);
    clock.advance(ms);
  };
  for (let i = 0; i < 20; i++) step(face()); // findFace
  step(face({ leftEyeOpen: 0.05, rightEyeOpen: 0.05 }), 400); // blink close
  step(face()); // blink open
  step(face({ yawDeg: 25 }), 400); // turnLeft excursion
  step(face({ yawDeg: 2 })); // turnLeft return
  step(face({ yawDeg: -25 }), 400); // turnRight excursion
  step(face({ yawDeg: -2 })); // turnRight return
  for (let i = 0; i < 20; i++) step(face()); // recenter
  expect(machine.state.phase).toBe('capture');
  return machine;
}

describe('challenge log wire schema', () => {
  it('serializes exactly the documented snake_case shape', () => {
    const machine = runHappySession();
    const log = machine.buildChallengeLog({
      name: 'iapp-ekyc-sdk-web',
      version: '0.1.0',
      platform: 'web',
    });

    // Top-level keys — exact set.
    expect(Object.keys(log).sort()).toEqual([
      'challenges',
      'finished_at',
      'sdk',
      'session_id',
      'started_at',
    ]);
    expect(Object.keys(log.sdk).sort()).toEqual(['name', 'platform', 'version']);
    expect(log.sdk).toEqual({
      name: 'iapp-ekyc-sdk-web',
      version: '0.1.0',
      platform: 'web',
    });
    expect(log.session_id).toBe('b0e7aaaa-1111-4222-8333-444455556666');

    // Challenge entries — exact key set and wire type values.
    expect(log.challenges).toHaveLength(3);
    for (const entry of log.challenges) {
      expect(Object.keys(entry).sort()).toEqual([
        'completed_at',
        'issued_at',
        'passed',
        'type',
      ]);
      expect(['blink', 'turn_left', 'turn_right', 'smile']).toContain(entry.type);
      expect(entry.passed).toBe(true);
      // Per-challenge duration sanity (server enforces 300 ms – 30 s).
      expect(entry.completed_at - entry.issued_at).toBeGreaterThanOrEqual(300);
      expect(entry.completed_at - entry.issued_at).toBeLessThanOrEqual(30_000);
    }
    expect(log.challenges.map((c) => c.type)).toEqual(['blink', 'turn_left', 'turn_right']);

    // Timestamps: epoch ms, strictly monotonic across the session.
    expect(log.started_at).toBeGreaterThan(1_700_000_000_000);
    expect(log.finished_at).toBeGreaterThan(log.started_at);
    let previous = log.started_at;
    for (const entry of log.challenges) {
      expect(entry.issued_at).toBeGreaterThanOrEqual(previous);
      expect(entry.completed_at).toBeGreaterThan(entry.issued_at);
      previous = entry.completed_at;
    }
    expect(log.finished_at).toBeGreaterThanOrEqual(previous);

    // JSON round-trip keeps snake_case (what actually goes on the wire).
    const wire = JSON.parse(JSON.stringify(log));
    expect(wire.challenges[0].issued_at).toBeTypeOf('number');
    expect(wire.challenges[0].type).toBe('blink');
  });

  it('maps camelCase code enums to snake_case wire values', () => {
    expect(CHALLENGE_WIRE_TYPE).toEqual({
      blink: 'blink',
      turnLeft: 'turn_left',
      turnRight: 'turn_right',
      smile: 'smile',
    });
  });
});
