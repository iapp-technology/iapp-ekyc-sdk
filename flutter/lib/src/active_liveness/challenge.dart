/// Active-liveness challenge types.
///
/// Wire values are snake_case (`blink`, `turn_left`, `turn_right`,
/// `smile`) per docs/ACTIVE_LIVENESS.md; enum names are camelCase.
enum LivenessChallenge {
  blink('blink'),
  turnLeft('turn_left'),
  turnRight('turn_right'),
  smile('smile');

  const LivenessChallenge(this.wireName);

  /// Snake_case value used in the challenge-log JSON.
  final String wireName;

  /// i18n instruction key shown while this challenge is active.
  String get instructionKey {
    switch (this) {
      case LivenessChallenge.blink:
        return 'blink_now';
      case LivenessChallenge.turnLeft:
        return 'turn_left';
      case LivenessChallenge.turnRight:
        return 'turn_right';
      case LivenessChallenge.smile:
        return 'smile_now';
    }
  }
}
