# Changelog

All notable changes to the iApp eKYC SDK are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

## [web 0.2.6] — 2026-08-26

### Added
- **Fault-injection hook for the GPU-garbage device class**: setting
  `window.__iappEkycSimulateBrokenGpu = true` before a flow starts makes
  every GPU-path landmarker return the exact garbage the field device
  produces (two landmark sets at ~1e12 coordinates) while the CPU delegate
  stays real. Inert unless the flag is set. This allowed the whole recovery
  chain to be verified end to end in a real browser with a fake camera fed
  by the field device's own screen recording: first session recovers to CPU
  and reaches the challenge phase in 7.7 s and persists the pin; the next
  session starts pinned and reaches it in 2.9 s; a healthy control run is
  unaffected and sets no pin.

## [web 0.2.5] — 2026-08-26

### Fixed
- **CPU-delegate recovery now engages fast enough to matter.** The field
  device's facecheck report showed the broken GPU path is also SLOW (~7
  frames in ~8 s), so 0.2.4's 15-consecutive-frame trigger would have taken
  15+ seconds — indistinguishable from a hang. Recovery now also fires
  after 3+ unusable frames spanning 2 seconds, whichever comes first.

### Added
- **Persisted delegate preference** (`delegate-preference.ts`): once a
  session proves the CPU fallback works where the GPU delegate emits
  garbage, the preference is stored (localStorage, best-effort, guarded for
  WebViews that deny storage) and later sessions start straight on the CPU
  delegate — no per-session recovery delay. A pinned session that still
  gets garbage clears the pin (a driver update may have fixed the GPU) and
  fails with the typed error. Exports: `readPersistedCpuPin`,
  `persistCpuPin`, `clearCpuPin`.
- **facecheck page revision 2 — two-phase.** The previous page only tested
  the default delegate, so on a GPU-garbage device it reported "blocked on
  100% of frames" even though the real flow would switch to CPU — alarming
  and wrong. It now runs the default order and then the CPU delegate
  (~9 s each), reports per-delegate gate results, includes the WebGL
  renderer string and the persisted-pin state, and its conclusion states
  directly whether the automatic fallback rescues the device. Also fixes a
  double-tap race that could start two concurrent runs.

## [web 0.2.4] — 2026-08-26

### Fixed
- **Unusable detector output no longer hangs the flow.** A Galaxy S25 Ultra
  returned landmark coordinates around **1e12** instead of the normalized
  0..1 — the model was running, its output was numerically garbage. That
  produced a face box 1.37e12 wide and a centre offset of 2.2e11 against a
  0.12 threshold, so the flow sat on "position your face inside the oval"
  forever, with no error and no `onError`. The same fault, before the 0.2.2
  filtering, is what produced the original "only one face may be in view"
  report: two garbage sets counted as two people.
  - `selectFaces()` discards landmark sets that are not plausibly
    normalized (outside roughly [-1, 2], or a side longer than 2 frames) and
    counts them in the new `FaceSelection.rejected`. Bounds are generous by
    design: a face at the very edge of frame overshoots slightly and must
    still count.
  - `rejected > 0 && count === 0` now makes active liveness and face capture
    **rebuild the landmarker on the CPU delegate** after 15 consecutive
    frames (~0.5 s), once per session.
  - If the CPU delegate is no better, the session fails with the new
    `FaceDetectorUnavailableError` (bridge code
    `FACE_DETECTOR_UNAVAILABLE`, message key `error_face_detector`, EN/TH/ZH)
    so the host app's error callback finally fires instead of the user
    staring at a hint they cannot act on.
  - `loadFaceLandmarker` caches one instance **per delegate**, so the CPU
    reload cannot be handed the broken GPU instance back.

### Added
- `facecheck.html` reports "detector output unusable" as its own blocking
  step, prints billion-scale coordinates in exponential notation, and
  records the video dimensions during the run (stopping the camera zeroed
  them, so a report copied afterwards read `0x0`).

## [web 0.2.3] — 2026-08-26

### Fixed
- `mapObservation()` threw on every frame if a detector returned landmarks
  without the `faceBlendshapes` / `facialTransformationMatrixes` arrays. An
  exception inside the render loop freezes the UI on whatever message it
  last showed, with nothing surfaced to the host app — the hardest possible
  failure to diagnose from the outside. Both reads are now optional-chained
  on the array itself.

### Added
- `facecheck.html` now runs the same gate the `findFace` phase applies and
  reports which step blocks the flow (no face / more than one person / face
  too small / face off centre), the measured `faceWidthFrac` and centre
  offset per frame, and the min/median/max offset against the 0.12
  threshold. A single report from a misbehaving device now identifies the
  blocking step instead of narrowing it to two candidates.

## [web 0.2.2 / flutter 0.1.1] — 2026-08-26

### Fixed
- **Active liveness / face capture stuck on "only one face may be in view"**
  on some high-end Android phones (reported on a Galaxy S25 Ultra, single
  user in frame, no reflection, unchanged under bright light). The face
  landmarker tracks up to two faces, so its detector re-scans the frame for
  a second face on every frame; on wide-FOV, high-resolution front cameras
  it periodically returns a phantom — the subject's own face boxed a second
  time, or a face-like pattern in the background — which pinned the flow in
  `findFace` with no error and no `onError` callback (the message is UX
  guidance, not an error).
  - `selectFaces()` (`face-metrics.ts`) now reduces the detector's list to
    actual people: degenerate boxes dropped, the **largest** face taken as
    the subject, and a second face counted only when it is big enough
    (≥ 6% of the frame and ≥ 40% of the subject's width) and does not
    overlap the subject (< 30% of the smaller box).
  - Every per-face read — bounding box, blendshapes, transformation matrix
    — now uses the subject's index instead of slot 0, which a phantom could
    occupy and thereby feed the challenge machine another face's pose,
    blink and smile scores.
  - The second-person rule is debounced: `count > 1` must hold for **5**
    consecutive frames (`multiFaceFrames`) before it blocks `findFace`,
    shows `multiple_faces` or restarts a challenge, and it restarts once
    per streak rather than once per frame. Previously a single phantom
    frame restarted the challenge and three of them failed the session.
  - Genuine two-person frames are unaffected: they still block the flow and
    restart the challenge.

- **Flutter SDK (parity, same defect class)**: `faceObservationFrom()` now
  counts people rather than detections (identical size/overlap rules), the
  challenge machine debounces the second-person rule with the same
  `multiFaceFrames` (5), and the best-frame / fallback crops follow the new
  `subjectFace()` helper instead of `faces.first`, which was not
  necessarily the face the metrics described.

### Added
- `faceSelection` option on `startActiveLiveness()` and `captureFace()` to
  override the filter thresholds per session, plus the `selectFaces`,
  `DEFAULT_FACE_SELECTION_CONFIG`, `FaceSelection`, `FaceSelectionConfig`
  and `FaceBox` exports.
- `FaceObservation.rawFaceCount` — the pre-filter detector count, for
  support diagnostics via the `onObservation` hook.
- `MachineSnapshot.multiFace` (web) / `ChallengeStateMachine.multiFaceDetected`
  (Flutter) — the debounced second-person state.
- Flutter `subjectFace()` export and `test/face_metrics_test.dart`
  (8 cases). Web suite 95 → 108 tests, Flutter 44 → 54.

Engine-only release: `SDK_VERSION` moves to `0.2.2` and the hosted bundle
(`https://iapp.co.th/sdk/ekyc-sdk.umd.js`) carries the fix, so the iOS,
Android, React Native and Web integrations pick it up with **no app
update** — they load the hosted engine at runtime.

## [web 0.2.1] — 2026-07-13

### Changed
- **`@iapp-technology/ekyc-sdk`**: added a package `README.md` so the npm
  listing shows install/usage docs. Packaging-only patch — the engine is
  unchanged (`SDK_VERSION` stays `0.2.0`, same as the hosted UMD and the
  native wrappers).

## [0.2.0] — 2026-07-10

### Added
- **Native iOS package `IappEkyc`** (Swift Package Manager, iOS 15+):
  full-screen `IappEkycViewController` / `IappEkycSdk.present(...)` running
  the production web engine in a WKWebView; Swift closures and an
  Objective-C-compatible delegate API; silent in-page camera grant after the
  native permission prompt.
- **Native Android library `com.iapp.ekyc:ekyc-sdk`** (JitPack
  `com.github.iapp-technology:iapp-ekyc-sdk`, minSdk 24): `IappEkycContract`
  (ActivityResult API) and Java-friendly `IappEkyc.start(...)` callbacks;
  images cross the activity boundary via delete-on-read cache files (Binder
  1 MB cap).
- **React Native package `@iapp-technology/react-native-ekyc-sdk`**:
  `<IappEkycFlow />` full-screen component over `react-native-webview`.
- **Shared WebView host page + bridge protocol v1**
  (`shared/webview/webview.html`, hosted at
  `https://iapp.co.th/sdk/webview.html`; spec in `docs/WEBVIEW_BRIDGE.md`)
  used by all three native shells — one engine, identical capture quality
  everywhere.
- **Web engine `integration` option** (`IappEkycOptions.integration`) so
  wrapper SDKs report their identity in the active-liveness challenge log
  `sdk` block; new `resolveSdkIdentity()` export.
- CI workflows for iOS (xcodebuild), Android (Gradle), and React Native
  (tsc), path-filtered like the existing Flutter/Web jobs.

### Changed
- Active liveness: blink and smile challenges now pass reliably in hard
  lighting (backlight, glasses glare) — mean-eye blink depth with a per-eye
  dip gate, relaxed adaptive thresholds, smile scored as the max of both
  mouth corners at ≥ 0.45 for 350 ms. Photo-attack and wink-rejection
  invariants preserved and covered by new tests.

## [0.1.0] — 2026-07-04

### Added
- Initial public release.
- **Flutter package `iapp_ekyc_sdk`** (Android / iOS):
  - Automatic document capture (Thai National ID front/back, passport,
    driver license, bank book, ID card with signature) with OpenCV
    quadrilateral detection, sharpness scoring, stability tracking, and
    perspective correction.
  - Face Active Liveness Detection with randomized on-device challenges
    (blink, turn left, turn right, smile) and server-side finalization.
  - Face Verification and Face Passive Liveness API clients.
  - Light-blue default theme (`EkycTheme.lightBlue`), fully overridable.
  - Built-in UI localization: English, Thai, Chinese.
- **Web package `@iapp-technology/ekyc-sdk`** (ES module + UMD):
  - Same capture flows implemented with OpenCV.js and MediaPipe Tasks
    Vision, lazy-loaded so the core bundle stays small.
  - Identical API client surface and error model as the Flutter package.
- Shared algorithm specifications under `docs/`.
