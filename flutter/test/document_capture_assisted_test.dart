// Assisted-fallback counter logic (docs/ALGORITHM.md, "Assisted
// fallback"). `assistedTick` is pure Dart — the OpenCV sharp/stable
// verdicts are injected as booleans — so this runs without the native
// OpenCV library (which does not load under `flutter test` on macOS).
import 'package:flutter_test/flutter_test.dart';
import 'package:iapp_ekyc_sdk/src/document_capture/document_capture_controller.dart';
import 'package:iapp_ekyc_sdk/src/document_capture/document_type.dart';

void main() {
  const fallbackMs = 4000;
  const stableFrames = 6;

  late DateTime now;
  late DocumentCaptureController controller;

  setUp(() {
    now = DateTime(2026, 1, 1);
    controller = DocumentCaptureController(
      documentType: DocumentType.thaiIdFront,
      clock: () => now,
    );
    controller.startDetection();
  });

  tearDown(() => controller.dispose());

  void advance(int ms) => now = now.add(Duration(milliseconds: ms));

  test('inactive before assistedFallbackMs elapses', () {
    for (var i = 0; i < stableFrames; i++) {
      expect(
        controller.assistedTick(sharp: true, stable: true),
        AssistedStatus.inactive,
      );
    }
    expect(controller.state, DocumentCaptureState.searching);
    expect(controller.captureLatched, isFalse);

    // Pre-window frames must not have accumulated: once the window opens
    // the full run of consecutive frames is still required.
    advance(fallbackMs);
    for (var i = 0; i < stableFrames - 1; i++) {
      expect(
        controller.assistedTick(sharp: true, stable: true),
        AssistedStatus.active,
      );
    }
    expect(controller.captureLatched, isFalse);
  });

  test(
    'captures after assistedStableFrames consecutive sharp+stable frames',
    () {
      advance(fallbackMs);
      for (var i = 0; i < stableFrames - 1; i++) {
        expect(
          controller.assistedTick(sharp: true, stable: true),
          AssistedStatus.active,
        );
        expect(controller.state, DocumentCaptureState.holdStill);
      }
      expect(controller.captureLatched, isFalse);

      expect(
        controller.assistedTick(sharp: true, stable: true),
        AssistedStatus.captured,
      );
      expect(controller.captureLatched, isTrue);
      expect(controller.assistedCaptureTriggered, isTrue);
      expect(controller.state, DocumentCaptureState.capturing);

      // Latched: further ticks are inert.
      expect(
        controller.assistedTick(sharp: true, stable: true),
        AssistedStatus.inactive,
      );
    },
  );

  test('a blurry or moving frame resets the consecutive run', () {
    advance(fallbackMs);
    for (var i = 0; i < stableFrames - 1; i++) {
      controller.assistedTick(sharp: true, stable: true);
    }

    // Blurry frame: run resets, chip warns tooBlurry.
    expect(
      controller.assistedTick(sharp: false, stable: true),
      AssistedStatus.active,
    );
    expect(controller.state, DocumentCaptureState.tooBlurry);

    // Moving frame (sharp but unstable): still resets, chip holdStill.
    expect(
      controller.assistedTick(sharp: true, stable: false),
      AssistedStatus.active,
    );
    expect(controller.state, DocumentCaptureState.holdStill);

    // The full run is required again after a reset.
    for (var i = 0; i < stableFrames - 1; i++) {
      expect(
        controller.assistedTick(sharp: true, stable: true),
        AssistedStatus.active,
      );
    }
    expect(controller.captureLatched, isFalse);
    expect(
      controller.assistedTick(sharp: true, stable: true),
      AssistedStatus.captured,
    );
  });

  test('startDetection clears assisted state for a retry', () {
    advance(fallbackMs);
    for (var i = 0; i < stableFrames; i++) {
      controller.assistedTick(sharp: true, stable: true);
    }
    expect(controller.assistedCaptureTriggered, isTrue);

    controller.startDetection();
    expect(controller.assistedCaptureTriggered, isFalse);
    expect(controller.captureLatched, isFalse);
    expect(controller.state, DocumentCaptureState.searching);
    // New session: the 4 s window and the frame run both start over.
    expect(
      controller.assistedTick(sharp: true, stable: true),
      AssistedStatus.inactive,
    );
  });
}
