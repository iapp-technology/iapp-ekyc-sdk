/// Result of `/v3/store/ekyc/face-passive-liveness`.
///
/// ```json
/// { "filename": "selfie.jpg", "predict": "REAL", "score": 3.2,
///   "darkness": 0.12, "data": {"SPOOF": 0.0001, "REAL": 0.9999},
///   "normalized": {"SPOOF": 0.0001, "REAL": 0.9999},
///   "status_code": 200, "duration": 0.31, "message": "success" }
/// ```
class PassiveLivenessResult {
  /// Full server response.
  final Map<String, dynamic> raw;

  const PassiveLivenessResult(this.raw);

  String? get filename => raw['filename'] as String?;

  /// `"REAL"` or `"SPOOF"`.
  String? get predict => raw['predict'] as String?;

  /// Convenience: `predict == "REAL"`.
  bool get isReal => (predict ?? '').toUpperCase() == 'REAL';

  double? get score => _asDouble(raw['score']);

  double? get darkness => _asDouble(raw['darkness']);

  /// Raw class scores, e.g. `{"SPOOF": 0.0001, "REAL": 0.9999}`.
  Map<String, dynamic>? get data => raw['data'] as Map<String, dynamic>?;

  /// Normalized class probabilities.
  Map<String, dynamic>? get normalized =>
      raw['normalized'] as Map<String, dynamic>?;

  /// Normalized probability of REAL, when reported.
  double? get realScore => _asDouble(normalized?['REAL'] ?? data?['REAL']);

  int? get statusCode => (raw['status_code'] as num?)?.toInt();

  double? get duration => _asDouble(raw['duration']);

  String? get message => raw['message'] as String?;

  static double? _asDouble(Object? v) {
    if (v is num) return v.toDouble();
    if (v is String) return double.tryParse(v);
    return null;
  }

  @override
  String toString() => 'PassiveLivenessResult($raw)';
}
