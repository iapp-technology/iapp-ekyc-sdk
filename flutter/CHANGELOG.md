## 0.1.0

Initial release.

* Document auto-capture (`DocumentCaptureView`) for Thai national ID
  (front/back/with signature), Thai driver license, book bank and
  passport — OpenCV quad detection, stability tracking, sharpness gating,
  perspective correction and upload.
* Face active liveness (`ActiveLivenessView`) — randomized on-device
  challenges (blink / turn left / turn right / smile), anti-cheat
  restarts, session-wide best-frame selfie selection and server-side
  finalization with a signed verdict.
* Face APIs (`IappEkycClient`) — face verification, passive liveness and
  active-liveness finalize with a typed error model and a strict
  no-retry-after-send billing policy.
* Theming (`EkycTheme`) and i18n (English, Thai, Chinese) with per-key
  overrides.
