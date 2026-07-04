/// Frame-budget enforcement (docs/ALGORITHM.md): process at most
/// `1000 / minInterval.inMilliseconds` frames per second, and drop —
/// never queue — frames that arrive while a previous frame is still
/// being processed.
class FrameThrottler {
  /// Minimum interval between two processed frames (default 100 ms ⇒
  /// ≤ 10 fps).
  final Duration minInterval;

  final DateTime Function() _now;

  bool _busy = false;
  DateTime? _lastStart;

  FrameThrottler({
    this.minInterval = const Duration(milliseconds: 100),
    DateTime Function()? clock,
  }) : _now = clock ?? DateTime.now;

  /// Whether a frame is currently being processed.
  bool get isBusy => _busy;

  /// Tries to claim the processing slot. Returns `false` (frame must be
  /// dropped) when busy or when the last processed frame started less
  /// than [minInterval] ago. On `true` the caller MUST call [release]
  /// when done.
  bool tryAcquire() {
    if (_busy) return false;
    final now = _now();
    final last = _lastStart;
    if (last != null && now.difference(last) < minInterval) return false;
    _busy = true;
    _lastStart = now;
    return true;
  }

  /// Releases the processing slot claimed by [tryAcquire].
  void release() {
    _busy = false;
  }

  /// Convenience wrapper: runs [task] if the slot is free, else drops the
  /// frame. Returns whether the task ran.
  Future<bool> run(Future<void> Function() task) async {
    if (!tryAcquire()) return false;
    try {
      await task();
    } finally {
      release();
    }
    return true;
  }

  /// Forgets the last-frame timestamp (e.g. when a flow restarts).
  void reset() {
    _busy = false;
    _lastStart = null;
  }
}
