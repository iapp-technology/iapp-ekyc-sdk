# Security Considerations

## API keys in client applications

The SDK sends your iApp API key from the device/browser. **Any key that
ships in a client can be extracted** (APK decompilation, browser dev
tools). Recommendations, in order of preference:

1. **Backend proxy (recommended for production).** Point the SDK at your
   own backend and keep the iApp key server-side:

   ```dart
   IappEkycClient(apiKey: '', baseUrl: 'https://your-backend.example.com/ekyc')
   ```

   When `apiKey` is empty the SDK sends **no** `apikey` header; your proxy
   attaches the real key and forwards to `https://api.iapp.co.th`. Your
   proxy can also enforce per-user rate limits and session auth.
2. **Restricted keys.** Create a dedicated key per app in the
   [iApp dashboard](https://iapp.co.th/control/api-keys) so a leaked key
   can be revoked without affecting other integrations, and monitor its
   usage.
3. Never commit keys to source control. Use `--dart-define` /
   environment injection at build time.

## Active liveness verdicts

Only the **signed verdict returned by the finalize endpoint** proves
liveness. The SDK's on-device challenge results are UX guidance and can be
forged by a modified client. Integrator backends must:

1. Receive the finalize response from the client (or call finalize
   themselves via the proxy pattern).
2. Recompute `HMAC-SHA256(secret, canonicalJSON(verdict))` with the shared
   secret issued by iApp and compare to `signature`
   (constant-time comparison).
3. Check `verdict.passed`, `verdict.timestamp` freshness, and — if the
   selfie is transported separately — that its SHA-256 equals
   `verdict.selfie_sha256`.

Node.js example:

```js
const crypto = require('crypto');
const canonical = (o) => JSON.stringify(sortKeysDeep(o));
const expected = crypto.createHmac('sha256', SECRET).update(canonical(verdict)).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
```

## Data handling

- Captured document/selfie images are held in memory only and sent
  exclusively to the configured `baseUrl`. The SDK never writes images to
  disk and never contacts third-party servers.
- Web model/WASM assets (OpenCV.js, MediaPipe) load lazily; self-host them
  (`assetBaseUrl` option + `npm run copy-assets`) if your CSP or privacy
  policy forbids CDN requests.
- iApp's processing is PDPA and GDPR compliant — see
  https://iapp.co.th/pdpa.

## Reporting vulnerabilities

Email security findings to sale@iapp.co.th with subject
`[SECURITY] iapp-ekyc-sdk`. Please do not open public issues for
undisclosed vulnerabilities.
