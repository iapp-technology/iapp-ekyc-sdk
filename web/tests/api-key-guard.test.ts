/**
 * The docs' "YOUR_API_KEY" placeholder must fail fast with guidance instead
 * of running a whole flow that dies with INVALID_API_KEY at the last step.
 * '' remains valid: it is proxy mode (docs/SECURITY.md).
 */
import { describe, expect, it } from 'vitest';
import { IappEkyc, MISSING_API_KEY_MESSAGE } from '../src/iapp-ekyc';

describe('API key guard', () => {
  it('refuses the placeholder with the fix in the message', () => {
    expect(() => new IappEkyc({ apiKey: 'YOUR_API_KEY' })).toThrow(MISSING_API_KEY_MESSAGE);
    expect(MISSING_API_KEY_MESSAGE).toContain('https://iapp.co.th/control/api-keys');
  });

  it('accepts a real key and the proxy-mode empty key', () => {
    expect(() => new IappEkyc({ apiKey: 'iapp_live_abc' })).not.toThrow();
    expect(() => new IappEkyc({ apiKey: '', baseUrl: 'https://proxy.example' })).not.toThrow();
  });
});
