/// Result of `/v3/store/ekyc/face-verification` (two-image comparison).
class FaceVerificationResult {
  /// Full server response.
  final Map<String, dynamic> raw;

  const FaceVerificationResult(this.raw);

  /// Similarity score between the two faces, when reported
  /// (checks the common key spellings used by the iApp engine).
  double? get similarity => _firstDouble(['similarity', 'score', 'confidence']);

  /// Whether the server judged the two faces to be the same person,
  /// when reported.
  bool? get isSamePerson {
    final v = raw['is_same_person'] ?? raw['same_person'] ?? raw['match'];
    if (v is bool) return v;
    if (v is String) {
      final s = v.toLowerCase();
      if (s == 'true' || s == 'match') return true;
      if (s == 'false' || s == 'no_match') return false;
    }
    return null;
  }

  /// Server processing time in seconds, when reported.
  double? get processTime => _firstDouble(['process_time', 'duration']);

  double? _firstDouble(List<String> keys) {
    for (final k in keys) {
      final v = raw[k];
      if (v is num) return v.toDouble();
      if (v is String) {
        final parsed = double.tryParse(v);
        if (parsed != null) return parsed;
      }
    }
    return null;
  }

  @override
  String toString() => 'FaceVerificationResult($raw)';
}
