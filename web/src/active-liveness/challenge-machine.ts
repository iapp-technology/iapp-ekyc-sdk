/**
 * Active-liveness challenge state machine — docs/ACTIVE_LIVENESS.md.
 *
 * PURE code: no camera or ML imports; the RNG and clock are injectable so
 * every path is deterministic under test.
 *
 * `init → findFace → challenge[0..N-1] → recenter → capture → finalizing
 *  → done | failed`
 */
import type { ChallengeLogWire } from '../core/types';

export type { ChallengeLogWire };

/** Normalized face detector output (docs/ACTIVE_LIVENESS.md). */
export interface FaceObservation {
  /**
   * PEOPLE in frame, after phantom/duplicate/background filtering
   * (active-liveness/face-metrics.ts `selectFaces`). Every other field
   * describes the subject: the largest face in frame.
   */
  count: number;
  /** + = user turned to THEIR left. */
  yawDeg: number;
  /** + = looking up. */
  pitchDeg: number;
  rollDeg: number;
  /** 0..1 */
  leftEyeOpen: number;
  /** 0..1 */
  rightEyeOpen: number;
  /** 0..1 */
  smile: number;
  /** face bbox width / frame width. */
  faceWidthFrac: number;
  /** face center distance from oval center / frame width. */
  centerOffsetFrac: number;
  /**
   * Faces the detector reported before filtering. Diagnostics only — the
   * machine never reads it; support uses it to tell a real second person
   * (count 2) from a device emitting phantoms (count 1, rawFaceCount 2).
   */
  rawFaceCount?: number;
}

export type ChallengeType = 'blink' | 'turnLeft' | 'turnRight' | 'smile';

/** camelCase code enum -> snake_case wire value. */
export const CHALLENGE_WIRE_TYPE: Record<ChallengeType, 'blink' | 'turn_left' | 'turn_right' | 'smile'> = {
  blink: 'blink',
  turnLeft: 'turn_left',
  turnRight: 'turn_right',
  smile: 'smile',
};

export type MachinePhase =
  | 'init'
  | 'findFace'
  | 'challenge'
  | 'recenter'
  | 'capture'
  | 'finalizing'
  | 'done'
  | 'failed';

export type FailReason = 'timeout' | 'tooManyRestarts' | 'cancelled' | 'finalizeError';

export interface CompletedChallenge {
  type: ChallengeType;
  issuedAt: number;
  completedAt: number;
  passed: boolean;
}

export interface MachineSnapshot {
  phase: MachinePhase;
  /** Consecutive frontal frames held (findFace / recenter). */
  holdFrames: number;
  holdTargetFrames: number;
  /** Index of the current challenge (0-based), -1 before issuance. */
  challengeIndex: number;
  challengeCount: number;
  currentChallenge: ChallengeType | null;
  /** Restart count of the CURRENT challenge. */
  restarts: number;
  /** A second person has been in frame for `multiFaceFrames` frames. */
  multiFace: boolean;
  failReason: FailReason | null;
  completedCount: number;
}

export interface ChallengeMachineConfig {
  /** N distinct challenges drawn from the pool (default 3). */
  challengeCount: number;
  challengePool: ChallengeType[];
  /**
   * The hold gate (findFace & recenter) completes on whichever comes
   * first: `findFaceHoldFrames` consecutive compliant frames, or
   * `findFaceMinHoldFrames` consecutive compliant frames spanning
   * `findFaceHoldMs`. A pure frame count made the hold fps-dependent — 20
   * frames is 0.7 s on a flagship but 3-4 s of perfectly still posing on a
   * low-fps device, and one dropped frame reset it (field feedback: "stuck
   * at Look straight at the camera again").
   */
  findFaceHoldFrames: number;
  findFaceMinHoldFrames: number;
  findFaceHoldMs: number;
  /** findFace: faceWidthFrac >= 0.25. */
  minFaceWidthFrac: number;
  /** findFace: |yaw| < 15 deg. */
  findFaceMaxAbsYawDeg: number;
  /** findFace: |pitch| < 12 deg. */
  findFaceMaxAbsPitchDeg: number;
  /** findFace: centerOffsetFrac < 0.12. */
  maxCenterOffsetFrac: number;
  /** blink fallback (no baseline yet): mean eye openness < 0.2 ... */
  blinkClosedBelow: number;
  /** ... THEN mean eye openness > 0.7 ... */
  blinkOpenAbove: number;
  /** ... within 2 s of the closed sample. */
  blinkReopenWindowMs: number;
  /**
   * Adaptive blink: the machine tracks the user's own open-eye baseline
   * (EMA of mean(left,right) over frontal frames). Glasses / small eyes /
   * strong backlight compress MediaPipe's blink scores, so the closed test
   * runs on the MEAN of both eyes against clamp(baseline *
   * blinkRelClosedFrac, blinkClosedFloor, blinkClosedCeil), and reopen
   * against min(blinkOpenAbove, baseline * blinkRelOpenFrac). A wink still
   * cannot pass: EACH eye must additionally dip below baseline *
   * blinkPerEyeDipFrac (an eye behind glare dips a little; a deliberately
   * held-open eye does not dip at all).
   */
  blinkRelClosedFrac: number;
  blinkRelOpenFrac: number;
  blinkClosedFloor: number;
  blinkClosedCeil: number;
  blinkPerEyeDipFrac: number;
  /** turn: yaw delta from baseline >= 18 deg in the required direction. */
  turnYawDeltaDeg: number;
  /** turn: then return to |yaw| < 12 deg to complete. */
  turnReturnAbsYawBelowDeg: number;
  /** smile: smile >= 0.45 (max of mouthSmileLeft/Right, see face-metrics) ... */
  smileAbove: number;
  /** ... sustained 350 ms. */
  smileHoldMs: number;
  /** Anti-cheat: face lost longer than this restarts the challenge (1 s). */
  faceLostGraceMs: number;
  /**
   * Anti-cheat debounce: a second face must be seen on this many
   * CONSECUTIVE frames before it counts (5, ~0.2 s). Face detectors emit
   * the occasional single-frame phantom; without a debounce one such frame
   * restarted the challenge and three of them failed the whole session.
   */
  multiFaceFrames: number;
  /** Anti-cheat: this many restarts of one challenge fails the session (3). */
  maxRestarts: number;
  /** 15 s timeout per challenge fails the session. */
  challengeTimeoutMs: number;
  /** Injectable RNG in [0,1) — for challenge drawing. */
  rng: () => number;
  /** Injectable wall clock (Unix epoch ms). */
  now: () => number;
  /** Override the generated UUIDv4 session id (tests). */
  sessionId?: string;
}

export const DEFAULT_CHALLENGE_MACHINE_CONFIG: Omit<ChallengeMachineConfig, 'rng' | 'now'> = {
  challengeCount: 3,
  challengePool: ['blink', 'turnLeft', 'turnRight', 'smile'],
  findFaceHoldFrames: 20,
  findFaceMinHoldFrames: 5,
  findFaceHoldMs: 500,
  minFaceWidthFrac: 0.25,
  findFaceMaxAbsYawDeg: 15,
  // 15 deg, was 12: looking slightly down at a hand-held phone is the
  // natural pose and was the most common hold blocker. Pose quality of the
  // final selfie is unaffected — best-frame selection still prefers
  // |pitch| < 10 — and liveness proof is the server's verdict, not this.
  findFaceMaxAbsPitchDeg: 15,
  maxCenterOffsetFrac: 0.12,
  blinkClosedBelow: 0.2,
  blinkOpenAbove: 0.7,
  blinkReopenWindowMs: 2000,
  blinkRelClosedFrac: 0.72,
  blinkRelOpenFrac: 0.8,
  blinkClosedFloor: 0.12,
  blinkClosedCeil: 0.55,
  blinkPerEyeDipFrac: 0.85,
  turnYawDeltaDeg: 18,
  turnReturnAbsYawBelowDeg: 12,
  smileAbove: 0.45,
  smileHoldMs: 350,
  faceLostGraceMs: 1000,
  multiFaceFrames: 5,
  maxRestarts: 3,
  challengeTimeoutMs: 15_000,
};

export interface SdkIdentity {
  name: string;
  version: string;
  platform: 'android' | 'ios' | 'web';
}

interface ChallengeRuntime {
  type: ChallengeType;
  /** Last (re)issue time — recorded into the log. */
  issuedAt: number;
  /** First issue time — the 15 s timeout budget runs from here. */
  firstIssuedAt: number;
  restarts: number;
  /** Yaw at issue; captured from the first single-face frame after issue. */
  baselineYaw: number | null;
  /** blink: time of the most recent both-eyes-closed sample. */
  blinkClosedAt: number | null;
  /** turn: the >= 18 deg excursion has been seen. */
  turned: boolean;
  /** smile: start of the current continuous >= 0.8 run. */
  smileSince: number | null;
}

function uuidV4(rng: () => number): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // RFC 4122 v4 via the injected RNG (non-crypto fallback; the session id
  // is a correlation id, not a secret).
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.floor(rng() * 16) & 0x3) | 0x8];
    else out += hex[Math.floor(rng() * 16) & 0xf];
  }
  return out;
}

export class ChallengeMachine {
  private readonly cfg: ChallengeMachineConfig;
  private phase: MachinePhase = 'init';
  private holdFrames = 0;
  private holdStartedAtMs = 0;
  private challenges: ChallengeType[] = [];
  private index = -1;
  private current: ChallengeRuntime | null = null;
  private lastFaceSeenAt: number | null = null;
  private multiFaceStreak = 0;
  private eyeBaseline: number | null = null;
  private completed: CompletedChallenge[] = [];
  private startedAtMs = 0;
  private finishedAtMs = 0;
  private failReason: FailReason | null = null;
  readonly sessionId: string;

  constructor(config: Partial<ChallengeMachineConfig> = {}) {
    this.cfg = {
      ...DEFAULT_CHALLENGE_MACHINE_CONFIG,
      rng: Math.random,
      now: Date.now,
      ...config,
    };
    if (this.cfg.challengeCount > this.cfg.challengePool.length) {
      throw new Error('challengeCount cannot exceed the challenge pool size');
    }
    this.sessionId = this.cfg.sessionId ?? uuidV4(this.cfg.rng);
  }

  /** init -> findFace. Records `started_at`. */
  start(): void {
    if (this.phase !== 'init') return;
    this.phase = 'findFace';
    this.startedAtMs = this.cfg.now();
    this.holdFrames = 0;
    this.multiFaceStreak = 0;
  }

  /** Feed one processed FaceObservation. Returns the new snapshot. */
  process(obs: FaceObservation): MachineSnapshot {
    this.multiFaceStreak = obs.count > 1 ? this.multiFaceStreak + 1 : 0;
    switch (this.phase) {
      case 'findFace':
      case 'recenter':
        this.processHold(obs);
        break;
      case 'challenge':
        this.processChallenge(obs);
        break;
      default:
        break; // init/capture/finalizing/done/failed ignore observations
    }
    return this.snapshot();
  }

  get state(): MachineSnapshot {
    return this.snapshot();
  }

  get completedChallenges(): readonly CompletedChallenge[] {
    return this.completed;
  }

  get startedAt(): number {
    return this.startedAtMs;
  }

  get finishedAt(): number {
    return this.finishedAtMs;
  }

  /** Orchestrator hooks for the phases after `capture`. */
  markFinalizing(): void {
    if (this.phase === 'capture') this.phase = 'finalizing';
  }

  markDone(): void {
    if (this.phase === 'finalizing') this.phase = 'done';
  }

  markFailed(reason: FailReason): void {
    this.fail(reason);
  }

  /**
   * Serialize the wire-format challenge log (docs/ACTIVE_LIVENESS.md).
   * Timestamps are the REAL wall-clock times recorded during the session.
   */
  buildChallengeLog(sdk: SdkIdentity): ChallengeLogWire {
    return {
      session_id: this.sessionId,
      sdk: { name: sdk.name, version: sdk.version, platform: sdk.platform },
      started_at: this.startedAtMs,
      finished_at: this.finishedAtMs !== 0 ? this.finishedAtMs : this.cfg.now(),
      challenges: this.completed.map((c) => ({
        type: CHALLENGE_WIRE_TYPE[c.type],
        issued_at: c.issuedAt,
        completed_at: c.completedAt,
        passed: c.passed,
      })),
    };
  }

  // ------------------------------------------------------------------ //

  private snapshot(): MachineSnapshot {
    return {
      phase: this.phase,
      holdFrames: this.holdFrames,
      holdTargetFrames: this.cfg.findFaceHoldFrames,
      challengeIndex: this.index,
      challengeCount: this.cfg.challengeCount,
      currentChallenge: this.current?.type ?? null,
      restarts: this.current?.restarts ?? 0,
      multiFace: this.multiFaceConfirmed,
      failReason: this.failReason,
      completedCount: this.completed.length,
    };
  }

  /**
   * A second face only blocks the flow once it has survived
   * `multiFaceFrames` consecutive frames — see the config comment.
   */
  private get multiFaceConfirmed(): boolean {
    return this.multiFaceStreak >= this.cfg.multiFaceFrames;
  }

  /** findFace acceptance predicate (also used for recenter). */
  private meetsFrontalHold(obs: FaceObservation): boolean {
    return (
      obs.count >= 1 &&
      !this.multiFaceConfirmed &&
      obs.faceWidthFrac >= this.cfg.minFaceWidthFrac &&
      Math.abs(obs.yawDeg) < this.cfg.findFaceMaxAbsYawDeg &&
      Math.abs(obs.pitchDeg) < this.cfg.findFaceMaxAbsPitchDeg &&
      obs.centerOffsetFrac < this.cfg.maxCenterOffsetFrac
    );
  }

  /**
   * EMA of the user's own open-eye level (MEAN of both eyes — the mean is
   * robust to one eye reading low behind glasses glare), sampled on frames
   * where the eyes are at (or near) their typical openness. Never pulled
   * down by blinks: samples below 80% of the current baseline are ignored.
   */
  private updateEyeBaseline(obs: FaceObservation): void {
    const meanEye = (obs.leftEyeOpen + obs.rightEyeOpen) / 2;
    if (this.eyeBaseline === null) {
      if (meanEye > 0.3) this.eyeBaseline = meanEye;
      return;
    }
    if (meanEye >= this.eyeBaseline * 0.8) {
      this.eyeBaseline = this.eyeBaseline * 0.8 + meanEye * 0.2;
    }
  }

  private processHold(obs: FaceObservation): void {
    if (this.meetsFrontalHold(obs)) {
      if (this.holdFrames === 0) this.holdStartedAtMs = this.cfg.now();
      this.holdFrames += 1;
      this.updateEyeBaseline(obs);
    } else this.holdFrames = 0;

    const heldLongEnough =
      this.holdFrames >= this.cfg.findFaceHoldFrames ||
      (this.holdFrames >= this.cfg.findFaceMinHoldFrames &&
        this.cfg.now() - this.holdStartedAtMs >= this.cfg.findFaceHoldMs);
    if (heldLongEnough) {
      if (this.phase === 'findFace') {
        this.challenges = this.drawChallenges();
        this.index = 0;
        this.phase = 'challenge';
        this.issueChallenge(obs);
      } else {
        // recenter complete -> ready for best-frame capture.
        this.phase = 'capture';
        this.finishedAtMs = this.cfg.now();
      }
      this.holdFrames = 0;
    }
  }

  /** Draw N DISTINCT challenges uniformly at random from the pool. */
  private drawChallenges(): ChallengeType[] {
    const pool = [...this.cfg.challengePool];
    const drawn: ChallengeType[] = [];
    for (let i = 0; i < this.cfg.challengeCount && pool.length > 0; i++) {
      const r = this.cfg.rng();
      const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(r * pool.length)));
      drawn.push(pool.splice(idx, 1)[0]);
    }
    return drawn;
  }

  private issueChallenge(obs: FaceObservation | null): void {
    const t = this.cfg.now();
    this.current = {
      type: this.challenges[this.index],
      issuedAt: t,
      firstIssuedAt: t,
      restarts: 0,
      baselineYaw: obs !== null && obs.count >= 1 ? obs.yawDeg : null,
      blinkClosedAt: null,
      turned: false,
      smileSince: null,
    };
    this.lastFaceSeenAt = t;
  }

  /** Re-issue the current challenge, keeping restarts + timeout budget. */
  private restartCurrentChallenge(): void {
    const cur = this.current;
    if (!cur) return;
    cur.restarts += 1;
    if (cur.restarts >= this.cfg.maxRestarts) {
      this.fail('tooManyRestarts');
      return;
    }
    const t = this.cfg.now();
    cur.issuedAt = t; // log records the (re)issue of the passing attempt
    cur.baselineYaw = null; // re-captured from the next single-face frame
    cur.blinkClosedAt = null;
    cur.turned = false;
    cur.smileSince = null;
    this.lastFaceSeenAt = t;
  }

  private processChallenge(obs: FaceObservation): void {
    const cur = this.current;
    if (!cur) return;
    const t = this.cfg.now();

    // 15 s per-challenge timeout, measured from the FIRST issuance so
    // restarts cannot stretch the session budget indefinitely.
    if (t - cur.firstIssuedAt >= this.cfg.challengeTimeoutMs) {
      this.fail('timeout');
      return;
    }

    // Anti-cheat: a second person in frame -> restart (debounced). The
    // restart fires on the frame the streak crosses the threshold and the
    // challenge then stays frozen — snapshot.multiFace keeps the "only one
    // face" message on screen — until the frame is clean again.
    if (this.multiFaceConfirmed) {
      if (this.multiFaceStreak === this.cfg.multiFaceFrames) this.restartCurrentChallenge();
      return;
    }
    // Anti-cheat: face lost for more than the grace period -> restart.
    if (obs.count === 0) {
      if (this.lastFaceSeenAt !== null && t - this.lastFaceSeenAt > this.cfg.faceLostGraceMs) {
        this.restartCurrentChallenge();
      }
      return;
    }

    this.lastFaceSeenAt = t;
    this.updateEyeBaseline(obs);
    if (cur.baselineYaw === null) cur.baselineYaw = obs.yawDeg;

    let completedNow = false;
    switch (cur.type) {
      case 'blink': {
        // Adaptive thresholds calibrated to this user's open-eye baseline —
        // glasses / small eyes / backlight compress the blink scores, so
        // depth is judged on the MEAN of both eyes. The per-eye dip gate
        // keeps a wink from passing: each eye must dip at least a little.
        const base = this.eyeBaseline;
        const meanEye = (obs.leftEyeOpen + obs.rightEyeOpen) / 2;
        const closedThr =
          base === null
            ? this.cfg.blinkClosedBelow
            : Math.min(
                this.cfg.blinkClosedCeil,
                Math.max(this.cfg.blinkClosedFloor, base * this.cfg.blinkRelClosedFrac),
              );
        const openThr =
          base === null
            ? this.cfg.blinkOpenAbove
            : Math.max(
                closedThr + 0.05,
                Math.min(this.cfg.blinkOpenAbove, base * this.cfg.blinkRelOpenFrac),
              );
        const perEyeDipGate =
          base === null ? this.cfg.blinkOpenAbove : base * this.cfg.blinkPerEyeDipFrac;
        const closed =
          meanEye < closedThr &&
          obs.leftEyeOpen < perEyeDipGate &&
          obs.rightEyeOpen < perEyeDipGate;
        const open = meanEye > openThr;
        if (closed) {
          // Track the most recent closed sample; the reopen window runs
          // from here. A static closed-eyes photo never satisfies `open`,
          // so the mandatory closed->open transition cannot be spoofed.
          cur.blinkClosedAt = t;
        } else if (
          open &&
          cur.blinkClosedAt !== null &&
          t - cur.blinkClosedAt <= this.cfg.blinkReopenWindowMs
        ) {
          completedNow = true;
        }
        break;
      }
      case 'turnLeft':
      case 'turnRight': {
        const baseline = cur.baselineYaw ?? obs.yawDeg;
        const delta = obs.yawDeg - baseline;
        const reached =
          cur.type === 'turnLeft'
            ? delta >= this.cfg.turnYawDeltaDeg
            : delta <= -this.cfg.turnYawDeltaDeg;
        if (!cur.turned && reached) {
          cur.turned = true;
        } else if (cur.turned && Math.abs(obs.yawDeg) < this.cfg.turnReturnAbsYawBelowDeg) {
          completedNow = true;
        }
        break;
      }
      case 'smile': {
        if (obs.smile >= this.cfg.smileAbove) {
          if (cur.smileSince === null) cur.smileSince = t;
          if (t - cur.smileSince >= this.cfg.smileHoldMs) completedNow = true;
        } else {
          cur.smileSince = null;
        }
        break;
      }
    }

    if (completedNow) {
      this.completed.push({
        type: cur.type,
        issuedAt: cur.issuedAt,
        completedAt: t,
        passed: true,
      });
      this.index += 1;
      if (this.index < this.challenges.length) {
        this.issueChallenge(obs);
      } else {
        this.phase = 'recenter';
        this.holdFrames = 0;
        this.current = null;
      }
    }
  }

  private fail(reason: FailReason): void {
    if (this.phase === 'done' || this.phase === 'failed') return;
    this.phase = 'failed';
    this.failReason = reason;
  }
}
