/**
 * Typed error hierarchy per docs/API_CONTRACTS.md ("Error model").
 *
 * | HTTP | SDK error type        |
 * |------|-----------------------|
 * | 400  | BadRequestError       |
 * | 401  | InvalidApiKeyError    |
 * | 402  | InsufficientCreditError |
 * | 413  | FileTooLargeError     |
 * | 429  | RateLimitedError      |
 * | 5xx  | ServerError           |
 * | —    | NetworkError / TimeoutError (transport level) |
 *
 * Every error carries `statusCode` (null for transport errors), the raw
 * response body (if any) and a `userMessageKey` resolvable through the SDK
 * i18n tables for end-user display.
 */

export interface EkycErrorOptions {
  statusCode?: number | null;
  rawBody?: string | null;
  userMessageKey?: string;
  cause?: unknown;
}

export class EkycError extends Error {
  /** HTTP status code, or null for transport-level / local errors. */
  readonly statusCode: number | null;
  /** Raw (unparsed) HTTP response body, when a response was received. */
  readonly rawBody: string | null;
  /** i18n key (see src/core/i18n) for an end-user friendly message. */
  readonly userMessageKey: string;

  constructor(message: string, options: EkycErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'EkycError';
    this.statusCode = options.statusCode ?? null;
    this.rawBody = options.rawBody ?? null;
    this.userMessageKey = options.userMessageKey ?? 'error_generic';
  }
}

/** 400 — malformed input. */
export class BadRequestError extends EkycError {
  constructor(message: string, options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_bad_request', statusCode: 400, ...options });
    this.name = 'BadRequestError';
  }
}

/** 401 — missing/invalid `apikey` header. */
export class InvalidApiKeyError extends EkycError {
  constructor(message: string, options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_invalid_key', statusCode: 401, ...options });
    this.name = 'InvalidApiKeyError';
  }
}

/** 402 — insufficient credit; top up at https://iapp.co.th/control/credits */
export class InsufficientCreditError extends EkycError {
  constructor(message: string, options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_no_credit', statusCode: 402, ...options });
    this.name = 'InsufficientCreditError';
  }
}

/** 413 — uploaded file exceeds 10 MB. */
export class FileTooLargeError extends EkycError {
  constructor(message: string, options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_file_too_large', statusCode: 413, ...options });
    this.name = 'FileTooLargeError';
  }
}

/** 429 — rate limited; honor `retryAfterSeconds` (from the Retry-After header). */
export class RateLimitedError extends EkycError {
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: EkycErrorOptions & { retryAfterSeconds?: number | null } = {},
  ) {
    super(message, { userMessageKey: 'error_rate_limited', statusCode: 429, ...options });
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

/** 5xx — server-side failure; retry later (never automatically by the SDK). */
export class ServerError extends EkycError {
  constructor(message: string, options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_server', ...options });
    this.name = 'ServerError';
  }
}

/** Transport-level failure: no HTTP response was received. */
export class NetworkError extends EkycError {
  constructor(message: string, options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_network', statusCode: null, ...options });
    this.name = 'NetworkError';
  }
}

/** Request exceeded `timeoutMs` and was aborted client-side. */
export class TimeoutError extends EkycError {
  constructor(message: string, options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_timeout', statusCode: null, ...options });
    this.name = 'TimeoutError';
  }
}

/** The user cancelled an interactive flow (capture / liveness UI). */
export class CancelledError extends EkycError {
  constructor(message = 'Flow cancelled by the user', options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_cancelled', ...options });
    this.name = 'CancelledError';
  }
}

/** Active liveness ended in `failed` (timeout / too many restarts / ...). */
export class LivenessFailedError extends EkycError {
  readonly reason: string;

  constructor(reason: string, options: EkycErrorOptions = {}) {
    super(`Active liveness failed: ${reason}`, {
      userMessageKey:
        reason === 'timeout'
          ? 'error_challenge_timeout'
          : reason === 'tooManyRestarts'
            ? 'error_too_many_restarts'
            : 'liveness_failed',
      ...options,
    });
    this.name = 'LivenessFailedError';
    this.reason = reason;
  }
}

/** Base class for camera acquisition failures. */
export class CameraError extends EkycError {
  constructor(message: string, options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_camera_unsupported', ...options });
    this.name = 'CameraError';
  }
}

export class CameraPermissionDeniedError extends CameraError {
  constructor(message = 'Camera permission denied', options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_camera_permission', ...options });
    this.name = 'CameraPermissionDeniedError';
  }
}

export class CameraNotFoundError extends CameraError {
  constructor(message = 'No usable camera found', options: EkycErrorOptions = {}) {
    super(message, { userMessageKey: 'error_camera_not_found', ...options });
    this.name = 'CameraNotFoundError';
  }
}

/** getUserMedia requires HTTPS or localhost. */
export class InsecureContextError extends CameraError {
  constructor(
    message = 'Camera access requires a secure context (HTTPS or localhost)',
    options: EkycErrorOptions = {},
  ) {
    super(message, { userMessageKey: 'error_insecure_context', ...options });
    this.name = 'InsecureContextError';
  }
}

/**
 * The on-device face detector is running but its output is unusable — e.g.
 * landmark coordinates that are not normalized to the frame. Seen on
 * specific device / WebView combinations; the flow retries on the CPU
 * delegate first and only raises this if that fails too.
 */
export class FaceDetectorUnavailableError extends EkycError {
  constructor(
    message = 'The on-device face detector returned unusable output',
    options: EkycErrorOptions = {},
  ) {
    super(message, { userMessageKey: 'error_face_detector', statusCode: null, ...options });
    this.name = 'FaceDetectorUnavailableError';
  }
}

/** Extract a human-readable message from a raw error response body. */
function messageFromBody(rawBody: string | null, fallback: string): string {
  if (!rawBody) return fallback;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const err = obj['error'];
      if (err && typeof err === 'object') {
        const msg = (err as Record<string, unknown>)['message'];
        if (typeof msg === 'string' && msg) return msg;
      }
      if (typeof err === 'string' && err) return err;
      const msg = obj['message'];
      if (typeof msg === 'string' && msg) return msg;
    }
  } catch {
    /* non-JSON body — use fallback */
  }
  return fallback;
}

/**
 * Map an HTTP error response to the typed hierarchy
 * (docs/API_CONTRACTS.md error table).
 */
export function errorFromResponse(
  statusCode: number,
  rawBody: string | null,
  retryAfterHeader?: string | null,
): EkycError {
  const opts: EkycErrorOptions = { statusCode, rawBody };
  switch (statusCode) {
    case 400:
      return new BadRequestError(messageFromBody(rawBody, 'Bad request (400)'), opts);
    case 401:
      return new InvalidApiKeyError(
        messageFromBody(rawBody, 'Missing or invalid API key (401)'),
        opts,
      );
    case 402:
      return new InsufficientCreditError(
        messageFromBody(rawBody, 'Insufficient credit (402) — top up at https://iapp.co.th/control/credits'),
        opts,
      );
    case 413:
      return new FileTooLargeError(
        messageFromBody(rawBody, 'File too large (413) — max 10 MB'),
        opts,
      );
    case 429: {
      const parsed = retryAfterHeader != null ? Number.parseInt(retryAfterHeader, 10) : NaN;
      return new RateLimitedError(messageFromBody(rawBody, 'Rate limited (429)'), {
        ...opts,
        retryAfterSeconds: Number.isFinite(parsed) ? parsed : null,
      });
    }
    default:
      if (statusCode >= 500) {
        return new ServerError(
          messageFromBody(rawBody, `Server error (${statusCode})`),
          opts,
        );
      }
      return new EkycError(
        messageFromBody(rawBody, `Unexpected HTTP status ${statusCode}`),
        opts,
      );
  }
}
