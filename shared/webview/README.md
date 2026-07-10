# WebView host page

`webview.html` is the shared full-screen page loaded by the native iOS,
Android, and React Native wrapper SDKs. It runs the web engine
(`ekyc-sdk.umd.js`) and speaks bridge protocol v1 — see
[docs/WEBVIEW_BRIDGE.md](../../docs/WEBVIEW_BRIDGE.md) for the contract.

## Deployment

The page and the engine bundle must be served **side by side over HTTPS**
(camera access requires a secure context):

```bash
cp shared/webview/webview.html      <site>/static/sdk/webview.html
cp web/dist/ekyc-sdk.umd.js         <site>/static/sdk/ekyc-sdk.umd.js
```

Production URL used by the wrappers by default:
`https://iapp.co.th/sdk/webview.html`

## Development

Open the page inside an `<iframe>` on an HTTPS (or localhost) parent page —
the bridge falls back to `parent.postMessage`, and you can drive it with:

```js
iframe.contentWindow.IappEkycHost.start(JSON.stringify({
  protocolVersion: 1,
  flow: 'documentCapture',
  documentType: 'thaiIdFront',
  apiKey: 'YOUR_KEY',
  locale: 'en',
}));
```

There is no build step: the file is plain ES5 + inline CSS on purpose, so it
parses even in outdated Android System WebViews and can still report
`ENGINE_LOAD_FAILED` / `INSECURE_CONTEXT` back to the native side.
Contract tests live in `web/tests/webview-host.test.ts`.
