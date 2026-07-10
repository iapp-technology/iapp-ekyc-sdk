import { describe, expect, it } from 'vitest';

import { resolveSdkIdentity, SDK_NAME, SDK_VERSION } from '../src/version';

describe('resolveSdkIdentity (wrapper SDK identity, docs/WEBVIEW_BRIDGE.md)', () => {
  it('defaults to the web engine identity when no integration is given', () => {
    expect(resolveSdkIdentity()).toEqual({
      name: SDK_NAME,
      version: SDK_VERSION,
      platform: 'web',
    });
    expect(resolveSdkIdentity({})).toEqual({
      name: SDK_NAME,
      version: SDK_VERSION,
      platform: 'web',
    });
  });

  it('lets a native wrapper take over the full identity', () => {
    expect(
      resolveSdkIdentity({
        name: 'iapp-ekyc-sdk-ios',
        platform: 'ios',
        version: `0.2.0+engine.${SDK_VERSION}`,
      }),
    ).toEqual({
      name: 'iapp-ekyc-sdk-ios',
      version: `0.2.0+engine.${SDK_VERSION}`,
      platform: 'ios',
    });
  });

  it('falls back per-field for partial overrides (React Native reports real OS)', () => {
    expect(resolveSdkIdentity({ name: 'iapp-ekyc-sdk-react-native', platform: 'android' })).toEqual(
      {
        name: 'iapp-ekyc-sdk-react-native',
        version: SDK_VERSION,
        platform: 'android',
      },
    );
  });
});
