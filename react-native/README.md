# iApp eKYC SDK — React Native

React Native wrapper around the iApp eKYC engine. It renders a full-screen
`react-native-webview` running the hosted bridge page
(`https://iapp.co.th/sdk/webview.html`) — the same production engine as the
Web SDK, so document auto-capture and Face Active Liveness behave
identically across platforms (docs/WEBVIEW_BRIDGE.md).

- **Requirements:** React Native ≥ 0.72, `react-native-webview` ≥ 13.6,
  iOS 15+ / Android minSdk 24, internet access, camera.
- **Billing:** the engine calls the paid iApp APIs with your key — same
  per-call pricing as any other integration.

## Install

Until the package is published to npm, install from a checkout:

```bash
git clone https://github.com/iapp-technology/iapp-ekyc-sdk
npm install ./iapp-ekyc-sdk/react-native react-native-webview
cd ios && pod install        # react-native-webview native module
```

Setup:

- **iOS:** add `NSCameraUsageDescription` to Info.plist.
- **Android:** add `<uses-permission android:name="android.permission.CAMERA" />`
  and request the runtime permission **before mounting the flow**
  (react-native-webview only auto-grants the in-page camera request when the
  app already holds it).

## Usage

```tsx
import { useState } from 'react';
import { Button, Modal, PermissionsAndroid, Platform } from 'react-native';
import { IappEkycFlow } from '@iapp-technology/react-native-ekyc-sdk';

export function KycScreen() {
  const [active, setActive] = useState(false);

  const start = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    }
    setActive(true);
  };

  return (
    <>
      <Button title="Capture Thai ID" onPress={start} />
      <Modal visible={active} animationType="slide" presentationStyle="fullScreen">
        <IappEkycFlow
          flow="documentCapture"
          documentType="thaiIdFront"
          apiKey="YOUR_API_KEY"
          locale="th"
          onResult={(result) => {
            setActive(false);
            if (result.flow === 'documentCapture') console.log(result.raw);
          }}
          onError={(error) => {
            setActive(false);
            if (error.code === 'INSUFFICIENT_CREDIT') {
              // top up at https://iapp.co.th/control/credits
            }
          }}
          onCancel={() => setActive(false)}
        />
      </Modal>
    </>
  );
}
```

Active liveness — send `verdict` + `signature` to **your backend** for HMAC
verification (docs/SECURITY.md); never trust `passed` alone on-device:

```tsx
<IappEkycFlow
  flow="activeLiveness"
  apiKey="YOUR_API_KEY"
  onResult={(result) => {
    if (result.flow === 'activeLiveness') {
      upload(result.verdict, result.signature, result.selfieImage);
    }
  }}
  onError={handleError}
  onCancel={close}
/>
```

## Props

| Prop | Notes |
|---|---|
| `flow` | `'documentCapture'` \| `'activeLiveness'` \| `'faceCapture'` |
| `apiKey` | `''` = proxy mode: set `baseUrl` to your backend that injects the key (docs/SECURITY.md) |
| `documentType` | required for `documentCapture` |
| `locale` | `'en'` \| `'th'` \| `'zh'` |
| `theme` | tokens → engine CSS variables (docs/THEMING.md) |
| `returnSelfieImage` | include base64 images in results (default true) |
| `hostPageUrl` | HTTPS only; override for self-hosted bridge pages |
| `onStateChange` | engine UX states (informational) |

Exactly one of `onResult` / `onError` / `onCancel` fires per mount.
Unmounting the component aborts the flow (camera and network stop with the
WebView). Full runnable snippet: [`example/README.md`](example/README.md).
