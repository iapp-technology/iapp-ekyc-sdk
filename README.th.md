# iApp eKYC SDK

[English](README.md) | **ภาษาไทย** | [中文](README.zh.md)

[![npm — @iapp-technology/ekyc-sdk](https://img.shields.io/npm/v/@iapp-technology/ekyc-sdk?logo=npm&color=0284C7&label=%40iapp-technology%2Fekyc-sdk)](https://www.npmjs.com/package/@iapp-technology/ekyc-sdk)
[![npm — react-native-ekyc-sdk](https://img.shields.io/npm/v/@iapp-technology/react-native-ekyc-sdk?logo=npm&color=0284C7&label=react-native-ekyc-sdk)](https://www.npmjs.com/package/@iapp-technology/react-native-ekyc-sdk)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0284C7)](LICENSE)

ชุดพัฒนาซอฟต์แวร์ (SDK) แบบโอเพนซอร์สสำหรับบริการ eKYC ระดับองค์กรของ
[บริษัท ไอแอพพ์เทคโนโลยี จำกัด](https://iapp.co.th) — ถ่ายภาพบัตรประชาชน/
หนังสือเดินทางอัตโนมัติ ตรวจสอบการมีชีวิตแบบแอ็กทีฟ (Active Liveness)
เปรียบเทียบใบหน้า และตรวจจับภาพปลอม — รองรับ **เว็บ (HTML5/JavaScript)**,
**Flutter (Android/iOS)**, **iOS เนทีฟ (Swift/Objective-C)**,
**Android เนทีฟ (Kotlin/Java)** และ **React Native**

แพ็กเกจเว็บและ Flutter ประมวลผลบนอุปกรณ์โดยตรง ส่วนแพ็กเกจ iOS, Android
และ React Native เป็นเชลล์เนทีฟขนาดเบาที่เรียกใช้เอนจินเว็บตัวเดียวกัน
ผ่านหน้า WebView ที่โฮสต์ไว้ — คุณภาพการถ่ายภาพเหมือนกันทุกแพลตฟอร์ม
โดยแทบไม่เพิ่มขนาดแอป ([docs/WEBVIEW_BRIDGE.md](docs/WEBVIEW_BRIDGE.md))

SDK ใช้งานได้ฟรี (สัญญาอนุญาต Apache-2.0) โดยคิดค่าบริการเฉพาะการเรียกใช้
API ตามจำนวนครั้งผ่านคีย์ API ของท่าน —
[สมัครรับคีย์ API ได้ที่นี่](https://iapp.co.th/control/api-keys)
เอกสารฉบับเต็ม: https://iapp.co.th/docs/ekyc/sdk/getting-started

## ความสามารถ

| ความสามารถ | การทำงานของ SDK | ค่าบริการ API |
|---|---|---|
| 🪪 **ถ่ายบัตรประชาชนอัตโนมัติ** | ตรวจจับขอบบัตรด้วย OpenCV รอจังหวะภาพคมชัดและนิ่ง ปรับมุมมองภาพ แล้วส่งประมวลผล OCR | 1.25 IC (ด้านหน้า) / 0.75 IC (ด้านหลัง) |
| 🛂 **ถ่ายหนังสือเดินทางอัตโนมัติ** | กลไกเดียวกัน ปรับแต่งสำหรับหน้าข้อมูลหนังสือเดินทาง (MRZ) | 0.75 IC |
| 📇 **ถ่ายบัตรราชการอื่น ๆ** | ใบขับขี่ สมุดบัญชีธนาคาร บัตรประชาชนพร้อมลายเซ็น | 1.0–1.25 IC/หน้า |
| 🙂 **Active Liveness** | คำสั่งสุ่มบนอุปกรณ์ (กะพริบตา หันหน้า ยิ้ม) เลือกภาพที่ดีที่สุด และ**รับผลตัดสินที่ลงลายเซ็นดิจิทัลจากเซิร์ฟเวอร์** | 1 IC |
| 👥 **เปรียบเทียบใบหน้า** | เปรียบเทียบภาพใบหน้าสองภาพในการเรียกครั้งเดียว | 0.3 IC |
| 🛡️ **Passive Liveness** | ตรวจสอบภาพปลอมจากภาพเดียว | 0.3 IC |

ธีมสีฟ้าอ่อนที่ดูเป็นมืออาชีพ (ปรับแต่งได้ทั้งหมด) · ข้อความบนหน้าจอรองรับ
**ภาษาไทย อังกฤษ และจีน** · ไม่บันทึกภาพลงอุปกรณ์ ·
การประมวลผลเป็นไปตาม PDPA และ GDPR

## เริ่มต้นใช้งาน — Flutter

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

// ถ่ายภาพบัตรประชาชนอัตโนมัติพร้อม OCR
final result = await DocumentCaptureView.start(
  context,
  client: client,
  documentType: DocumentType.thaiIdFront,
  locale: EkycLocale.th,
);

// ตรวจสอบ Active Liveness พร้อมผลตัดสินจากเซิร์ฟเวอร์
final liveness = await ActiveLivenessView.start(context, client: client);
if (liveness.verdict.passed) { /* ดำเนินการขั้นตอนถัดไป */ }
```

## เริ่มต้นใช้งาน — เว็บ

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
```

## เริ่มต้นใช้งาน — iOS (Swift / Objective-C)

ใน Xcode เลือก **File → Add Package Dependencies…** →
`https://github.com/iapp-technology/iapp-ekyc-sdk` (product **IappEkyc**)
และเพิ่ม `NSCameraUsageDescription` ใน Info.plist:

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

รองรับ Objective-C เต็มรูปแบบ — ดู [ios/README.md](ios/README.md)

## เริ่มต้นใช้งาน — Android (Kotlin / Java)

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

รองรับ Java เต็มรูปแบบ (API แบบ callback ผ่าน `IappEkyc.start(...)`) — ดู
[android/README.md](android/README.md)

## เริ่มต้นใช้งาน — React Native

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
    locale="th"
    onResult={(r) => { setActive(false); console.log(r); }}
    onError={(e) => setActive(false)}
    onCancel={() => setActive(false)}
  />
</Modal>
```

ดูการตั้งค่าสิทธิ์กล้องที่ [react-native/README.md](react-native/README.md)

## ข้อกำหนดของระบบ

- **Flutter**: ≥ 3.32 / Dart ≥ 3.8 · Android minSdk 24 · iOS 15.5 ขึ้นไป
- **เว็บ**: เบราว์เซอร์ที่รองรับ WebAssembly และ `getUserMedia`
  (ต้องใช้ HTTPS หรือ localhost)
- **iOS (เนทีฟ)**: iOS 15 ขึ้นไป · Swift Package Manager ·
  ต้องมี `NSCameraUsageDescription`
- **Android (เนทีฟ)**: minSdk 24 · Android System WebView เวอร์ชันล่าสุด
  (แนะนำ Chrome/WebView ≥ 100)
- **React Native**: RN ≥ 0.72 · `react-native-webview` ≥ 13.6
- เชลล์เนทีฟ iOS / Android / React Native ต้องเชื่อมต่ออินเทอร์เน็ตไปยัง
  `https://iapp.co.th/sdk/webview.html` ขณะใช้งาน
  (บริการ eKYC ต้องใช้อินเทอร์เน็ตในการเรียก API อยู่แล้ว)

## ข้อควรระวังด้านความปลอดภัย

คีย์ API ที่ฝังในแอปฝั่งผู้ใช้สามารถถูกดึงออกมาได้ สำหรับการใช้งานจริง
โปรดใช้รูปแบบพร็อกซีผ่านเซิร์ฟเวอร์ของท่านตามคำแนะนำใน
[docs/SECURITY.md](docs/SECURITY.md) และตรวจสอบ**ลายเซ็นดิจิทัลของผลตัดสิน**
จากปลายทาง finalize บนเซิร์ฟเวอร์ของท่านเสมอ

## สัญญาอนุญาต

Apache License 2.0 — สงวนลิขสิทธิ์ พ.ศ. 2569 บริษัท ไอแอพพ์เทคโนโลยี จำกัด

## ติดต่อ

- 📚 เอกสาร: https://iapp.co.th/docs/category/-electronic-know-your-customer-e-kyc
- 💬 Discord: https://discord.gg/kYcpmdEcS2
- ✉️ sale@iapp.co.th · ☎️ 086-322-5858
