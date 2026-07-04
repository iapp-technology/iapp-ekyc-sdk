/**
 * HTTP client for the iApp eKYC endpoints (docs/API_CONTRACTS.md).
 *
 * Retry policy — IMPORTANT (billable requests):
 * Requests MUST NOT be auto-retried after the body has been sent. The only
 * retried failures are connection-establishment failures, i.e. `fetch()`
 * rejecting without ever producing a `Response` (DNS/TCP/TLS failure —
 * the server never accepted the request). Once ANY `Response` is received
 * (even 5xx) the client never retries. Aborts/timeouts are never retried
 * either, because the body may already be in flight.
 */
import {
  errorFromResponse,
  NetworkError,
  ServerError,
  TimeoutError,
} from './errors';
import type {
  ActiveLivenessResult,
  ActiveLivenessVerdict,
  ChallengeLogWire,
  DocumentResult,
  FaceVerificationResult,
  PassiveLivenessResult,
} from './types';
import { DOCUMENT_SPECS, type DocumentType } from '../document-capture/document-types';

export interface EkycApiClientOptions {
  /**
   * iApp API key (https://iapp.co.th/control/api-keys). Pass `''` to omit
   * the `apikey` header entirely — use this with a `baseUrl` pointing at
   * your own backend proxy that attaches the real key (docs/SECURITY.md).
   */
  apiKey: string;
  /** Default `https://api.iapp.co.th`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 60000. */
  timeoutMs?: number;
  /**
   * Extra attempts allowed when the connection could not be established
   * (fetch rejected without a response). Default 1. Never applies once a
   * response has been received or after an abort/timeout.
   */
  connectRetries?: number;
}

function isAbortError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    ((e as { name?: unknown }).name === 'AbortError' ||
      (e as { name?: unknown }).name === 'TimeoutError')
  );
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export class EkycApiClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly connectRetries: number;
  private readonly apiKey: string;

  constructor(options: EkycApiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.iapp.co.th').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.connectRetries = options.connectRetries ?? 1;
  }

  /** POST a captured document image to its OCR endpoint. */
  async submitDocument(
    documentType: DocumentType,
    image: Blob,
    filename = 'document.jpg',
  ): Promise<DocumentResult> {
    const spec = DOCUMENT_SPECS[documentType];
    const form = new FormData();
    form.append('file', image, filename);
    const raw = await this.postMultipart(spec.endpoint, form);
    return { documentType, raw };
  }

  /** POST /v3/store/ekyc/face-verification — fields `file1`, `file2`. */
  async verifyFaces(file1: Blob, file2: Blob): Promise<FaceVerificationResult> {
    const form = new FormData();
    form.append('file1', file1, 'face1.jpg');
    form.append('file2', file2, 'face2.jpg');
    const raw = await this.postMultipart('/v3/store/ekyc/face-verification', form);
    const result: FaceVerificationResult = { raw };
    const same = raw['is_same_person'] ?? raw['isSamePerson'] ?? raw['same_person'];
    if (typeof same === 'boolean') result.isSamePerson = same;
    const sim = num(raw['similarity']) ?? num(raw['score']) ?? num(raw['confidence']);
    if (sim !== undefined) result.similarity = sim;
    return result;
  }

  /** POST /v3/store/ekyc/face-passive-liveness — field `file`. */
  async checkPassiveLiveness(file: Blob): Promise<PassiveLivenessResult> {
    const form = new FormData();
    form.append('file', file, 'selfie.jpg');
    const raw = await this.postMultipart('/v3/store/ekyc/face-passive-liveness', form);
    const result: PassiveLivenessResult = { raw };
    if (typeof raw['predict'] === 'string') result.predict = raw['predict'];
    const score = num(raw['score']);
    if (score !== undefined) result.score = score;
    const normalized = raw['normalized'];
    if (normalized && typeof normalized === 'object') {
      const real = num((normalized as Record<string, unknown>)['REAL']);
      if (real !== undefined) result.realProbability = real;
    }
    return result;
  }

  /**
   * POST /v3/store/ekyc/face-active-liveness/finalize —
   * fields `file`, `challenges` (JSON string), optional `return_image`.
   */
  async finalizeActiveLiveness(
    selfie: Blob,
    challengeLog: ChallengeLogWire | string,
    options: { returnImage?: boolean } = {},
  ): Promise<ActiveLivenessResult> {
    const form = new FormData();
    form.append('file', selfie, 'selfie.jpg');
    form.append(
      'challenges',
      typeof challengeLog === 'string' ? challengeLog : JSON.stringify(challengeLog),
    );
    if (options.returnImage) form.append('return_image', 'true');
    const raw = await this.postMultipart('/v3/store/ekyc/face-active-liveness/finalize', form);
    const result: ActiveLivenessResult = {
      raw,
      verdict: raw['verdict'] as unknown as ActiveLivenessVerdict,
      signature: typeof raw['signature'] === 'string' ? raw['signature'] : '',
      signatureAlg: typeof raw['signature_alg'] === 'string' ? raw['signature_alg'] : '',
    };
    if (raw['selfie'] && typeof raw['selfie'] === 'object') {
      result.selfie = raw['selfie'] as ActiveLivenessResult['selfie'];
    }
    const pt = num(raw['process_time']);
    if (pt !== undefined) result.processTime = pt;
    return result;
  }

  /** Shared multipart POST with timeout + connect-only retry + error mapping. */
  private async postMultipart(
    path: string,
    form: FormData,
  ): Promise<Record<string, unknown>> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {};
    // Empty apiKey => omit the header (backend-proxy mode, docs/SECURITY.md).
    if (this.apiKey !== '') headers['apikey'] = this.apiKey;

    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: form,
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        if (controller.signal.aborted || isAbortError(e)) {
          // The body may have been (partially) sent — NEVER retry.
          throw new TimeoutError(`Request to ${path} timed out after ${this.timeoutMs} ms`, {
            cause: e,
          });
        }
        // fetch rejected without a Response: connection-establishment
        // failure. This is the only retriable case.
        if (attempt < this.connectRetries) {
          attempt += 1;
          continue;
        }
        throw new NetworkError(`Network error calling ${path}`, { cause: e });
      }
      clearTimeout(timer);

      // A response was received — the request was processed (and possibly
      // billed). From here on, no retry under any circumstance.
      if (!response.ok) {
        let rawBody: string | null = null;
        try {
          rawBody = await response.text();
        } catch {
          rawBody = null;
        }
        throw errorFromResponse(response.status, rawBody, response.headers.get('retry-after'));
      }

      const text = await response.text();
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ServerError('Server returned a non-JSON response body', {
          statusCode: response.status,
          rawBody: text,
        });
      }
    }
  }
}
