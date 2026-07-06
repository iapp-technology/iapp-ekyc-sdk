# iApp eKYC SDK

**English** | [ภาษาไทย](README.th.md) | [中文](README.zh.md)

Free, open-source client SDKs for [iApp Technology](https://iapp.co.th)'s
enterprise eKYC APIs — automatic Thai ID card / passport capture, face
active liveness, face verification, and passive liveness — for **Flutter
(Android/iOS)** and **Web (HTML5/JavaScript)**.

The SDKs are free (Apache-2.0). API calls are billed per request to your
iApp API key — [get a key here](https://iapp.co.th/control/api-keys).
Full documentation: https://iapp.co.th/docs/ekyc/sdk/getting-started

## Features

| Capability | What the SDK does | API charged |
|---|---|---|
| 🪪 **ID Card auto-capture** | Detects the card boundary with OpenCV, waits for a sharp stable frame, perspective-corrects, submits | Thai National ID OCR (1.25 IC front / 0.75 IC back) |
| 🛂 **Passport auto-capture** | Same engine tuned for the passport data page (MRZ) | Passport OCR (0.75 IC) |
| 📇 **Official card auto-capture** | Driver license, bank book, ID card with signature | 1.0–1.25 IC/page |
| 🙂 **Face Active Liveness** | Randomized on-device challenges (blink, turn, smile), best-frame selection, **server-signed verdict** | Finalize API (1 IC) |
| 👥 **Face Verification** | One-call comparison of two face images | 0.3 IC |
| 🛡️ **Face Passive Liveness** | Single-image spoof check | 0.3 IC |

Professional light-blue UI theme (fully customizable) · UI strings in
**English, Thai, and Chinese** · no images stored on device · PDPA/GDPR
compliant processing.

## Quick start — Flutter

```yaml
# pubspec.yaml
dependencies:
  iapp_ekyc_sdk:
    git:
      url: https://github.com/iapp-technology/iapp-ekyc-sdk.git
      path: flutter
```

```dart
import 'package:iapp_ekyc_sdk/iapp_ekyc_sdk.dart';

final client = IappEkycClient(apiKey: 'YOUR_API_KEY');

// Automatic Thai ID card capture + OCR
final result = await DocumentCaptureView.start(
  context,
  client: client,
  documentType: DocumentType.thaiIdFront,
  locale: EkycLocale.th,
);

// Face active liveness with signed server verdict
final liveness = await ActiveLivenessView.start(context, client: client);
if (liveness.verdict.passed) { /* proceed with onboarding */ }
```

## Quick start — Web

```bash
npm install @iapp-technology/ekyc-sdk
```

```js
import { IappEkyc } from '@iapp-technology/ekyc-sdk';

const ekyc = new IappEkyc({ apiKey: 'YOUR_API_KEY' });

const result = await ekyc.captureDocument({
  mount: document.getElementById('ekyc-mount'),
  documentType: 'thaiIdFront',
  locale: 'th',
});

const liveness = await ekyc.startActiveLiveness({
  mount: document.getElementById('ekyc-mount'),
});
```

Or via `<script>` tag (UMD): the global `window.IappEkyc` is a namespace —
instantiate with `new window.IappEkyc.IappEkyc({ apiKey })`.

## Requirements

- **Flutter**: ≥ 3.32 / Dart ≥ 3.8 · Android minSdk 24 · iOS 15.5+
  (camera permission strings required — see `flutter/example`)
- **Web**: modern browsers with WebAssembly + `getUserMedia`
  (HTTPS or localhost required). OpenCV/MediaPipe assets are lazy-loaded
  only when a capture flow starts.

## Documentation

- [Getting started](https://iapp.co.th/docs/ekyc/sdk/getting-started) ·
  [Algorithm spec](docs/ALGORITHM.md) ·
  [Active liveness spec](docs/ACTIVE_LIVENESS.md) ·
  [API contracts](docs/API_CONTRACTS.md) ·
  [Theming](docs/THEMING.md) ·
  [Security](docs/SECURITY.md)

## Security note

API keys shipped in client apps can be extracted. For production, use the
backend-proxy pattern described in [docs/SECURITY.md](docs/SECURITY.md),
and always verify the finalize endpoint's **signed verdict** on your
backend — never trust on-device results alone.

## License

Apache License 2.0 — Copyright 2026 iApp Technology Co., Ltd.
See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Support

- 📚 Docs: https://iapp.co.th/docs/category/-electronic-know-your-customer-e-kyc
- 💬 Discord: https://discord.gg/kYcpmdEcS2
- ✉️ sale@iapp.co.th · ☎️ 086-322-5858
