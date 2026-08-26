import type { ChallengeLogWire, SdkIntegration } from './core/types';

/** SDK version, embedded in challenge logs and exposed publicly. */
export const SDK_VERSION = '0.2.3';

/** Wire name for this SDK, per docs/ACTIVE_LIVENESS.md (`sdk.name`). */
export const SDK_NAME = 'iapp-ekyc-sdk-web';

/**
 * Resolve the challenge-log `sdk` identity: wrapper-provided fields win,
 * anything omitted falls back to the web engine's own identity.
 */
export function resolveSdkIdentity(integration?: SdkIntegration): ChallengeLogWire['sdk'] {
  return {
    name: integration?.name ?? SDK_NAME,
    version: integration?.version ?? SDK_VERSION,
    platform: integration?.platform ?? 'web',
  };
}
