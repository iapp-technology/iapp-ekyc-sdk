/**
 * Persisted CPU-delegate pin (delegate-preference.ts): best-effort storage
 * that must never throw, even in WebViews that deny localStorage access.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearCpuPin,
  persistCpuPin,
  readPersistedCpuPin,
} from '../src/active-liveness/delegate-preference';

describe('delegate preference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to no pin when storage is absent (Node, some WebViews)', () => {
    expect(readPersistedCpuPin()).toBe(false);
  });

  it('persists and clears the pin', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    expect(readPersistedCpuPin()).toBe(false);
    persistCpuPin();
    expect(readPersistedCpuPin()).toBe(true);
    clearCpuPin();
    expect(readPersistedCpuPin()).toBe(false);
  });

  it('is safe when storage access throws (private mode / locked-down WebView)', () => {
    vi.stubGlobal(
      'localStorage',
      new Proxy({}, { get() { throw new Error('denied'); } }),
    );
    expect(readPersistedCpuPin()).toBe(false);
    expect(() => persistCpuPin()).not.toThrow();
    expect(() => clearCpuPin()).not.toThrow();
  });
});
