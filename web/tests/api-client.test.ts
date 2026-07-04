/**
 * EkycApiClient behavior with a stubbed fetch: error mapping, apikey
 * header policy, multipart field names, timeout, and the strict
 * no-retry-after-send policy (docs/API_CONTRACTS.md).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EkycApiClient } from '../src/core/api-client';
import {
  BadRequestError,
  FileTooLargeError,
  InsufficientCreditError,
  InvalidApiKeyError,
  NetworkError,
  RateLimitedError,
  ServerError,
  TimeoutError,
} from '../src/core/errors';

const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EkycApiClient — error mapping', () => {
  const client = () =>
    new EkycApiClient({ apiKey: 'k', baseUrl: 'https://api.test', connectRetries: 0 });

  it('401 -> InvalidApiKeyError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { message: 'apikey invalid' })));
    const err = await client().checkPassiveLiveness(blob()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidApiKeyError);
    expect((err as InvalidApiKeyError).statusCode).toBe(401);
    expect((err as InvalidApiKeyError).userMessageKey).toBe('error_invalid_key');
    expect((err as InvalidApiKeyError).rawBody).toContain('apikey invalid');
  });

  it('402 -> InsufficientCreditError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(402, { message: 'no credit' })));
    const err = await client().checkPassiveLiveness(blob()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientCreditError);
    expect((err as InsufficientCreditError).statusCode).toBe(402);
    expect((err as InsufficientCreditError).userMessageKey).toBe('error_no_credit');
  });

  it('400 -> BadRequestError with the server message and reasons kept raw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: { code: 'INVALID_CHALLENGE_LOG', message: 'bad log', reasons: ['x'] },
        }),
      ),
    );
    const err = await client().checkPassiveLiveness(blob()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as BadRequestError).message).toBe('bad log');
    expect(JSON.parse((err as BadRequestError).rawBody ?? '')).toMatchObject({
      error: { code: 'INVALID_CHALLENGE_LOG' },
    });
  });

  it('413 -> FileTooLargeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(413, {})));
    const err = await client().checkPassiveLiveness(blob()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileTooLargeError);
  });

  it('429 -> RateLimitedError honoring Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(429, {}, { 'retry-after': '17' })),
    );
    const err = await client().checkPassiveLiveness(blob()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterSeconds).toBe(17);
  });

  it('503 -> ServerError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, {})));
    const err = await client().checkPassiveLiveness(blob()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect((err as ServerError).statusCode).toBe(503);
  });
});

describe('EkycApiClient — transport failures & retry policy', () => {
  it('network failure -> NetworkError after connectRetries extra attempts', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new EkycApiClient({
      apiKey: 'k',
      baseUrl: 'https://api.test',
      connectRetries: 1,
    });
    const err = await client.checkPassiveLiveness(blob()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    // 1 initial + 1 connect retry = 2 attempts.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('NEVER retries once a response was received (5xx = billable path)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    vi.stubGlobal('fetch', fetchMock);
    const client = new EkycApiClient({
      apiKey: 'k',
      baseUrl: 'https://api.test',
      connectRetries: 3,
    });
    await client.checkPassiveLiveness(blob()).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('timeout -> TimeoutError, and NO retry after an abort', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, rejectFetch) => {
          init.signal?.addEventListener('abort', () =>
            rejectFetch(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new EkycApiClient({
      apiKey: 'k',
      baseUrl: 'https://api.test',
      timeoutMs: 30,
      connectRetries: 3,
    });
    const err = await client.checkPassiveLiveness(blob()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('EkycApiClient — request shape', () => {
  function capture(response = jsonResponse(200, { ok: true })) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(response);
      }),
    );
    return calls;
  }

  it('sends the apikey header when set, on the right URL', async () => {
    const calls = capture();
    const client = new EkycApiClient({ apiKey: 'sk-123', baseUrl: 'https://api.test/' });
    await client.checkPassiveLiveness(blob());
    expect(calls[0].url).toBe('https://api.test/v3/store/ekyc/face-passive-liveness');
    expect((calls[0].init.headers as Record<string, string>)['apikey']).toBe('sk-123');
  });

  it("omits the apikey header entirely when apiKey is '' (proxy mode)", async () => {
    const calls = capture();
    const client = new EkycApiClient({ apiKey: '', baseUrl: 'https://proxy.test' });
    await client.checkPassiveLiveness(blob());
    expect('apikey' in (calls[0].init.headers as Record<string, string>)).toBe(false);
  });

  it('submitDocument posts multipart field `file` to the mapped endpoint', async () => {
    const calls = capture();
    const client = new EkycApiClient({ apiKey: 'k', baseUrl: 'https://api.test' });
    const result = await client.submitDocument('thaiIdFront', blob());
    expect(calls[0].url).toBe('https://api.test/v3/store/ekyc/thai-national-id-card/front');
    const form = calls[0].init.body as FormData;
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(result.raw).toEqual({ ok: true });
    expect(result.documentType).toBe('thaiIdFront');
  });

  it('verifyFaces posts `file1` and `file2`', async () => {
    const calls = capture();
    const client = new EkycApiClient({ apiKey: 'k', baseUrl: 'https://api.test' });
    await client.verifyFaces(blob(), blob());
    expect(calls[0].url).toBe('https://api.test/v3/store/ekyc/face-verification');
    const form = calls[0].init.body as FormData;
    expect(form.get('file1')).toBeInstanceOf(Blob);
    expect(form.get('file2')).toBeInstanceOf(Blob);
  });

  it('finalizeActiveLiveness posts file + challenges JSON (+ return_image)', async () => {
    const calls = capture(
      jsonResponse(200, {
        verdict: { passed: true, session_id: 's', selfie_sha256: 'x', timestamp: 't', nonce: 'n' },
        signature: 'ab',
        signature_alg: 'HMAC-SHA256',
        process_time: 0.42,
      }),
    );
    const client = new EkycApiClient({ apiKey: 'k', baseUrl: 'https://api.test' });
    const log = {
      session_id: 's',
      sdk: { name: 'iapp-ekyc-sdk-web', version: '0.1.0', platform: 'web' as const },
      started_at: 1,
      finished_at: 2,
      challenges: [],
    };
    const result = await client.finalizeActiveLiveness(blob(), log, { returnImage: true });
    expect(calls[0].url).toBe('https://api.test/v3/store/ekyc/face-active-liveness/finalize');
    const form = calls[0].init.body as FormData;
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(JSON.parse(form.get('challenges') as string)).toEqual(log);
    expect(form.get('return_image')).toBe('true');
    expect(result.verdict.passed).toBe(true);
    expect(result.signature).toBe('ab');
    expect(result.signatureAlg).toBe('HMAC-SHA256');
    expect(result.processTime).toBe(0.42);
    expect(result.raw['signature']).toBe('ab'); // raw passthrough kept
  });

  it('omits return_image unless requested', async () => {
    const calls = capture(
      jsonResponse(200, { verdict: {}, signature: '', signature_alg: '' }),
    );
    const client = new EkycApiClient({ apiKey: 'k', baseUrl: 'https://api.test' });
    const log = {
      session_id: 's',
      sdk: { name: 'iapp-ekyc-sdk-web', version: '0.1.0', platform: 'web' as const },
      started_at: 1,
      finished_at: 2,
      challenges: [],
    };
    await client.finalizeActiveLiveness(blob(), log);
    const form = calls[0].init.body as FormData;
    expect(form.get('return_image')).toBeNull();
  });

  it('keeps the raw response on results (passthrough)', async () => {
    capture(jsonResponse(200, { predict: 'REAL', score: 3.2, normalized: { REAL: 0.9999 } }));
    const client = new EkycApiClient({ apiKey: 'k', baseUrl: 'https://api.test' });
    const result = await client.checkPassiveLiveness(blob());
    expect(result.predict).toBe('REAL');
    expect(result.score).toBe(3.2);
    expect(result.realProbability).toBe(0.9999);
    expect(result.raw).toEqual({ predict: 'REAL', score: 3.2, normalized: { REAL: 0.9999 } });
  });
});
