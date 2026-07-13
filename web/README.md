# @iapp-technology/ekyc-sdk

[![npm](https://img.shields.io/npm/v/@iapp-technology/ekyc-sdk?logo=npm&color=0284C7)](https://www.npmjs.com/package/@iapp-technology/ekyc-sdk)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0284C7)](https://github.com/iapp-technology/iapp-ekyc-sdk/blob/main/LICENSE)

Free, open-source **Web SDK** for [iApp Technology](https://iapp.co.th)'s enterprise
eKYC APIs — automatic Thai ID card / passport capture (OCR), face **active
liveness** with a server-signed verdict, face verification, and passive liveness.
It handles the camera, document boundary detection, blur rejection, and liveness
challenges in the browser, then submits to the paid APIs with your API key.

The SDK is free (Apache-2.0). API calls are billed per request to your
[iApp API key](https://iapp.co.th/control/api-keys).

Part of the [iApp eKYC SDK](https://github.com/iapp-technology/iapp-ekyc-sdk)
monorepo, which also ships Flutter, native iOS, native Android, and React Native
packages.

## Install

```bash
npm install @iapp-technology/ekyc-sdk
```

```js
import { IappEkyc } from '@iapp-technology/ekyc-sdk';

const ekyc = new IappEkyc({ apiKey: 'YOUR_API_KEY', locale: 'th' });

// Automatic Thai ID card capture + OCR
const result = await ekyc.captureDocument({
  mount: document.getElementById('ekyc-mount'),
  documentType: 'thaiIdFront',
});
console.log(result.raw); // full OCR response

// Face active liveness — verify the signed verdict on YOUR backend
const liveness = await ekyc.startActiveLiveness({
  mount: document.getElementById('ekyc-mount'),
});
// send liveness.verdict + liveness.signature to your server for HMAC verification
```

Or via a `<script>` tag (UMD). The global `window.IappEkyc` is a namespace —
instantiate with `new window.IappEkyc.IappEkyc({ apiKey })`:

```html
<script src="https://unpkg.com/@iapp-technology/ekyc-sdk"></script>
<!-- or self-hosted: https://iapp.co.th/sdk/ekyc-sdk.umd.js -->
<script>
  const ekyc = new window.IappEkyc.IappEkyc({ apiKey: 'YOUR_API_KEY' });
</script>
```

## Document types

`thaiIdFront` · `thaiIdBack` · `thaiIdWithSignature` · `thaiDriverLicense` ·
`bookBank` · `passport`

## Requirements

Modern browsers with **WebAssembly** and `getUserMedia`. **HTTPS is required**
(or `localhost`) — browsers block camera access on insecure origins. OpenCV.js
and MediaPipe assets are lazy-loaded only when a capture flow starts; self-host
them via the `assetBaseUrl` / `opencvScriptUrl` options if your CSP forbids CDN
requests.

## Security

- **Keep your API key out of shipped clients.** Any key in a client app can be
  extracted. For production, use the backend-proxy pattern: pass `apiKey: ''`
  and set `baseUrl` to your own backend that injects the real key.
- **Active liveness:** only the **server-signed verdict** proves liveness.
  Verify `HMAC-SHA256(secret, canonicalJSON(verdict))` against `signature` on
  your backend — never trust the on-device `passed` flag alone.

See [docs/SECURITY.md](https://github.com/iapp-technology/iapp-ekyc-sdk/blob/main/docs/SECURITY.md).

## Documentation

- [Getting started](https://iapp.co.th/docs/ekyc/sdk/getting-started)
- [Algorithm spec](https://github.com/iapp-technology/iapp-ekyc-sdk/blob/main/docs/ALGORITHM.md) ·
  [Active liveness spec](https://github.com/iapp-technology/iapp-ekyc-sdk/blob/main/docs/ACTIVE_LIVENESS.md) ·
  [API contracts](https://github.com/iapp-technology/iapp-ekyc-sdk/blob/main/docs/API_CONTRACTS.md) ·
  [Theming](https://github.com/iapp-technology/iapp-ekyc-sdk/blob/main/docs/THEMING.md)

## License

Apache License 2.0 — Copyright 2026 iApp Technology Co., Ltd.

## Support

- 💬 Discord: https://discord.gg/kYcpmdEcS2
- ✉️ sale@iapp.co.th · ☎️ 086-322-5858
