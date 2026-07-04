import 'dart:convert';
import 'dart:typed_data';

/// Result of `POST /v3/store/ekyc/face-active-liveness/finalize`.
///
/// The server re-verifies the selfie with the passive-liveness engine and
/// returns a signed verdict. **On-device results alone must never be
/// treated as proof of liveness** — integrator backends should verify
/// [signature] against `canonicalJSON(verdict)` with the shared secret
/// issued by iApp, then trust [passed].
class ActiveLivenessResult {
  /// Full server response.
  final Map<String, dynamic> raw;

  const ActiveLivenessResult(this.raw);

  /// The signed verdict object (keys: `passed`, `passive_liveness`,
  /// `challenge_summary`, `session_id`, `selfie_sha256`, `timestamp`,
  /// `nonce`).
  Map<String, dynamic> get verdict =>
      (raw['verdict'] as Map<String, dynamic>?) ?? const {};

  /// Overall verdict. `false` also when the response carried no verdict.
  bool get passed => verdict['passed'] == true;

  /// Passive-liveness sub-result
  /// (`{"predict": "REAL", "real_score": 0.9999, "threshold": 0.5}`).
  Map<String, dynamic>? get passiveLiveness =>
      verdict['passive_liveness'] as Map<String, dynamic>?;

  String? get passivePredict => passiveLiveness?['predict'] as String?;

  double? get passiveRealScore => _asDouble(passiveLiveness?['real_score']);

  double? get passiveThreshold => _asDouble(passiveLiveness?['threshold']);

  /// Challenge summary (`total`, `passed`, `types`, `duration_ms`,
  /// `valid`, `reasons`).
  Map<String, dynamic>? get challengeSummary =>
      verdict['challenge_summary'] as Map<String, dynamic>?;

  String? get sessionId => verdict['session_id'] as String?;

  /// SHA-256 of the exact selfie bytes, binding the signature to the image.
  String? get selfieSha256 => verdict['selfie_sha256'] as String?;

  String? get timestamp => verdict['timestamp'] as String?;

  String? get nonce => verdict['nonce'] as String?;

  /// `hex(HMAC-SHA256(secret, canonicalJSON(verdict)))`.
  String? get signature => raw['signature'] as String?;

  String? get signatureAlg => raw['signature_alg'] as String?;

  /// Selfie echo metadata; present only when `return_image=true`.
  Map<String, dynamic>? get selfie => raw['selfie'] as Map<String, dynamic>?;

  /// Decoded selfie bytes when the server echoed the image back.
  Uint8List? get selfieImage {
    final b64 = selfie?['image_base64'] as String?;
    if (b64 == null || b64.isEmpty) return null;
    try {
      return base64Decode(b64);
    } on FormatException {
      return null;
    }
  }

  double? get processTime => _asDouble(raw['process_time']);

  static double? _asDouble(Object? v) {
    if (v is num) return v.toDouble();
    if (v is String) return double.tryParse(v);
    return null;
  }

  @override
  String toString() =>
      'ActiveLivenessResult(passed: $passed, sessionId: $sessionId)';
}
