/** Stable error codes (docs/WEBVIEW_BRIDGE.md). */
export type EkycErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_API_KEY'
  | 'INSUFFICIENT_CREDIT'
  | 'FILE_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'LIVENESS_FAILED'
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'INSECURE_CONTEXT'
  | 'FACE_DETECTOR_UNAVAILABLE'
  | 'ENGINE_LOAD_FAILED'
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'HOST_PAGE_LOAD_FAILED'
  | 'PROTOCOL_MISMATCH'
  | 'UNKNOWN';

export interface EkycFlowError {
  code: EkycErrorCode;
  /** HTTP status when the error came from the API, else null. */
  statusCode: number | null;
  /** Engine i18n key (resolvable through the engine message tables). */
  messageKey: string;
  message: string;
  /** Retry-After seconds for RATE_LIMITED. */
  retryAfterSeconds?: number | null;
  /** Fail reason for LIVENESS_FAILED (timeout / tooManyRestarts / ...). */
  reason?: string | null;
}
