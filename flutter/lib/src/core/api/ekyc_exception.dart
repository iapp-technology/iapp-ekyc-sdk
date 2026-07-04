/// Typed error hierarchy for iApp eKYC API calls.
///
/// Mapping (see docs/API_CONTRACTS.md):
///
/// | HTTP | Exception |
/// |---|---|
/// | 400 | [BadRequestException] |
/// | 401 | [InvalidApiKeyException] |
/// | 402 | [InsufficientCreditException] |
/// | 413 | [FileTooLargeException] |
/// | 429 | [RateLimitedException] |
/// | 5xx | [ServerException] |
/// | —  | [NetworkException] / [EkycTimeoutException] (transport level) |
sealed class EkycException implements Exception {
  /// HTTP status code, when the failure came from an HTTP response.
  final int? statusCode;

  /// Raw response body, when available (useful for debugging/logging).
  final String? rawBody;

  /// i18n key for a user-facing message (resolve via `EkycStrings`).
  final String userMessageKey;

  /// Developer-facing message.
  final String message;

  const EkycException(
    this.message, {
    this.statusCode,
    this.rawBody,
    required this.userMessageKey,
  });

  @override
  String toString() =>
      '$runtimeType($statusCode): $message'
      '${rawBody == null || rawBody!.isEmpty ? '' : '\n$rawBody'}';
}

/// 400 — malformed input (bad image, invalid challenge log, missing field).
class BadRequestException extends EkycException {
  /// Machine-readable error code from the response body, when present
  /// (e.g. `INVALID_CHALLENGE_LOG`, `INVALID_IMAGE`, `MISSING_FIELD`).
  final String? errorCode;

  /// Detailed reasons list from the response body, when present.
  final List<String> reasons;

  const BadRequestException(
    super.message, {
    super.rawBody,
    this.errorCode,
    this.reasons = const [],
  }) : super(statusCode: 400, userMessageKey: 'error_bad_request');
}

/// 401 — missing or invalid `apikey` header.
class InvalidApiKeyException extends EkycException {
  const InvalidApiKeyException(super.message, {super.rawBody})
    : super(statusCode: 401, userMessageKey: 'error_invalid_key');
}

/// 402 — insufficient credit. Top up at https://iapp.co.th/control/credits
class InsufficientCreditException extends EkycException {
  const InsufficientCreditException(super.message, {super.rawBody})
    : super(statusCode: 402, userMessageKey: 'error_no_credit');
}

/// 413 — uploaded file larger than 10 MB.
class FileTooLargeException extends EkycException {
  const FileTooLargeException(super.message, {super.rawBody})
    : super(statusCode: 413, userMessageKey: 'error_file_too_large');
}

/// 429 — rate limited; honor [retryAfter] before retrying.
class RateLimitedException extends EkycException {
  /// Parsed `Retry-After` response header, when present.
  final Duration? retryAfter;

  const RateLimitedException(super.message, {super.rawBody, this.retryAfter})
    : super(statusCode: 429, userMessageKey: 'error_rate_limited');
}

/// 5xx — server-side failure; safe to retry later (the request was not
/// billed on 5xx).
class ServerException extends EkycException {
  const ServerException(super.message, {super.statusCode, super.rawBody})
    : super(userMessageKey: 'error_server');
}

/// Transport-level failure (DNS, socket, TLS, connection reset).
///
/// The SDK never auto-retries after the request body has been sent —
/// requests are billable. Only connection-establishment failures are
/// retried (`connectRetries`).
class NetworkException extends EkycException {
  const NetworkException(super.message)
    : super(userMessageKey: 'error_network');
}

/// The request exceeded the client's `timeout`.
class EkycTimeoutException extends EkycException {
  const EkycTimeoutException(super.message)
    : super(userMessageKey: 'error_timeout');
}

/// Unexpected non-JSON or unparsable success payload.
class InvalidResponseException extends EkycException {
  const InvalidResponseException(
    super.message, {
    super.statusCode,
    super.rawBody,
  }) : super(userMessageKey: 'error_generic');
}
