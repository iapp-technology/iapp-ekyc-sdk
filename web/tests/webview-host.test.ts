/**
 * Contract tests for the WebView host page (shared/webview/webview.html,
 * docs/WEBVIEW_BRIDGE.md). The page is plain ES5 with no build step, so we
 * assert the protocol markers and — critically — that its error map covers
 * every error class the engine exports (a new engine error class must fail
 * this test until the host page maps it).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as sdk from '../src/index';

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../shared/webview/webview.html'),
  'utf8',
);

describe('webview host page — bridge protocol v1', () => {
  it('declares protocol and host page versions', () => {
    expect(html).toContain('PROTOCOL_VERSION = 1');
    expect(html).toContain('HOST_PAGE_VERSION = 1');
  });

  it('exposes the one-shot IappEkycHost.start entry point', () => {
    expect(html).toContain('window.IappEkycHost');
    expect(html).toContain('INVALID_STATE');
  });

  it('detects native bridges in the documented order (iOS, Android, RN, iframe)', () => {
    const ios = html.indexOf('webkit.messageHandlers');
    const android = html.indexOf('IappEkycAndroid');
    const rn = html.indexOf('ReactNativeWebView');
    const iframe = html.indexOf('parent.postMessage');
    expect(ios).toBeGreaterThan(-1);
    expect(android).toBeGreaterThan(ios);
    expect(rn).toBeGreaterThan(android);
    expect(iframe).toBeGreaterThan(rn);
  });

  it('supports all three flows', () => {
    for (const flow of ['documentCapture', 'activeLiveness', 'faceCapture']) {
      expect(html).toContain(flow);
    }
  });

  it('maps every engine error class exported from the SDK', () => {
    const errorClassNames = Object.entries(sdk)
      .filter(
        ([, value]) =>
          typeof value === 'function' &&
          value.prototype instanceof Error &&
          value.name.endsWith('Error'),
      )
      .map(([name]) => name);
    // Sanity: the export scan actually found the hierarchy.
    expect(errorClassNames).toContain('InsufficientCreditError');
    expect(errorClassNames.length).toBeGreaterThanOrEqual(13);
    for (const name of errorClassNames) {
      expect(html, `host page must handle ${name}`).toContain(name);
    }
  });

  it('declares the host-only error codes', () => {
    for (const code of [
      'ENGINE_LOAD_FAILED',
      'INVALID_CONFIG',
      'INVALID_STATE',
      'INSECURE_CONTEXT',
    ]) {
      expect(html).toContain(code);
    }
  });

  it('never reads config (API key) from the URL', () => {
    expect(html).not.toContain('location.search');
    expect(html).not.toContain('URLSearchParams');
    expect(html).not.toContain('location.hash');
  });

  it('loads the engine bundle from a relative path (deployed side by side)', () => {
    expect(html).toContain('src="./ekyc-sdk.umd.js"');
  });
});
