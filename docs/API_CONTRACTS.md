# API Contracts

Base URL: `https://api.iapp.co.th` (overridable via the client's `baseUrl`
option — see [SECURITY.md](SECURITY.md) for the proxy pattern).
Authentication: `apikey: <YOUR_API_KEY>` request header on every call.
All uploads: `multipart/form-data`, JPEG/JPG/PNG, ≤ 10 MB per file.

Get an API key: https://iapp.co.th/control/api-keys

## Document OCR

| Endpoint | Method | Fields | Credits |
|---|---|---|---|
| `/v3/store/ekyc/thai-national-id-card/front` | POST | `file` | 1.25 IC/page |
| `/v3/store/ekyc/thai-national-id-card/back` | POST | `file` | 0.75 IC/page |
| `/v3/store/ekyc/thai-national-id-card-with-signature` | POST | `file` | 1.0 IC/page |
| `/v3/store/ekyc/thai-driver-license` | POST | `file` | 1.25 IC/page |
| `/v3/store/ekyc/book-bank` | POST | `file` | 1.25 IC/page |
| `/v3/store/ekyc/passport` | POST | `file` | 0.75 IC/page |

Responses are JSON objects whose fields vary per document type; the SDK
exposes typed accessors plus the raw map (`result.raw`). See
https://iapp.co.th/docs/category/-electronic-know-your-customer-e-kyc for the full field reference.

## Face APIs

| Endpoint | Method | Fields | Credits |
|---|---|---|---|
| `/v3/store/ekyc/face-verification` | POST | `file1`, `file2` | 0.3 IC/request |
| `/v3/store/ekyc/face-passive-liveness` | POST | `file` | 0.3 IC/request |
| `/v3/store/ekyc/face-active-liveness/finalize` | POST | `file`, `challenges`, [`return_image`] | 1 IC/request |

### Passive liveness response

```json
{ "filename": "selfie.jpg", "predict": "REAL", "score": 3.2,
  "darkness": 0.12, "data": {"SPOOF": 0.0001, "REAL": 0.9999},
  "normalized": {"SPOOF": 0.0001, "REAL": 0.9999},
  "status_code": 200, "duration": 0.31, "message": "success" }
```

## Face Active Liveness — finalize (NEW)

`POST /v3/store/ekyc/face-active-liveness/finalize`

Request parts:
- `file` — best selfie frame (JPEG/PNG, magic-byte validated server-side).
- `challenges` — JSON string; schema in
  [ACTIVE_LIVENESS.md](ACTIVE_LIVENESS.md).
- `return_image` — optional, `"true"` to receive the selfie echoed back as
  base64 (default omitted).

Server behavior: validates the challenge log (types in allowlist, ≥ 2
challenges, all `passed`, strictly monotonic timestamps, per-challenge
duration 300 ms–30 s, session ≤ 120 s, `finished_at` within 5 min of server
time), re-verifies the selfie with the passive-liveness engine, then signs
the verdict.

**200 OK** — billed 1 IC whether `passed` is true or false (the check ran):

```json
{
  "verdict": {
    "passed": true,
    "passive_liveness": { "predict": "REAL", "real_score": 0.9999, "threshold": 0.5 },
    "challenge_summary": { "total": 3, "passed": 3,
      "types": ["blink", "turn_left", "smile"],
      "duration_ms": 8000, "valid": true, "reasons": [] },
    "session_id": "b0e7…",
    "selfie_sha256": "ab12…64-hex-chars",
    "timestamp": "2026-07-04T09:00:00.000Z",
    "nonce": "9f3a1c…"
  },
  "signature": "hex(HMAC-SHA256(secret, canonicalJSON(verdict)))",
  "signature_alg": "HMAC-SHA256",
  "selfie": { "filename": "selfie.jpg", "content_type": "image/jpeg",
              "size": 123456, "image_base64": "…" },
  "process_time": 0.42
}
```

- `selfie` is present only when `return_image=true`.
- `canonicalJSON` = JSON serialization with all object keys sorted
  recursively, no insignificant whitespace, UTF-8.
- `selfie_sha256` is inside `verdict`, so the signature cryptographically
  binds the verdict to the exact image bytes.
- Integrator backends should verify `signature` with the shared secret
  issued by iApp, then trust `verdict` — never the client's own claim.

Errors (never billed):
- `400 {"error": {"code": "INVALID_CHALLENGE_LOG" | "INVALID_IMAGE" | "MISSING_FIELD", "message": "…", "reasons": ["…"]}}`
- `401` invalid/missing API key (gateway) · `402` insufficient credit
  (gateway) · `413` file too large · `502 UPSTREAM_UNAVAILABLE`.

## Error model (all endpoints)

| HTTP | SDK error type | Meaning |
|---|---|---|
| 400 | `BadRequest` | malformed input |
| 401 | `InvalidApiKey` | missing/invalid `apikey` |
| 402 | `InsufficientCredit` | top up at https://iapp.co.th/control/credits |
| 413 | `FileTooLarge` | > 10 MB |
| 429 | `RateLimited` | honor `Retry-After` |
| 5xx | `ServerError` | retry later |
| — | `NetworkError` / `TimeoutError` | transport level |

**Clients must NOT auto-retry after the request body has been sent** —
requests are billable. Only connection-establishment failures are retried
(`connectRetries`, default 1).
