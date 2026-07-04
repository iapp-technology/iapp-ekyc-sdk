import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../../document_capture/document_type.dart';
import 'ekyc_exception.dart';
import 'models/active_liveness_result.dart';
import 'models/document_result.dart';
import 'models/face_verification_result.dart';
import 'models/passive_liveness_result.dart';

/// HTTP client for the iApp eKYC APIs (https://api.iapp.co.th).
///
/// Get an API key at https://iapp.co.th/control/api-keys — or leave
/// [apiKey] empty and point [baseUrl] at your own authenticating proxy
/// (the `apikey` header is omitted when [apiKey] is empty).
///
/// Billing safety: the client **never retries after the request body has
/// been sent** — requests are billable. Only connection-establishment
/// failures are retried, at most [connectRetries] times.
class IappEkycClient {
  /// iApp API key sent as the `apikey` header. Empty string = omit header.
  final String apiKey;

  /// API origin. Override to route through your own backend proxy.
  final String baseUrl;

  /// Whole-request timeout (connect + upload + response).
  final Duration timeout;

  /// Extra attempts allowed for connection-establishment failures only.
  final int connectRetries;

  final http.Client _http;

  IappEkycClient({
    required this.apiKey,
    this.baseUrl = 'https://api.iapp.co.th',
    this.timeout = const Duration(seconds: 60),
    this.connectRetries = 1,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  /// Releases the underlying HTTP client.
  void close() => _http.close();

  /// Submits a captured document image for OCR.
  ///
  /// Multipart field `file`, endpoint mapped from [type].
  Future<DocumentResult> submitDocument(
    DocumentType type,
    Uint8List jpegBytes, {
    String filename = 'document.jpg',
  }) async {
    final json = await _postMultipart(
      type.endpointPath,
      files: {'file': (jpegBytes, filename)},
    );
    return DocumentResult(json);
  }

  /// Compares the faces in two images
  /// (`/v3/store/ekyc/face-verification`, fields `file1` + `file2`).
  Future<FaceVerificationResult> verifyFaces(
    Uint8List image1,
    Uint8List image2,
  ) async {
    final json = await _postMultipart(
      '/v3/store/ekyc/face-verification',
      files: {'file1': (image1, 'face1.jpg'), 'file2': (image2, 'face2.jpg')},
    );
    return FaceVerificationResult(json);
  }

  /// Runs passive liveness on a single selfie
  /// (`/v3/store/ekyc/face-passive-liveness`, field `file`).
  Future<PassiveLivenessResult> checkPassiveLiveness(Uint8List selfie) async {
    final json = await _postMultipart(
      '/v3/store/ekyc/face-passive-liveness',
      files: {'file': (selfie, 'selfie.jpg')},
    );
    return PassiveLivenessResult(json);
  }

  /// Finalizes an active-liveness session server-side
  /// (`/v3/store/ekyc/face-active-liveness/finalize`).
  ///
  /// [challengeLog] must follow the wire schema in docs/ACTIVE_LIVENESS.md;
  /// it is serialized to the `challenges` multipart field. Set
  /// [returnImage] to receive the selfie echoed back as base64.
  Future<ActiveLivenessResult> finalizeActiveLiveness(
    Uint8List selfie,
    Map<String, dynamic> challengeLog, {
    bool returnImage = false,
  }) async {
    final json = await _postMultipart(
      '/v3/store/ekyc/face-active-liveness/finalize',
      files: {'file': (selfie, 'selfie.jpg')},
      fields: {
        'challenges': jsonEncode(challengeLog),
        if (returnImage) 'return_image': 'true',
      },
    );
    return ActiveLivenessResult(json);
  }

  // ---------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------

  Future<Map<String, dynamic>> _postMultipart(
    String path, {
    required Map<String, (Uint8List, String)> files,
    Map<String, String> fields = const {},
  }) async {
    http.MultipartRequest buildRequest() {
      final request = http.MultipartRequest('POST', Uri.parse('$baseUrl$path'));
      if (apiKey.isNotEmpty) {
        request.headers['apikey'] = apiKey;
      }
      request.fields.addAll(fields);
      for (final entry in files.entries) {
        request.files.add(
          http.MultipartFile.fromBytes(
            entry.key,
            entry.value.$1,
            filename: entry.value.$2,
            contentType: MediaType('image', 'jpeg'),
          ),
        );
      }
      return request;
    }

    var attempt = 0;
    while (true) {
      attempt++;
      try {
        final streamed = await _http
            .send(buildRequest())
            .timeout(timeout, onTimeout: () => throw const _RequestTimeout());
        final response = await http.Response.fromStream(
          streamed,
        ).timeout(timeout, onTimeout: () => throw const _RequestTimeout());
        return _decode(response);
      } on EkycException {
        rethrow;
      } on _RequestTimeout {
        // Never retried: the body may already be in flight (billable).
        throw EkycTimeoutException(
          'Request to $path timed out after ${timeout.inSeconds}s',
        );
      } catch (e) {
        // Only connection-establishment failures may be retried — a
        // failure once the body has been sent must surface immediately.
        if (_isConnectFailure(e) && attempt <= connectRetries) {
          continue;
        }
        throw NetworkException('Request to $path failed: $e');
      }
    }
  }

  Map<String, dynamic> _decode(http.Response response) {
    final status = response.statusCode;
    final body = response.body;

    if (status >= 200 && status < 300) {
      final Object? parsed;
      try {
        parsed = jsonDecode(body);
      } on FormatException {
        throw InvalidResponseException(
          'Server returned non-JSON payload',
          statusCode: status,
          rawBody: body,
        );
      }
      if (parsed is Map<String, dynamic>) return parsed;
      throw InvalidResponseException(
        'Server returned unexpected JSON shape (${parsed.runtimeType})',
        statusCode: status,
        rawBody: body,
      );
    }

    final (errorCode, errorMessage, reasons) = _parseErrorBody(body);
    final message = errorMessage ?? 'HTTP $status';
    switch (status) {
      case 400:
        throw BadRequestException(
          message,
          rawBody: body,
          errorCode: errorCode,
          reasons: reasons,
        );
      case 401:
        throw InvalidApiKeyException(message, rawBody: body);
      case 402:
        throw InsufficientCreditException(message, rawBody: body);
      case 413:
        throw FileTooLargeException(message, rawBody: body);
      case 429:
        throw RateLimitedException(
          message,
          rawBody: body,
          retryAfter: _parseRetryAfter(response.headers['retry-after']),
        );
      default:
        if (status >= 500) {
          throw ServerException(message, statusCode: status, rawBody: body);
        }
        throw InvalidResponseException(
          'Unexpected HTTP status $status',
          statusCode: status,
          rawBody: body,
        );
    }
  }

  (String?, String?, List<String>) _parseErrorBody(String body) {
    try {
      final parsed = jsonDecode(body);
      if (parsed is Map<String, dynamic>) {
        final error = parsed['error'];
        if (error is Map<String, dynamic>) {
          return (
            error['code'] as String?,
            error['message'] as String?,
            (error['reasons'] as List?)?.cast<String>() ?? const [],
          );
        }
        final message = parsed['message'] ?? parsed['detail'];
        return (null, message is String ? message : null, const []);
      }
    } on FormatException {
      // Non-JSON error body — fall through.
    }
    return (null, null, const []);
  }

  static Duration? _parseRetryAfter(String? header) {
    if (header == null) return null;
    final seconds = int.tryParse(header.trim());
    if (seconds != null) return Duration(seconds: seconds);
    try {
      final date = HttpDate.parse(header);
      final delta = date.difference(DateTime.now());
      return delta.isNegative ? Duration.zero : delta;
    } on Exception {
      return null;
    }
  }

  /// Heuristically true when [e] is a failure to *establish* a connection
  /// (nothing was sent), which is the only case the SDK may retry.
  static bool _isConnectFailure(Object e) {
    if (e is SocketException) {
      final text = '${e.message} ${e.osError?.message ?? ''}'.toLowerCase();
      return text.contains('refused') ||
          text.contains('failed host lookup') ||
          text.contains('name or service not known') ||
          text.contains('network is unreachable') ||
          text.contains('no route to host') ||
          text.contains('connection timed out');
    }
    return false;
  }
}

class _RequestTimeout implements Exception {
  const _RequestTimeout();
}
