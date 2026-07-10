# iApp eKYC SDK

**English** | [ภาษาไทย](README.th.md) | [中文](README.zh.md)

Free, open-source client SDKs for [iApp Technology](https://iapp.co.th)'s
enterprise eKYC APIs — automatic Thai ID card / passport capture, face
active liveness, face verification, and passive liveness — for **Web
(HTML5/JavaScript)**, **Flutter (Android/iOS)**, **native iOS
(Swift/Objective-C)**, **native Android (Kotlin/Java)**, and
**React Native**.

The Web and Flutter packages run the capture engine directly on-device.
The iOS, Android, and React Native packages are thin native shells around
the same production web engine via a hosted WebView bridge page — identical
capture quality on every platform, ~zero added binary size
([docs/WEBVIEW_BRIDGE.md](docs/WEBVIEW_BRIDGE.md)).

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

## Quick start — iOS (Swift / Objective-C)

Xcode → **File → Add Package Dependencies…** →
`https://github.com/iapp-technology/iapp-ekyc-sdk` (product **IappEkyc**),
then add `NSCameraUsageDescription` to Info.plist:

```swift
import IappEkyc

let config = IappEkycConfig(apiKey: "YOUR_API_KEY", flow: .documentCapture)
config.documentType = .thaiIdFront
config.locale = .th

IappEkycSdk.present(from: self, config: config) { result in
    if case .success(let outcome) = result {
        print(outcome.document?.rawJSON ?? [:])
    }
}
```

Objective-C is fully supported — see [ios/README.md](ios/README.md).

## Quick start — Android (Kotlin / Java)

```kotlin
// settings.gradle.kts: repositories { maven("https://jitpack.io") }
// app/build.gradle.kts:
dependencies { implementation("com.github.iapp-technology:iapp-ekyc-sdk:v0.2.0") }
```

```kotlin
val config = IappEkycConfig.Builder("YOUR_API_KEY").locale(EkycLocale.TH).build()

private val ekyc = registerForActivityResult(IappEkycContract()) { result ->
    when (result) {
        is IappEkycResult.DocumentCaptured -> handleOcr(result.rawJson)
        is IappEkycResult.Failed -> show(result.error)
        else -> {}
    }
}
ekyc.launch(IappEkycRequest.DocumentCapture(config, EkycDocumentType.THAI_ID_FRONT))
```

Java is fully supported (`IappEkyc.start(...)` callback API) — see
[android/README.md](android/README.md).

## Quick start — React Native

```bash
git clone https://github.com/iapp-technology/iapp-ekyc-sdk
npm install ./iapp-ekyc-sdk/react-native react-native-webview
```

```tsx
import { IappEkycFlow } from '@iapp-technology/react-native-ekyc-sdk';

<Modal visible={active} presentationStyle="fullScreen">
  <IappEkycFlow
    flow="documentCapture"
    documentType="thaiIdFront"
    apiKey="YOUR_API_KEY"
    locale="th"
    onResult={(r) => { setActive(false); console.log(r); }}
    onError={(e) => setActive(false)}
    onCancel={() => setActive(false)}
  />
</Modal>
```

See [react-native/README.md](react-native/README.md) for permission setup.

## Requirements

- **Flutter**: ≥ 3.32 / Dart ≥ 3.8 · Android minSdk 24 · iOS 15.5+
  (camera permission strings required — see `flutter/example`)
- **Web**: modern browsers with WebAssembly + `getUserMedia`
  (HTTPS or localhost required). OpenCV/MediaPipe assets are lazy-loaded
  only when a capture flow starts.
- **iOS (native)**: iOS 15+ · Swift Package Manager · `NSCameraUsageDescription`
- **Android (native)**: minSdk 24 · up-to-date Android System WebView
  (Chrome/WebView ≥ 100 recommended)
- **React Native**: RN ≥ 0.72 · `react-native-webview` ≥ 13.6
- The native iOS / Android / React Native shells need internet access to
  `https://iapp.co.th/sdk/webview.html` at runtime (eKYC always needs
  connectivity for the API calls anyway).

## Documentation

- [Getting started](https://iapp.co.th/docs/ekyc/sdk/getting-started) ·
  [Algorithm spec](docs/ALGORITHM.md) ·
  [Active liveness spec](docs/ACTIVE_LIVENESS.md) ·
  [API contracts](docs/API_CONTRACTS.md) ·
  [WebView bridge](docs/WEBVIEW_BRIDGE.md) ·
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
