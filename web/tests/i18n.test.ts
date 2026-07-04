/**
 * i18n integrity: en/th/zh must define IDENTICAL key sets, all values
 * non-empty, covering every UX state/instruction/error in the specs.
 */
import { describe, expect, it } from 'vitest';
import { createTranslator, MESSAGE_TABLES, SUPPORTED_LOCALES } from '../src/core/i18n/i18n';

describe('i18n tables', () => {
  const enKeys = Object.keys(MESSAGE_TABLES.en).sort();

  it('covers the spec surface (>= 40 keys)', () => {
    expect(enKeys.length).toBeGreaterThanOrEqual(40);
  });

  it.each(SUPPORTED_LOCALES)('locale %s has the identical key set', (locale) => {
    expect(Object.keys(MESSAGE_TABLES[locale]).sort()).toEqual(enKeys);
  });

  it.each(SUPPORTED_LOCALES)('locale %s has no empty values', (locale) => {
    for (const [key, value] of Object.entries(MESSAGE_TABLES[locale])) {
      expect(value, `${locale}.${key}`).toBeTypeOf('string');
      expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
    }
  });

  it('includes every key required by the capture + liveness UX specs', () => {
    const required = [
      'searching_card',
      'hold_still',
      'too_blurry',
      'move_closer',
      'align_card',
      'capturing',
      'uploading',
      'done',
      'manual_capture',
      'cancel',
      'retry',
      'blink_now',
      'turn_left',
      'turn_right',
      'smile_now',
      'look_straight',
      'hold_face',
      'error_invalid_key',
      'error_no_credit',
      'error_network',
    ];
    for (const key of required) expect(enKeys).toContain(key);
  });

  it('translator falls back en -> key for unknown entries', () => {
    const t = createTranslator('th');
    expect(t('cancel')).toBe(MESSAGE_TABLES.th['cancel']);
    expect(t('__does_not_exist__')).toBe('__does_not_exist__');
  });

  it('unknown locale falls back to en', () => {
    // @ts-expect-error deliberately passing an unsupported locale
    const t = createTranslator('fr');
    expect(t('cancel')).toBe(MESSAGE_TABLES.en['cancel']);
  });
});
