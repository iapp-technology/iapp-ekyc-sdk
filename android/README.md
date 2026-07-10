# iApp eKYC SDK — Android (Kotlin / Java)

Native Android wrapper around the iApp eKYC engine. It launches a
full-screen WebView activity running the hosted bridge page
(`https://iapp.co.th/sdk/webview.html`) — the same production engine as the
Web SDK, so document auto-capture and Face Active Liveness behave
identically across platforms (docs/WEBVIEW_BRIDGE.md).

- **Requirements:** minSdk 24, an up-to-date Android System WebView
  (Chrome/WebView ≥ 100 recommended), internet access, camera.
- **Billing:** the engine calls the paid iApp APIs with your key — same
  per-call pricing as any other integration.

## Install (JitPack)

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositories {
        google(); mavenCentral()
        maven("https://jitpack.io")
    }
}

// app/build.gradle.kts
dependencies {
    implementation("com.github.iapp-technology:iapp-ekyc-sdk:v0.2.0")
}
```

The library declares the `CAMERA` and `INTERNET` permissions in its manifest
and requests the runtime permission itself before opening the camera.

## Kotlin (ActivityResult contract — recommended)

```kotlin
val config = IappEkycConfig.Builder("YOUR_API_KEY").locale(EkycLocale.TH).build()

private val ekyc = registerForActivityResult(IappEkycContract()) { result ->
    when (result) {
        is IappEkycResult.DocumentCaptured -> handleOcr(result.rawJson)
        is IappEkycResult.LivenessPassed ->
            // Verify verdictJson + signature on YOUR backend (docs/SECURITY.md);
            // never trust `passed` alone on-device.
            upload(result.verdictJson, result.signature, result.selfieImage)
        is IappEkycResult.FaceCaptured -> useSelfie(result.image)
        is IappEkycResult.Failed -> show(result.error)   // error.code: EkycErrorCode
        IappEkycResult.Cancelled -> {}
    }
}

// Launch:
ekyc.launch(IappEkycRequest.DocumentCapture(config, EkycDocumentType.THAI_ID_FRONT))
ekyc.launch(IappEkycRequest.ActiveLiveness(config))
```

## Java (simple callback)

```java
IappEkycConfig config = new IappEkycConfig.Builder("YOUR_API_KEY")
        .locale(EkycLocale.TH).build();

IappEkyc.start(this,
        new IappEkycRequest.DocumentCapture(config, EkycDocumentType.THAI_ID_FRONT),
        new IappEkycCallback() {
            @Override public void onResult(IappEkycResult result) {
                if (result instanceof IappEkycResult.DocumentCaptured) {
                    String ocrJson = ((IappEkycResult.DocumentCaptured) result).getRawJson();
                }
            }
            @Override public void onError(IappEkycError error) {
                if (error.getCode() == EkycErrorCode.INSUFFICIENT_CREDIT) { /* top up */ }
            }
            @Override public void onCancelled() { }
        });
```

## Configuration

| `IappEkycConfig.Builder` | Notes |
|---|---|
| `apiKey` (constructor) | `""` = proxy mode: set `baseUrl` to your backend that injects the key (docs/SECURITY.md) |
| `locale(...)` | `EN` / `TH` / `ZH` |
| `theme(...)` | `IappEkycTheme.Builder` tokens → engine CSS variables (docs/THEMING.md) |
| `returnSelfieImage(...)` | include JPEG bytes in results (default true) |
| `hostPageUrl(...)` | HTTPS only; override for self-hosted bridge pages |

Notes:

- Captured images cross the activity boundary via cache files that are
  **deleted immediately on read** (Binder Intents cap at ~1 MB). Call
  `IappEkyc.clearCache(context)` on app start to sweep leftovers from
  process death.
- The back button cancels the flow (`IappEkycResult.Cancelled`).
- Example app: [`example/`](example/) (Kotlin + Java screens).
