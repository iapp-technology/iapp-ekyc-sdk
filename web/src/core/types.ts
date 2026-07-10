/**
 * Public response types. Response fields vary per document type / endpoint,
 * so every result keeps the full parsed JSON in `raw` (passthrough) plus
 * best-effort typed accessors for common fields (docs/API_CONTRACTS.md).
 */
import type { DocumentType } from '../document-capture/document-types';

/** Base shape for all API results: the raw parsed JSON is always kept. */
export interface ApiResult {
  /** Full parsed response body, untouched. */
  raw: Record<string, unknown>;
}

export interface DocumentResult extends ApiResult {
  documentType: DocumentType;
  /** The perspective-corrected JPEG that was uploaded (when captured by the SDK UI). */
  capturedImage?: Blob;
}

export interface FaceVerificationResult extends ApiResult {
  /** Best-effort: whether the two faces match, when the API reports it. */
  isSamePerson?: boolean;
  /** Best-effort: similarity/confidence score, when the API reports it. */
  similarity?: number;
}

export interface PassiveLivenessResult extends ApiResult {
  /** "REAL" | "SPOOF" per the passive liveness response. */
  predict?: string;
  score?: number;
  /** Normalized REAL probability (raw.normalized.REAL), when present. */
  realProbability?: number;
}

/** `verdict` object of the active-liveness finalize response (wire shape). */
export interface ActiveLivenessVerdict {
  passed: boolean;
  passive_liveness?: {
    predict: string;
    real_score: number;
    threshold: number;
  };
  challenge_summary?: {
    total: number;
    passed: number;
    types: string[];
    duration_ms: number;
    valid: boolean;
    reasons: string[];
  };
  session_id: string;
  selfie_sha256: string;
  timestamp: string;
  nonce: string;
}

export interface ActiveLivenessSelfieEcho {
  filename: string;
  content_type: string;
  size: number;
  image_base64: string;
}

export interface ActiveLivenessResult extends ApiResult {
  /**
   * Signed verdict. Only this (after signature verification on YOUR backend)
   * proves liveness — never trust on-device challenge results alone.
   * See docs/SECURITY.md.
   */
  verdict: ActiveLivenessVerdict;
  /** hex(HMAC-SHA256(secret, canonicalJSON(verdict))) */
  signature: string;
  signatureAlg: string;
  /** Present only when `return_image=true` was sent. */
  selfie?: ActiveLivenessSelfieEcho;
  processTime?: number;
  /** The selfie JPEG the SDK uploaded (client-side copy). */
  selfieImage?: Blob;
}

/**
 * Identity of a wrapper SDK embedding this engine (native iOS / Android /
 * React Native WebView shells, docs/WEBVIEW_BRIDGE.md). Reported in the
 * active-liveness challenge log `sdk` block; omitted fields fall back to
 * the web engine's own identity.
 */
export interface SdkIntegration {
  /** Wire `sdk.name`, e.g. 'iapp-ekyc-sdk-ios' (docs/ACTIVE_LIVENESS.md). */
  name?: string;
  /** Wire `sdk.platform`. Wrappers report the real OS, never 'web'. */
  platform?: 'android' | 'ios' | 'web';
  /** Wrapper version. Convention: '<wrapperVersion>+engine.<SDK_VERSION>'. */
  version?: string;
}

/** Challenge log wire schema (docs/ACTIVE_LIVENESS.md) — snake_case. */
export interface ChallengeLogWire {
  session_id: string;
  sdk: {
    name: string;
    version: string;
    platform: 'android' | 'ios' | 'web';
  };
  started_at: number;
  finished_at: number;
  challenges: Array<{
    type: 'blink' | 'turn_left' | 'turn_right' | 'smile';
    issued_at: number;
    completed_at: number;
    passed: boolean;
  }>;
}
