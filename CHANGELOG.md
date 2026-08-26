# Changelog

All notable changes to the iApp eKYC SDK are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

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
