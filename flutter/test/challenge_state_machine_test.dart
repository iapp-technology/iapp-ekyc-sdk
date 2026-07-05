import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:iapp_ekyc_sdk/src/active_liveness/challenge.dart';
import 'package:iapp_ekyc_sdk/src/active_liveness/challenge_state_machine.dart';
import 'package:iapp_ekyc_sdk/src/active_liveness/face_observation.dart';

// ---------------------------------------------------------------------
// Scripted observations
// ---------------------------------------------------------------------

const _good = FaceObservation(
  count: 1,
  yawDeg: 0,
  pitchDeg: 0,
  leftEyeOpen: 0.95,
  rightEyeOpen: 0.95,
  smile: 0,
  faceWidthFrac: 0.4,
  centerOffsetFrac: 0.05,
  trackingId: 7,
);

const _eyesClosed = FaceObservation(
  count: 1,
  yawDeg: 0,
  pitchDeg: 0,
  leftEyeOpen: 0.05,
  rightEyeOpen: 0.05,
  smile: 0,
  faceWidthFrac: 0.4,
  centerOffsetFrac: 0.05,
  trackingId: 7,
);

const _turnedLeft = FaceObservation(
  count: 1,
  yawDeg: 25, // + = user's left.
  pitchDeg: 0,
  leftEyeOpen: 0.95,
  rightEyeOpen: 0.95,
  faceWidthFrac: 0.4,
  centerOffsetFrac: 0.05,
  trackingId: 7,
);

const _turnedRight = FaceObservation(
  count: 1,
  yawDeg: -25,
  pitchDeg: 0,
  leftEyeOpen: 0.95,
  rightEyeOpen: 0.95,
  faceWidthFrac: 0.4,
  centerOffsetFrac: 0.05,
  trackingId: 7,
);

const _smiling = FaceObservation(
  count: 1,
  yawDeg: 0,
  pitchDeg: 0,
  leftEyeOpen: 0.95,
  rightEyeOpen: 0.95,
  smile: 0.95,
  faceWidthFrac: 0.4,
  centerOffsetFrac: 0.05,
  trackingId: 7,
);

const _twoFaces = FaceObservation(
  count: 2,
  faceWidthFrac: 0.4,
  centerOffsetFrac: 0.05,
);

// ---------------------------------------------------------------------
// Harness with an injectable clock (10 fps default cadence)
// ---------------------------------------------------------------------

class Harness {
  int now = 1767500000000;
  late final ChallengeStateMachine machine;

  Harness({int seed = 42, ChallengeConfig config = const ChallengeConfig()}) {
    machine = ChallengeStateMachine(
      random: Random(seed),
      nowMs: () => now,
      config: config,
    );
    machine.start();
  }

  LivenessUpdate tick(FaceObservation obs, {int advanceMs = 100}) {
    now += advanceMs;
    return machine.process(obs);
  }

  /// Feeds good frontal frames through findFace until a challenge issues.
  LivenessUpdate passFindFace() {
    LivenessUpdate? update;
    for (var i = 0; i < 20; i++) {
      update = tick(_good);
    }
    return update!;
  }

  /// Completes the currently active challenge with honest frames.
  void completeChallenge() {
    final challenge = machine.currentChallenge!;
    switch (challenge) {
      case LivenessChallenge.blink:
        tick(_eyesClosed);
        tick(_good); // Closed → open transition.
      case LivenessChallenge.turnLeft:
        tick(_turnedLeft);
        tick(_good); // Return to center.
      case LivenessChallenge.turnRight:
        tick(_turnedRight);
        tick(_good);
      case LivenessChallenge.smile:
        for (var i = 0; i < 7; i++) {
          tick(_smiling); // ≥ 500 ms sustained at 100 ms cadence.
        }
    }
  }
}

const _blinkOnly = ChallengeConfig(
  challengeCount: 1,
  challengePool: [LivenessChallenge.blink],
);

void main() {
  test('happy path completes all challenges and emits a valid log', () {
    final h = Harness(seed: 7);
    expect(h.machine.phase, LivenessPhase.findFace);
    expect(h.machine.challenges, hasLength(3));
    expect(h.machine.challenges.toSet(), hasLength(3));

    final issued = h.passFindFace();
    expect(issued.event, LivenessEvent.challengeIssued);
    expect(h.machine.phase, LivenessPhase.challenge);

    for (var i = 0; i < 3; i++) {
      expect(h.machine.currentChallenge, h.machine.challenges[i]);
      h.completeChallenge();
    }

    expect(h.machine.phase, LivenessPhase.recenter);

    // Recenter: frontal conditions again before capture.
    LivenessUpdate? update;
    for (var i = 0; i < 10; i++) {
      update = h.tick(_good);
    }
    expect(update!.event, LivenessEvent.readyToCapture);
    expect(h.machine.phase, LivenessPhase.capture);

    // Log: 3 entries, all passed, wire types match the drawn sequence.
    final log = h.machine.log;
    expect(log, hasLength(3));
    for (var i = 0; i < 3; i++) {
      expect(log[i].passed, isTrue);
      expect(log[i].type, h.machine.challenges[i]);
    }

    // Timestamps: real, strictly ordered within and across entries.
    for (var i = 0; i < 3; i++) {
      expect(log[i].issuedAtMs, lessThan(log[i].completedAtMs));
      if (i > 0) {
        expect(
          log[i].issuedAtMs,
          greaterThanOrEqualTo(log[i - 1].completedAtMs),
        );
      }
    }

    final wire = h.machine.buildChallengeLog(
      sessionId: 'test-session',
      sdkName: 'iapp-ekyc-sdk-flutter',
      sdkVersion: '0.1.0',
      platform: 'android',
    );
    expect(wire['session_id'], 'test-session');
    expect(wire['sdk'], {
      'name': 'iapp-ekyc-sdk-flutter',
      'version': '0.1.0',
      'platform': 'android',
    });
    expect(wire['started_at'], lessThanOrEqualTo(log.first.issuedAtMs));
    expect(wire['finished_at'], greaterThanOrEqualTo(log.last.completedAtMs));
    final challenges = wire['challenges'] as List<dynamic>;
    expect(challenges, hasLength(3));
    for (final entry in challenges.cast<Map<String, dynamic>>()) {
      expect([
        'blink',
        'turn_left',
        'turn_right',
        'smile',
      ], contains(entry['type']));
      expect(entry['passed'], isTrue);
      expect(entry['issued_at'], isA<int>());
      expect(entry['completed_at'], isA<int>());
    }
  });

  test('photo attack: closed eyes that never reopen must NOT pass blink', () {
    final h = Harness(config: _blinkOnly);
    h.passFindFace();
    expect(h.machine.currentChallenge, LivenessChallenge.blink);

    // A printed photo of closed eyes: closed forever, no open transition.
    var frames = 0;
    while (h.machine.phase == LivenessPhase.challenge && frames < 500) {
      h.tick(_eyesClosed);
      frames++;
    }
    expect(h.machine.log, isEmpty); // Blink never completed.
    expect(h.machine.phase, LivenessPhase.failed);
    expect(h.machine.failureReason, LivenessFailureReason.challengeTimeout);
  });

  test('GLASSES: shallow blink is detected via the adaptive baseline', () {
    // A glasses user whose eye-open blendshape idles at ~0.55 and only
    // dips to ~0.28 when blinking — invisible to the absolute 0.2/0.7
    // thresholds.
    final h = Harness(config: _blinkOnly);
    const glasses = FaceObservation(
      count: 1,
      yawDeg: 0,
      pitchDeg: 0,
      leftEyeOpen: 0.55,
      rightEyeOpen: 0.55,
      smile: 0,
      faceWidthFrac: 0.4,
      centerOffsetFrac: 0.05,
      trackingId: 7,
    );
    for (var i = 0; i < 25; i++) {
      h.tick(glasses);
    }
    expect(h.machine.currentChallenge, LivenessChallenge.blink);

    // baseline ≈ 0.55 → closed < ~0.30, reopen > ~0.47.
    const shallowDip = FaceObservation(
      count: 1,
      yawDeg: 0,
      pitchDeg: 0,
      leftEyeOpen: 0.28,
      rightEyeOpen: 0.28,
      smile: 0,
      faceWidthFrac: 0.4,
      centerOffsetFrac: 0.05,
      trackingId: 7,
    );
    const shallowReopen = FaceObservation(
      count: 1,
      yawDeg: 0,
      pitchDeg: 0,
      leftEyeOpen: 0.5,
      rightEyeOpen: 0.5,
      smile: 0,
      faceWidthFrac: 0.4,
      centerOffsetFrac: 0.05,
      trackingId: 7,
    );
    h.tick(shallowDip);
    h.tick(shallowReopen);
    expect(h.machine.log.map((e) => e.type), [LivenessChallenge.blink]);
  });

  test('blink reopening after the 1.5 s window does not complete', () {
    final h = Harness(config: _blinkOnly);
    h.passFindFace();

    h.tick(_eyesClosed);
    // Reopen 2 s after the closed sample — outside the window.
    final late = h.tick(_good, advanceMs: 2000);
    expect(late.event, isNot(LivenessEvent.challengeCompleted));
    expect(h.machine.phase, LivenessPhase.challenge);

    // A genuine, prompt blink then completes.
    h.tick(_eyesClosed);
    h.tick(_good);
    expect(h.machine.log, hasLength(1));
  });

  test('two faces mid-challenge restarts the challenge', () {
    final h = Harness(config: _blinkOnly);
    h.passFindFace();

    h.tick(_eyesClosed); // Half-way through the blink.
    final restart = h.tick(_twoFaces);
    expect(restart.event, LivenessEvent.challengeRestarted);
    expect(h.machine.restartsOfCurrentChallenge, 1);
    expect(h.machine.phase, LivenessPhase.challenge);

    // Progress was reset: the earlier closed sample must not count.
    final open = h.tick(_good);
    expect(open.event, isNot(LivenessEvent.challengeCompleted));

    // Full honest blink still passes.
    h.tick(_eyesClosed);
    h.tick(_good);
    expect(h.machine.log, hasLength(1));
  });

  test('3 restarts of one challenge fails the session', () {
    final h = Harness(config: _blinkOnly);
    h.passFindFace();

    h.tick(_twoFaces);
    expect(h.machine.phase, LivenessPhase.challenge);
    h.tick(_good);
    h.tick(_twoFaces);
    expect(h.machine.phase, LivenessPhase.challenge);
    h.tick(_good);
    final third = h.tick(_twoFaces);
    expect(third.event, LivenessEvent.failed);
    expect(h.machine.phase, LivenessPhase.failed);
    expect(h.machine.failureReason, LivenessFailureReason.tooManyRestarts);
  });

  test('face lost longer than 1 s restarts; brief loss does not', () {
    final h = Harness(config: _blinkOnly);
    h.passFindFace();

    // Brief loss (≤ 1 s): no restart.
    h.tick(FaceObservation.none, advanceMs: 400);
    final backSoon = h.tick(_good, advanceMs: 400);
    expect(backSoon.event, isNot(LivenessEvent.challengeRestarted));
    expect(h.machine.restartsOfCurrentChallenge, 0);

    // Extended loss (> 1 s): restart.
    h.tick(FaceObservation.none, advanceMs: 400);
    final lost = h.tick(FaceObservation.none, advanceMs: 1200);
    expect(lost.event, LivenessEvent.challengeRestarted);
    expect(h.machine.restartsOfCurrentChallenge, 1);
  });

  test('tracking-ID change mid-challenge restarts', () {
    final h = Harness(config: _blinkOnly);
    h.passFindFace();

    const swapped = FaceObservation(
      count: 1,
      leftEyeOpen: 0.95,
      rightEyeOpen: 0.95,
      faceWidthFrac: 0.4,
      centerOffsetFrac: 0.05,
      trackingId: 99, // Different face took over.
    );
    final restart = h.tick(swapped);
    expect(restart.event, LivenessEvent.challengeRestarted);
  });

  test('per-challenge timeout fails even with a compliant face', () {
    final h = Harness(config: _blinkOnly);
    h.passFindFace();

    // Open eyes, never blinking, for > 15 s.
    LivenessUpdate? update;
    for (var i = 0; i < 160; i++) {
      update = h.tick(_good);
      if (h.machine.phase == LivenessPhase.failed) break;
    }
    expect(update!.event, LivenessEvent.failed);
    expect(h.machine.failureReason, LivenessFailureReason.challengeTimeout);
  });

  test('seeded Random draws 3 distinct challenges, reproducibly', () {
    final sequences = <String>{};
    for (var seed = 0; seed < 10; seed++) {
      final machine = ChallengeStateMachine(
        random: Random(seed),
        nowMs: () => 0,
      );
      machine.start();
      expect(machine.challenges, hasLength(3));
      expect(machine.challenges.toSet(), hasLength(3));
      sequences.add(machine.challenges.map((c) => c.wireName).join(','));

      // Same seed → same draw.
      final again = ChallengeStateMachine(random: Random(seed), nowMs: () => 0);
      again.start();
      expect(again.challenges, machine.challenges);
    }
    // Different seeds explore different orders.
    expect(sequences.length, greaterThan(1));
  });

  test('findFace requires 20 consecutive compliant frames', () {
    final h = Harness();
    for (var i = 0; i < 19; i++) {
      h.tick(_good);
    }
    // A bad frame resets the streak.
    h.tick(FaceObservation.none);
    for (var i = 0; i < 19; i++) {
      expect(h.tick(_good).event, LivenessEvent.none);
    }
    expect(h.tick(_good).event, LivenessEvent.challengeIssued);
  });
}
