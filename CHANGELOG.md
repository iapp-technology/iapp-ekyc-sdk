# Changelog

All notable changes to the iApp eKYC SDK are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

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
