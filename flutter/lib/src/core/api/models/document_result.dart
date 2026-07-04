import 'dart:typed_data';

/// Result of a document OCR submission.
///
/// Response fields vary per document type — [raw] always carries the
/// complete server payload; the typed getters cover fields common to the
/// iApp eKYC OCR endpoints.
class DocumentResult {
  /// Full server response.
  final Map<String, dynamic> raw;

  /// The exact JPEG bytes uploaded to the server (set by the capture flow;
  /// `null` when the client was called directly with caller-owned bytes).
  final Uint8List? capturedImage;

  const DocumentResult(this.raw, {this.capturedImage});

  /// Server processing time in seconds, when reported.
  double? get processTime => _asDouble(raw['process_time']);

  /// Human-readable status/message, when reported.
  String? get message => raw['message'] as String?;

  /// The `data` sub-object many endpoints wrap their fields in, or the
  /// full payload when there is no wrapper.
  Map<String, dynamic> get data {
    final d = raw['data'];
    if (d is Map<String, dynamic>) return d;
    return raw;
  }

  DocumentResult withCapturedImage(Uint8List image) =>
      DocumentResult(raw, capturedImage: image);

  static double? _asDouble(Object? v) {
    if (v is num) return v.toDouble();
    if (v is String) return double.tryParse(v);
    return null;
  }

  @override
  String toString() => 'DocumentResult($raw)';
}
