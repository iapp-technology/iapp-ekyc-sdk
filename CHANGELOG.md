# Changelog

All notable changes to the iApp eKYC SDK are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

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
