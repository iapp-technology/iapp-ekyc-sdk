/// Pure-Dart active-liveness challenge state machine
/// (docs/ACTIVE_LIVENESS.md). No Flutter / camera / ML imports; the RNG
/// and clock are injectable for tests.
///
/// `init → findFace → challenge[0..N-1] → recenter → capture → finalizing
/// → done | failed`
library;

import 'dart:math';

import 'challenge.dart';
import 'face_observation.dart';

/// All tunable constants, defaulting to the spec values.
class ChallengeConfig {
  /// Number of distinct challenges drawn per session.
  final int challengeCount;

  /// Pool challenges are drawn from.
  final List<LivenessChallenge> challengePool;

  /// Consecutive good frames required in findFace.
  final int findFaceFrames;

  /// Consecutive good frames required in recenter.
  final int recenterFrames;

  /// findFace/recenter acceptance conditions.
  final double minFaceWidthFrac;
  final double maxAbsYawDeg;
  final double maxAbsPitchDeg;
  final double maxCenterOffsetFrac;

  /// Blink: both eyes < [eyeClosedMax], THEN both > [eyeOpenMin] within
  /// [blinkWindowMs] of the closed sample. The closed→open transition is
  /// mandatory — a printed photo of closed eyes must NOT pass.
  final double eyeClosedMax;
  final double eyeOpenMin;
  final int blinkWindowMs;

  /// Turn: yaw delta from the baseline captured at challenge issue must
  /// reach [turnDeltaDeg] in the required direction, then return to
  /// |yaw| < [turnReturnAbsYawDeg].
  final double turnDeltaDeg;
  final double turnReturnAbsYawDeg;

  /// Smile: probability ≥ [smileMin] sustained [smileHoldMs].
  final double smileMin;
  final int smileHoldMs;

  /// Anti-cheat.
  final int faceLostMaxMs;
  final int maxRestartsPerChallenge;
  final int challengeTimeoutMs;

  const ChallengeConfig({
    this.challengeCount = 3,
    this.challengePool = const [
      LivenessChallenge.blink,
      LivenessChallenge.turnLeft,
      LivenessChallenge.turnRight,
      LivenessChallenge.smile,
    ],
    this.findFaceFrames = 20,
    this.recenterFrames = 10,
    this.minFaceWidthFrac = 0.25,
    this.maxAbsYawDeg = 15,
    this.maxAbsPitchDeg = 12,
    this.maxCenterOffsetFrac = 0.12,
    this.eyeClosedMax = 0.2,
    this.eyeOpenMin = 0.7,
    this.blinkWindowMs = 1500,
    this.turnDeltaDeg = 18,
    this.turnReturnAbsYawDeg = 12,
    this.smileMin = 0.8,
    this.smileHoldMs = 500,
    this.faceLostMaxMs = 1000,
    this.maxRestartsPerChallenge = 3,
    this.challengeTimeoutMs = 15000,
  });
}

/// Phases of the active-liveness session.
enum LivenessPhase {
  init,
  findFace,
  challenge,
  recenter,
  capture,
  finalizing,
  done,
  failed,
}

/// Notable transition produced by a processed frame.
enum LivenessEvent {
  none,
  challengeIssued,
  challengeCompleted,
  challengeRestarted,
  readyToCapture,
  failed,
}

/// One completed challenge, with real wall-clock timestamps (epoch ms).
class ChallengeLogEntry {
  final LivenessChallenge type;
  final int issuedAtMs;
  final int completedAtMs;
  final bool passed;

  const ChallengeLogEntry({
    required this.type,
    required this.issuedAtMs,
    required this.completedAtMs,
    required this.passed,
  });

  Map<String, dynamic> toJson() => {
    'type': type.wireName,
    'issued_at': issuedAtMs,
    'completed_at': completedAtMs,
    'passed': passed,
  };
}

/// Snapshot returned by [ChallengeStateMachine.process].
class LivenessUpdate {
  final LivenessPhase phase;
  final LivenessEvent event;

  /// i18n key of the instruction to show the user.
  final String instructionKey;

  /// Index of the current challenge (-1 outside the challenge phase).
  final int challengeIndex;

  final LivenessChallenge? currentChallenge;

  const LivenessUpdate({
    required this.phase,
    required this.event,
    required this.instructionKey,
    this.challengeIndex = -1,
    this.currentChallenge,
  });
}

/// Failure reasons reported via [ChallengeStateMachine.failureReason].
abstract final class LivenessFailureReason {
  static const tooManyRestarts = 'too_many_restarts';
  static const challengeTimeout = 'challenge_timeout';
  static const finalizeError = 'finalize_error';
}

class ChallengeStateMachine {
  final ChallengeConfig config;
  final Random _random;
  final int Function() _nowMs;

  ChallengeStateMachine({
    required Random random,
    int Function()? nowMs,
    this.config = const ChallengeConfig(),
  }) : _random = random,
       _nowMs = nowMs ?? (() => DateTime.now().millisecondsSinceEpoch);

  LivenessPhase _phase = LivenessPhase.init;
  LivenessPhase get phase => _phase;

  List<LivenessChallenge> _challenges = const [];

  /// The challenges drawn for this session (fixed at [start]).
  List<LivenessChallenge> get challenges => List.unmodifiable(_challenges);

  int _challengeIndex = -1;
  int get currentChallengeIndex => _challengeIndex;

  LivenessChallenge? get currentChallenge =>
      _phase == LivenessPhase.challenge &&
          _challengeIndex >= 0 &&
          _challengeIndex < _challenges.length
      ? _challenges[_challengeIndex]
      : null;

  final List<ChallengeLogEntry> _log = [];

  /// Completed challenge log entries (monotonic real timestamps).
  List<ChallengeLogEntry> get log => List.unmodifiable(_log);

  String? _failureReason;
  String? get failureReason => _failureReason;

  int? _startedAtMs;
  int? get startedAtMs => _startedAtMs;

  int? _finishedAtMs;
  int? get finishedAtMs => _finishedAtMs;

  int get restartsOfCurrentChallenge => _restarts;

  // findFace / recenter progress.
  int _goodFrameStreak = 0;

  // Per-challenge state.
  int _issuedAtMs = 0;
  int _restarts = 0;
  int? _blinkClosedAtMs;
  double? _turnBaselineYaw;
  bool _turnReached = false;
  int? _smileStartMs;
  int? _faceLostSinceMs;
  int? _lastTrackingId;
  String _lastInstructionKey = 'position_face';

  /// Draws the random challenge sequence and enters findFace.
  void start() {
    assert(
      config.challengeCount <= config.challengePool.length,
      'challengeCount exceeds the challenge pool size',
    );
    final pool = List<LivenessChallenge>.of(config.challengePool);
    pool.shuffle(_random);
    _challenges = pool.take(config.challengeCount).toList();
    _log.clear();
    _failureReason = null;
    _challengeIndex = -1;
    _goodFrameStreak = 0;
    _startedAtMs = _nowMs();
    _finishedAtMs = null;
    _phase = LivenessPhase.findFace;
    _lastInstructionKey = 'position_face';
  }

  /// Marks the network finalize step as started (after capture).
  void beginFinalizing() {
    assert(_phase == LivenessPhase.capture);
    _phase = LivenessPhase.finalizing;
  }

  /// Marks the session as fully complete (server verdict received).
  void completeSession() {
    _phase = LivenessPhase.done;
  }

  /// Fails the session (e.g. finalize network error).
  void failSession(String reason) {
    _failureReason = reason;
    _finishedAtMs ??= _nowMs();
    _phase = LivenessPhase.failed;
  }

  /// Feeds one processed frame. Must be called with real observations at
  /// real wall-clock times — the server enforces timestamp sanity.
  LivenessUpdate process(FaceObservation obs) {
    switch (_phase) {
      case LivenessPhase.findFace:
        return _processFindFace(obs);
      case LivenessPhase.challenge:
        return _processChallenge(obs);
      case LivenessPhase.recenter:
        return _processRecenter(obs);
      case LivenessPhase.init:
      case LivenessPhase.capture:
      case LivenessPhase.finalizing:
      case LivenessPhase.done:
      case LivenessPhase.failed:
        return _update(LivenessEvent.none, _lastInstructionKey);
    }
  }

  // -------------------------------------------------------------------
  // findFace / recenter
  // -------------------------------------------------------------------

  bool _meetsFrontalConditions(FaceObservation obs) =>
      obs.count == 1 &&
      obs.faceWidthFrac >= config.minFaceWidthFrac &&
      obs.yawDeg.abs() < config.maxAbsYawDeg &&
      obs.pitchDeg.abs() < config.maxAbsPitchDeg &&
      obs.centerOffsetFrac < config.maxCenterOffsetFrac;

  String _frontalHintKey(FaceObservation obs) {
    if (obs.count == 0) return 'position_face';
    if (obs.count > 1) return 'multiple_faces';
    if (obs.faceWidthFrac < config.minFaceWidthFrac) return 'move_face_closer';
    if (obs.centerOffsetFrac >= config.maxCenterOffsetFrac) {
      return 'center_face';
    }
    if (obs.yawDeg.abs() >= config.maxAbsYawDeg ||
        obs.pitchDeg.abs() >= config.maxAbsPitchDeg) {
      return 'look_straight';
    }
    return 'hold_face';
  }

  LivenessUpdate _processFindFace(FaceObservation obs) {
    if (_meetsFrontalConditions(obs)) {
      _goodFrameStreak++;
      if (_goodFrameStreak >= config.findFaceFrames) {
        _issueChallenge(0, obs);
        return _update(
          LivenessEvent.challengeIssued,
          _challenges[0].instructionKey,
        );
      }
    } else {
      _goodFrameStreak = 0;
    }
    return _update(LivenessEvent.none, _frontalHintKey(obs));
  }

  LivenessUpdate _processRecenter(FaceObservation obs) {
    if (_meetsFrontalConditions(obs)) {
      _goodFrameStreak++;
      if (_goodFrameStreak >= config.recenterFrames) {
        _phase = LivenessPhase.capture;
        _finishedAtMs = _nowMs();
        return _update(LivenessEvent.readyToCapture, 'hold_face');
      }
    } else {
      _goodFrameStreak = 0;
    }
    final hint = _meetsFrontalConditions(obs)
        ? 'recenter_face'
        : _frontalHintKey(obs);
    return _update(LivenessEvent.none, hint);
  }

  // -------------------------------------------------------------------
  // Challenges
  // -------------------------------------------------------------------

  void _issueChallenge(int index, FaceObservation obs) {
    _phase = LivenessPhase.challenge;
    _challengeIndex = index;
    _issuedAtMs = _nowMs();
    _restarts = 0;
    _goodFrameStreak = 0;
    _lastTrackingId = obs.count == 1 ? obs.trackingId : null;
    _resetChallengeProgress(obs);
  }

  void _resetChallengeProgress(FaceObservation? obs) {
    _blinkClosedAtMs = null;
    _turnReached = false;
    _smileStartMs = null;
    _faceLostSinceMs = null;
    // Baseline yaw for turn challenges: captured at issue when a single
    // face is visible, else lazily on the next single-face frame.
    _turnBaselineYaw = (obs != null && obs.count == 1) ? obs.yawDeg : null;
  }

  LivenessUpdate _processChallenge(FaceObservation obs) {
    final now = _nowMs();
    final challenge = _challenges[_challengeIndex];

    // Per-challenge timeout runs from first issue; restarts don't reset it.
    if (now - _issuedAtMs > config.challengeTimeoutMs) {
      return _fail(LivenessFailureReason.challengeTimeout);
    }

    // Anti-cheat.
    if (obs.count > 1) {
      return _restartChallenge('multiple_faces');
    }
    if (obs.count == 0) {
      _faceLostSinceMs ??= now;
      if (now - _faceLostSinceMs! > config.faceLostMaxMs) {
        return _restartChallenge('face_lost');
      }
      return _update(LivenessEvent.none, 'face_lost');
    }
    _faceLostSinceMs = null;
    if (obs.trackingId != null &&
        _lastTrackingId != null &&
        obs.trackingId != _lastTrackingId) {
      _lastTrackingId = obs.trackingId;
      return _restartChallenge('face_lost');
    }
    _lastTrackingId ??= obs.trackingId;
    _turnBaselineYaw ??= obs.yawDeg;

    final completed = switch (challenge) {
      LivenessChallenge.blink => _checkBlink(obs, now),
      LivenessChallenge.turnLeft => _checkTurn(obs, left: true),
      LivenessChallenge.turnRight => _checkTurn(obs, left: false),
      LivenessChallenge.smile => _checkSmile(obs, now),
    };

    if (completed) {
      _log.add(
        ChallengeLogEntry(
          type: challenge,
          issuedAtMs: _issuedAtMs,
          completedAtMs: now,
          passed: true,
        ),
      );
      if (_challengeIndex + 1 < _challenges.length) {
        _issueChallenge(_challengeIndex + 1, obs);
        return _update(
          LivenessEvent.challengeCompleted,
          _challenges[_challengeIndex].instructionKey,
        );
      }
      _phase = LivenessPhase.recenter;
      _challengeIndex = -1;
      _goodFrameStreak = 0;
      return _update(LivenessEvent.challengeCompleted, 'recenter_face');
    }

    return _update(LivenessEvent.none, challenge.instructionKey);
  }

  /// Blink: both eyes < 0.2, THEN both > 0.7 within 1.5 s of the closed
  /// sample. The closed→open TRANSITION is mandatory — a printed photo of
  /// closed eyes never opens, so it can never pass.
  bool _checkBlink(FaceObservation obs, int now) {
    final closed =
        obs.leftEyeOpen < config.eyeClosedMax &&
        obs.rightEyeOpen < config.eyeClosedMax;
    final open =
        obs.leftEyeOpen > config.eyeOpenMin &&
        obs.rightEyeOpen > config.eyeOpenMin;

    if (closed) {
      _blinkClosedAtMs = now; // Keep the most recent closed sample.
      return false;
    }
    if (open && _blinkClosedAtMs != null) {
      if (now - _blinkClosedAtMs! <= config.blinkWindowMs) {
        return true;
      }
      _blinkClosedAtMs = null; // Reopened too late — need a fresh blink.
    }
    return false;
  }

  /// Turn: yaw delta from baseline ≥ 18° in the required direction
  /// (+yaw = user's left), then return to |yaw| < 12°.
  bool _checkTurn(FaceObservation obs, {required bool left}) {
    final baseline = _turnBaselineYaw;
    if (baseline == null) return false;
    if (!_turnReached) {
      final delta = obs.yawDeg - baseline;
      final reached = left
          ? delta >= config.turnDeltaDeg
          : delta <= -config.turnDeltaDeg;
      if (reached) _turnReached = true;
      return false;
    }
    return obs.yawDeg.abs() < config.turnReturnAbsYawDeg;
  }

  /// Smile: probability ≥ 0.8 sustained 500 ms.
  bool _checkSmile(FaceObservation obs, int now) {
    if (obs.smile >= config.smileMin) {
      _smileStartMs ??= now;
      return now - _smileStartMs! >= config.smileHoldMs;
    }
    _smileStartMs = null;
    return false;
  }

  LivenessUpdate _restartChallenge(String hintKey) {
    _restarts++;
    if (_restarts >= config.maxRestartsPerChallenge) {
      return _fail(LivenessFailureReason.tooManyRestarts);
    }
    _resetChallengeProgress(null);
    _lastTrackingId = null;
    return _update(LivenessEvent.challengeRestarted, hintKey);
  }

  LivenessUpdate _fail(String reason) {
    _failureReason = reason;
    _finishedAtMs = _nowMs();
    _phase = LivenessPhase.failed;
    final key = reason == LivenessFailureReason.challengeTimeout
        ? 'liveness_timeout'
        : 'too_many_restarts';
    return _update(LivenessEvent.failed, key);
  }

  LivenessUpdate _update(LivenessEvent event, String instructionKey) {
    _lastInstructionKey = instructionKey;
    return LivenessUpdate(
      phase: _phase,
      event: event,
      instructionKey: instructionKey,
      challengeIndex: _challengeIndex,
      currentChallenge: currentChallenge,
    );
  }

  /// Builds the wire-schema challenge log (multipart field `challenges`).
  ///
  /// All timestamps are real wall-clock epoch milliseconds recorded when
  /// the events happened — the server enforces strict monotonicity and
  /// duration sanity.
  Map<String, dynamic> buildChallengeLog({
    required String sessionId,
    required String sdkName,
    required String sdkVersion,
    required String platform,
  }) {
    final started = _startedAtMs;
    if (started == null) {
      throw StateError('buildChallengeLog called before start()');
    }
    return {
      'session_id': sessionId,
      'sdk': {'name': sdkName, 'version': sdkVersion, 'platform': platform},
      'started_at': started,
      'finished_at': _finishedAtMs ?? _nowMs(),
      'challenges': [for (final entry in _log) entry.toJson()],
    };
  }
}
