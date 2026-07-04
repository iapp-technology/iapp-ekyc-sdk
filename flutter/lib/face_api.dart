/// iApp eKYC SDK — face APIs only (no capture UI).
///
/// ```dart
/// import 'package:iapp_ekyc_sdk/face_api.dart';
///
/// final client = IappEkycClient(apiKey: '...');
/// final match = await client.verifyFaces(idPhoto, selfie);
/// final liveness = await client.checkPassiveLiveness(selfie);
/// ```
library;

export 'src/face_api/face_api.dart';
