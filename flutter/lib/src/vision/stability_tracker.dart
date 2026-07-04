/// Pure-Dart stability tracking per docs/ALGORITHM.md step 9.
///
/// Sliding window of the last [window] processed frames. A frame is
/// *stable* iff it was accepted AND its maximum corner displacement vs.
/// the **previous accepted** frame is < [maxCornerDriftFrac] of the frame
/// diagonal. The first accepted frame has no reference and is NOT stable.
/// The trigger condition holds when ≥ [minStableFrames] of the window are
/// stable.
library;

import 'dart:collection';
import 'dart:math' as math;

class StabilityTracker {
  /// Sliding-window length in processed frames.
  final int window;

  /// Minimum stable frames within the window for the trigger to hold.
  final int minStableFrames;

  /// Max corner displacement as a fraction of the frame diagonal.
  final double maxCornerDriftFrac;

  final double _driftLimitPx;

  final Queue<bool> _stableFlags = Queue<bool>();
  List<math.Point<double>>? _lastAcceptedCorners;

  StabilityTracker({
    required double frameWidth,
    required double frameHeight,
    this.window = 8,
    this.minStableFrames = 6,
    this.maxCornerDriftFrac = 0.02,
  }) : _driftLimitPx =
           maxCornerDriftFrac *
           math.sqrt(frameWidth * frameWidth + frameHeight * frameHeight);

  /// Records a processed frame. Pass the ordered corners of the accepted
  /// quad, or `null` for a rejected frame. Returns whether this frame was
  /// stable.
  bool addFrame(List<math.Point<double>>? corners) {
    var stable = false;
    if (corners != null) {
      final reference = _lastAcceptedCorners;
      if (reference != null && reference.length == corners.length) {
        var maxDrift = 0.0;
        for (var i = 0; i < corners.length; i++) {
          final d = corners[i].distanceTo(reference[i]);
          if (d > maxDrift) maxDrift = d;
        }
        stable = maxDrift < _driftLimitPx;
      }
      // Rejected frames do NOT clear the reference — the next accepted
      // frame is compared against the last accepted one.
      _lastAcceptedCorners = List.unmodifiable(corners);
    }
    _stableFlags.addLast(stable);
    while (_stableFlags.length > window) {
      _stableFlags.removeFirst();
    }
    return stable;
  }

  /// Number of stable frames currently in the window.
  int get stableCount => _stableFlags.where((f) => f).length;

  /// Whether the trigger condition currently holds
  /// (≥ [minStableFrames] of the last [window] frames stable).
  bool get isTriggered => stableCount >= minStableFrames;

  /// Clears all state (e.g. after a capture attempt).
  void reset() {
    _stableFlags.clear();
    _lastAcceptedCorners = null;
  }
}
