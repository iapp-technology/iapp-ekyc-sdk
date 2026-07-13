# iApp eKYC SDK

[English](README.md) | [ภาษาไทย](README.th.md) | **中文**

[![npm — @iapp-technology/ekyc-sdk](https://img.shields.io/npm/v/@iapp-technology/ekyc-sdk?logo=npm&color=0284C7&label=%40iapp-technology%2Fekyc-sdk)](https://www.npmjs.com/package/@iapp-technology/ekyc-sdk)
[![npm — react-native-ekyc-sdk](https://img.shields.io/npm/v/@iapp-technology/react-native-ekyc-sdk?logo=npm&color=0284C7&label=react-native-ekyc-sdk)](https://www.npmjs.com/package/@iapp-technology/react-native-ekyc-sdk)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0284C7)](LICENSE)

[iApp Technology](https://iapp.co.th) 企业级 eKYC API 的免费开源客户端
SDK——泰国身份证/护照自动拍摄、人脸主动活体检测、人脸比对与静默活体检测,
支持 **Web(HTML5/JavaScript)**、**Flutter(Android/iOS)**、
**原生 iOS(Swift/Objective-C)**、**原生 Android(Kotlin/Java)** 与
**React Native** 平台。

Web 与 Flutter 包在设备端直接运行采集引擎;iOS、Android 与 React Native
包则是轻量原生外壳,通过托管的 WebView 桥接页面调用同一套生产级 Web
引擎——各平台采集质量完全一致,且几乎不增加安装包体积
([docs/WEBVIEW_BRIDGE.md](docs/WEBVIEW_BRIDGE.md))。

SDK 本身完全免费(Apache-2.0 许可证),API 调用按次计费,须使用您的 iApp
API 密钥 — [请在此申请密钥](https://iapp.co.th/control/api-keys)。
完整文档:https://iapp.co.th/docs/ekyc/sdk/getting-started

## 功能特性

| 功能 | SDK 的处理流程 | API 计费 |
|---|---|---|
| 🪪 **身份证自动拍摄** | 通过 OpenCV 检测证件边框,等待画面清晰稳定后自动拍摄,校正透视并提交识别 | 正面 1.25 IC / 背面 0.75 IC |
| 🛂 **护照自动拍摄** | 同一引擎,针对护照资料页(MRZ)优化 | 0.75 IC |
| 📇 **其他官方证件自动拍摄** | 驾驶证、银行存折、带签名身份证 | 每页 1.0–1.25 IC |
| 🙂 **人脸主动活体检测** | 设备端随机指令(眨眼、转头、微笑),自动选取最佳帧,并由**服务器返回带数字签名的判定结果** | 1 IC |
| 👥 **人脸比对** | 一次调用完成两张人脸照片的比对 | 0.3 IC |
| 🛡️ **静默活体检测** | 单张照片防伪检测 | 0.3 IC |

专业浅蓝色界面主题(可完全自定义)· 界面文字支持**中文、英文、泰文**
· 不在设备上存储任何图像 · 数据处理符合 PDPA 与 GDPR 规范。

## 快速开始 — Flutter

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

// 身份证自动拍摄与识别
final result = await DocumentCaptureView.start(
  context,
  client: client,
  documentType: DocumentType.thaiIdFront,
  locale: EkycLocale.zh,
);

// 主动活体检测(服务器签名判定)
final liveness = await ActiveLivenessView.start(context, client: client);
if (liveness.verdict.passed) { /* 继续后续流程 */ }
```

## 快速开始 — Web

```bash
npm install @iapp-technology/ekyc-sdk
```

```js
import { IappEkyc } from '@iapp-technology/ekyc-sdk';

const ekyc = new IappEkyc({ apiKey: 'YOUR_API_KEY' });

const result = await ekyc.captureDocument({
  mount: document.getElementById('ekyc-mount'),
  documentType: 'thaiIdFront',
  locale: 'zh',
});
```

## 快速开始 — iOS(Swift / Objective-C)

在 Xcode 中选择 **File → Add Package Dependencies…** →
`https://github.com/iapp-technology/iapp-ekyc-sdk`(产品 **IappEkyc**),
并在 Info.plist 中添加 `NSCameraUsageDescription`:

```swift
import IappEkyc

let config = IappEkycConfig(apiKey: "YOUR_API_KEY", flow: .documentCapture)
config.documentType = .thaiIdFront
config.locale = .zh

IappEkycSdk.present(from: self, config: config) { result in
    if case .success(let outcome) = result {
        print(outcome.document?.rawJSON ?? [:])
    }
}
```

完整支持 Objective-C — 详见 [ios/README.md](ios/README.md)。

## 快速开始 — Android(Kotlin / Java)

```kotlin
// settings.gradle.kts: repositories { maven("https://jitpack.io") }
// app/build.gradle.kts:
dependencies { implementation("com.github.iapp-technology:iapp-ekyc-sdk:v0.2.0") }
```

```kotlin
val config = IappEkycConfig.Builder("YOUR_API_KEY").locale(EkycLocale.ZH).build()

private val ekyc = registerForActivityResult(IappEkycContract()) { result ->
    when (result) {
        is IappEkycResult.DocumentCaptured -> handleOcr(result.rawJson)
        is IappEkycResult.Failed -> show(result.error)
        else -> {}
    }
}
ekyc.launch(IappEkycRequest.DocumentCapture(config, EkycDocumentType.THAI_ID_FRONT))
```

完整支持 Java(`IappEkyc.start(...)` 回调 API)— 详见
[android/README.md](android/README.md)。

## 快速开始 — React Native

```bash
npm install @iapp-technology/react-native-ekyc-sdk react-native-webview
```

```tsx
import { IappEkycFlow } from '@iapp-technology/react-native-ekyc-sdk';

<Modal visible={active} presentationStyle="fullScreen">
  <IappEkycFlow
    flow="documentCapture"
    documentType="thaiIdFront"
    apiKey="YOUR_API_KEY"
    locale="zh"
    onResult={(r) => { setActive(false); console.log(r); }}
    onError={(e) => setActive(false)}
    onCancel={() => setActive(false)}
  />
</Modal>
```

摄像头权限配置请参阅 [react-native/README.md](react-native/README.md)。

## 系统要求

- **Flutter**:≥ 3.32 / Dart ≥ 3.8 · Android minSdk 24 · iOS 15.5 及以上
- **Web**:支持 WebAssembly 与 `getUserMedia` 的现代浏览器
  (须使用 HTTPS 或 localhost)
- **iOS(原生)**:iOS 15 及以上 · Swift Package Manager ·
  须配置 `NSCameraUsageDescription`
- **Android(原生)**:minSdk 24 · 最新版 Android System WebView
  (建议 Chrome/WebView ≥ 100)
- **React Native**:RN ≥ 0.72 · `react-native-webview` ≥ 13.6
- 原生 iOS / Android / React Native 外壳运行时需要访问
  `https://iapp.co.th/sdk/webview.html`(eKYC 调用 API 本身即需联网)

## 安全提示

嵌入客户端应用的 API 密钥存在被提取的风险。生产环境请采用
[docs/SECURITY.md](docs/SECURITY.md) 中介绍的后端代理模式,并务必在您的
服务器端验证 finalize 接口返回的**数字签名判定结果**,切勿仅信任设备端结论。

## 许可证

Apache License 2.0 — 版权所有 © 2026 iApp Technology Co., Ltd.

## 联系我们

- 📚 文档:https://iapp.co.th/docs/category/-electronic-know-your-customer-e-kyc
- 💬 Discord:https://discord.gg/kYcpmdEcS2
- ✉️ sale@iapp.co.th · ☎️ 086-322-5858
