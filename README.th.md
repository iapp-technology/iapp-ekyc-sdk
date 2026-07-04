# iApp eKYC SDK

[English](README.md) | **ภาษาไทย** | [中文](README.zh.md)

ชุดพัฒนาซอฟต์แวร์ (SDK) แบบโอเพนซอร์สสำหรับบริการ eKYC ระดับองค์กรของ
[บริษัท ไอแอพพ์เทคโนโลยี จำกัด](https://iapp.co.th) — ถ่ายภาพบัตรประชาชน/
หนังสือเดินทางอัตโนมัติ ตรวจสอบการมีชีวิตแบบแอ็กทีฟ (Active Liveness)
เปรียบเทียบใบหน้า และตรวจจับภาพปลอม — รองรับทั้ง **Flutter (Android/iOS)**
และ **เว็บ (HTML5/JavaScript)**

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

## ข้อกำหนดของระบบ

- **Flutter**: ≥ 3.32 / Dart ≥ 3.8 · Android minSdk 24 · iOS 15.5 ขึ้นไป
- **เว็บ**: เบราว์เซอร์ที่รองรับ WebAssembly และ `getUserMedia`
  (ต้องใช้ HTTPS หรือ localhost)

## ข้อควรระวังด้านความปลอดภัย

คีย์ API ที่ฝังในแอปฝั่งผู้ใช้สามารถถูกดึงออกมาได้ สำหรับการใช้งานจริง
โปรดใช้รูปแบบพร็อกซีผ่านเซิร์ฟเวอร์ของท่านตามคำแนะนำใน
[docs/SECURITY.md](docs/SECURITY.md) และตรวจสอบ**ลายเซ็นดิจิทัลของผลตัดสิน**
จากปลายทาง finalize บนเซิร์ฟเวอร์ของท่านเสมอ

## สัญญาอนุญาต

Apache License 2.0 — สงวนลิขสิทธิ์ พ.ศ. 2569 บริษัท ไอแอพพ์เทคโนโลยี จำกัด

## ติดต่อ

- 📚 เอกสาร: https://iapp.co.th/docs/ekyc
- 💬 Discord: https://discord.gg/kYcpmdEcS2
- ✉️ sale@iapp.co.th · ☎️ 086-322-5858
