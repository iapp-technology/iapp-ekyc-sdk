# WebView Bridge Protocol (v1)

Contract between the shared host page (`shared/webview/webview.html`,
deployed at `https://iapp.co.th/sdk/webview.html`) and the native wrapper
SDKs (`ios/`, `android/`, `react-native/`). The host page runs the web
engine (`web/`) inside a WebView; the wrappers only speak this protocol —
they never touch the engine API directly.

## Transport

- **Host → native:** every event is one JSON **string** posted to the first
  available bridge, probed in this order:
  1. `window.webkit.messageHandlers.iappEkyc.postMessage(json)` — iOS (WKScriptMessageHandler)
  2. `window.IappEkycAndroid.postMessage(json)` — Android (`@JavascriptInterface`)
  3. `window.ReactNativeWebView.postMessage(json)` — react-native-webview
  4. `window.parent.postMessage(json, '*')` — iframe development fallback
- **Native → host:** exactly one call to
  `window.IappEkycHost.start(configJson)` (via `evaluateJavaScript` /
  `evaluateJavascript` / `injectJavaScript`), sent **only after** the `ready`
  event. `start` is one-shot: a second call posts an `INVALID_STATE` error.
  One flow per page load — reload the WebView for another flow; **destroying
  the WebView is the abort mechanism** (the engine has no abort API).
- **The API key must never appear in the URL** (history / proxy logs /
  Referer). It travels only inside the `start` config.

## Config (native → host)

```json
{
  "protocolVersion": 1,
  "flow": "documentCapture",
  "apiKey": "sk-...",
  "baseUrl": null,
  "timeoutMs": 60000,
  "locale": "th",
  "theme": { "primary": "#0284C7", "borderRadius": 16 },
  "documentType": "thaiIdFront",
  "cameraFacing": "environment",
  "returnSelfieImage": true,
  "integration": { "name": "iapp-ekyc-sdk-ios", "platform": "ios", "version": "0.2.0+engine.0.2.0" }
}
```

| Field | Notes |
|---|---|
| `flow` | `documentCapture` \| `activeLiveness` \| `faceCapture` |
| `apiKey` | `""` = proxy mode (set `baseUrl` to your backend, docs/SECURITY.md) |
| `baseUrl`, `timeoutMs`, `locale`, `theme` | passed through to the engine constructor |
| `documentType` | required for `documentCapture`: `thaiIdFront` \| `thaiIdBack` \| `thaiIdWithSignature` \| `thaiDriverLicense` \| `bookBank` \| `passport` |
| `cameraFacing` | `environment` (default) \| `user` — `documentCapture` only |
| `returnSelfieImage` | default `true`; `false` omits image payloads from the result message |
| `integration` | wrapper identity for the challenge log `sdk` block (docs/ACTIVE_LIVENESS.md). React Native reports the real OS (`ios`/`android`) with `name: "iapp-ekyc-sdk-react-native"` |

## Events (host → native)

Every event carries `"protocolVersion": 1`.

```json
{"protocolVersion":1,"type":"ready","hostPageVersion":1,"engineVersion":"0.2.0","secureContext":true}

{"protocolVersion":1,"type":"state","flow":"documentCapture","state":"holdStill","messageKey":"hold_still"}
{"protocolVersion":1,"type":"state","flow":"activeLiveness","state":"challenge","messageKey":"blink_now",
 "detail":{"phase":"challenge","challenge":"blink","challengeIndex":1,"challengeCount":3}}

{"protocolVersion":1,"type":"result","flow":"documentCapture","result":{ ... }}

{"protocolVersion":1,"type":"error",
 "error":{"code":"INSUFFICIENT_CREDIT","statusCode":402,"messageKey":"error_no_credit","message":"..."}}

{"protocolVersion":1,"type":"cancelled"}
```

- Wrappers must validate `hostPageVersion === 1` on `ready` and fail with
  `PROTOCOL_MISMATCH` otherwise (guards hosted-page/wrapper version skew).
- The engine's built-in Cancel button produces `cancelled`, **not** `error`.
- `state` values mirror the engine's `CaptureState` / liveness phases and are
  informational (UX/analytics); wrappers must not branch on them for outcomes.

## Result payloads (`result` field)

Image fields are `{ "base64": "...", "mimeType": "image/jpeg", "byteLength": 412345 }`
or `null`. If an encoded image would exceed 12,000,000 base64 chars (never in
practice — uploads cap at 10 MB), it is sent as `null` plus `"imageOmitted": true`.

```json
{ "flow": "documentCapture", "documentType": "thaiIdFront",
  "raw": { "...": "full OCR response" }, "capturedImage": { "...": "..." } }

{ "flow": "activeLiveness", "raw": { "...": "full finalize response" },
  "verdict": { "passed": true, "session_id": "...", "selfie_sha256": "...", "...": "..." },
  "passed": true, "signature": "hex...", "signatureAlg": "HMAC-SHA256",
  "processTime": 0.42, "selfieImage": { "...": "..." } }

{ "flow": "faceCapture", "image": { "...": "..." } }
```

> Only the server-signed `verdict` (verified on **your backend** with your
> signing secret) proves liveness — never trust `passed` alone on-device.

## Error codes

Engine errors (`error.messageKey` resolves through the engine i18n tables):

| code | statusCode | source engine error |
|---|---|---|
| `BAD_REQUEST` | 400 | BadRequestError |
| `INVALID_API_KEY` | 401 | InvalidApiKeyError |
| `INSUFFICIENT_CREDIT` | 402 | InsufficientCreditError |
| `FILE_TOO_LARGE` | 413 | FileTooLargeError |
| `RATE_LIMITED` (+`retryAfterSeconds`) | 429 | RateLimitedError |
| `SERVER_ERROR` | 5xx | ServerError |
| `NETWORK_ERROR` | null | NetworkError |
| `TIMEOUT` | null | TimeoutError |
| `LIVENESS_FAILED` (+`reason`) | null | LivenessFailedError |
| `CAMERA_PERMISSION_DENIED` | null | CameraPermissionDeniedError |
| `CAMERA_NOT_FOUND` | null | CameraNotFoundError / CameraError |
| `INSECURE_CONTEXT` | null | InsecureContextError |
| `FACE_DETECTOR_UNAVAILABLE` | null | FaceDetectorUnavailableError |
| `UNKNOWN` | passthrough | anything else |

Host-page / wrapper errors (no engine involved):

| code | raised by | meaning |
|---|---|---|
| `ENGINE_LOAD_FAILED` | host | `ekyc-sdk.umd.js` failed to load |
| `INVALID_CONFIG` | host | malformed config / missing `documentType` / engine rejected options |
| `INVALID_STATE` | host | `start()` called twice on one page load |
| `INSECURE_CONTEXT` | host | page served without HTTPS |
| `HOST_PAGE_LOAD_FAILED` | wrapper | the WebView could not load the host page |
| `PROTOCOL_MISMATCH` | wrapper | `ready.hostPageVersion` ≠ supported version |

## Versioning

`protocolVersion` gates the message schema; `hostPageVersion` gates host-page
behavior. Additive fields do not bump versions; breaking changes bump both
and wrappers refuse to start (`PROTOCOL_MISMATCH`). Contract tests:
`web/tests/webview-host.test.ts`.
