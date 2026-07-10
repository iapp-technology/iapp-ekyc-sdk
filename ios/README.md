# iApp eKYC SDK — iOS (Swift / Objective-C)

Native iOS wrapper around the iApp eKYC engine. It presents a full-screen
`WKWebView` running the hosted bridge page
(`https://iapp.co.th/sdk/webview.html`) — the same production engine as the
Web SDK, so document auto-capture and Face Active Liveness behave
identically across platforms (docs/WEBVIEW_BRIDGE.md).

- **Requirements:** iOS 15+, internet access, camera.
- **Billing:** the engine calls the paid iApp APIs with your key — same
  per-call pricing as any other integration.

## Install (Swift Package Manager)

In Xcode: **File → Add Package Dependencies…** →
`https://github.com/iapp-technology/iapp-ekyc-sdk` → product **IappEkyc**.

Or in `Package.swift`:

```swift
.package(url: "https://github.com/iapp-technology/iapp-ekyc-sdk", from: "0.2.0")
```

Add `NSCameraUsageDescription` to your app's Info.plist (the flow fails fast
with `.invalidConfig` if it is missing).

## Swift

```swift
import IappEkyc

let config = IappEkycConfig(apiKey: "YOUR_API_KEY", flow: .documentCapture)
config.documentType = .thaiIdFront
config.locale = .th

IappEkycSdk.present(from: self, config: config) { result in
    switch result {
    case .success(let outcome):
        print(outcome.document?.rawJSON ?? [:])       // full OCR response
    case .failure(let error as NSError)
    where error.code == IappEkycErrorCode.cancelled.rawValue:
        break                                          // user cancelled
    case .failure(let error):
        print(error.localizedDescription)
    }
}
```

Active liveness — send `verdictJSON` + `signature` to **your backend** for
HMAC verification (docs/SECURITY.md); never trust `passed` alone on-device:

```swift
let config = IappEkycConfig(apiKey: "YOUR_API_KEY", flow: .activeLiveness)
IappEkycSdk.present(from: self, config: config) { result in
    if case .success(let outcome) = result, let liveness = outcome.liveness {
        upload(liveness.verdictJSON, liveness.signature, liveness.selfieImageData)
    }
}
```

## Objective-C

```objc
@import IappEkyc;

IappEkycConfig *config = [[IappEkycConfig alloc] initWithApiKey:@"YOUR_API_KEY"
                                                           flow:IappEkycFlowTypeDocumentCapture];
config.documentType = IappEkycDocumentTypeThaiIdFront;
config.locale = IappEkycLocaleTh;
[IappEkycSdk presentFrom:self config:config delegate:self];

// IappEkycViewControllerDelegate
- (void)ekycController:(IappEkycViewController *)c didFinishWithResult:(IappEkycResult *)result {
    NSLog(@"%@", result.document.rawJSON);
}
- (void)ekycController:(IappEkycViewController *)c didFailWithError:(NSError *)error {
    if (error.code == IappEkycErrorCodeInsufficientCredit) { /* top up */ }
}
- (void)ekycControllerDidCancel:(IappEkycViewController *)c {}
```

## Configuration

| `IappEkycConfig` | Notes |
|---|---|
| `apiKey` | `""` = proxy mode: set `baseUrl` to your backend that injects the key (docs/SECURITY.md) |
| `flow` | `.documentCapture` / `.activeLiveness` / `.faceCapture` |
| `documentType` | `.thaiIdFront` `.thaiIdBack` `.thaiIdWithSignature` `.thaiDriverLicense` `.bookBank` `.passport` |
| `locale` | `.en` / `.th` / `.zh` |
| `theme` | `IappEkycTheme` tokens → engine CSS variables (docs/THEMING.md) |
| `returnSelfieImage` | include JPEG bytes in results (default true) |
| `hostPageURL` | HTTPS only; override for self-hosted bridge pages |

Errors arrive as `NSError` (domain `th.co.iapp.ekyc`) with
`IappEkycErrorCode` codes and the engine i18n key under
`IappEkycErrorMessageKeyKey`. Aborting programmatically = dismiss the
controller; the flow tears down the camera and reports a cancel.

Example app files: [`Example/`](Example/).
