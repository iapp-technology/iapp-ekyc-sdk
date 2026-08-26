/**
 * Persisted inference-delegate preference.
 *
 * A device whose GPU delegate emits garbage landmarks (see
 * `isPlausiblyNormalized` in face-metrics.ts) recovers mid-session by
 * rebuilding on the CPU delegate — but that costs the user a couple of
 * seconds staring at a hint they cannot act on. Once a session has PROVEN
 * the recovery (the CPU delegate produced a usable face after the GPU one
 * produced none), the preference is stored so every later session on this
 * device starts straight on the CPU delegate.
 *
 * localStorage is best-effort: private windows and some WebViews throw on
 * access, so every call is guarded and failure simply means "no preference".
 * The pin is cleared again if a pinned session still gets unusable output —
 * an OS/driver update may have fixed the GPU path, so the next session
 * retries the default order.
 */
const KEY = 'iapp-ekyc:cpu-delegate';

/** True when a previous session proved this device needs the CPU delegate. */
export function readPersistedCpuPin(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the CPU delegate works where the GPU one does not. */
export function persistCpuPin(): void {
  try {
    globalThis.localStorage?.setItem(KEY, '1');
  } catch {
    /* best effort */
  }
}

/** Forget the preference (the pinned delegate stopped helping). */
export function clearCpuPin(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* best effort */
  }
}
