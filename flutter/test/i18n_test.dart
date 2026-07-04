import 'package:flutter_test/flutter_test.dart';
import 'package:iapp_ekyc_sdk/src/core/i18n/ekyc_strings.dart';

void main() {
  test('all locales expose identical key sets', () {
    final en = EkycStrings.tableFor(EkycLocale.en).keys.toSet();
    final th = EkycStrings.tableFor(EkycLocale.th).keys.toSet();
    final zh = EkycStrings.tableFor(EkycLocale.zh).keys.toSet();

    expect(
      th,
      en,
      reason:
          'th vs en — missing: ${en.difference(th)}, extra: ${th.difference(en)}',
    );
    expect(
      zh,
      en,
      reason:
          'zh vs en — missing: ${en.difference(zh)}, extra: ${zh.difference(en)}',
    );
  });

  test('no table has empty values', () {
    for (final locale in EkycLocale.values) {
      final table = EkycStrings.tableFor(locale);
      for (final entry in table.entries) {
        expect(
          entry.value.trim(),
          isNotEmpty,
          reason: '$locale/${entry.key} is empty',
        );
      }
    }
  });

  test('required UX keys exist', () {
    const required = [
      'searching_card',
      'hold_still',
      'too_blurry',
      'move_closer',
      'align_card',
      'capturing',
      'uploading',
      'done',
      'blink_now',
      'turn_left',
      'turn_right',
      'smile_now',
      'look_straight',
      'hold_face',
      'error_invalid_key',
      'error_no_credit',
      'error_network',
      'manual_capture',
      'cancel',
      'retry',
    ];
    final en = EkycStrings.tableFor(EkycLocale.en);
    for (final key in required) {
      expect(en.containsKey(key), isTrue, reason: 'missing key $key');
    }
  });

  test('overrides merge on top of the built-in table', () {
    final strings = EkycStrings.of(
      EkycLocale.en,
      overrides: {'hold_still': 'Keep steady!'},
    );
    expect(strings.get('hold_still'), 'Keep steady!');
    expect(strings.get('cancel'), 'Cancel');
  });

  test('missing keys fall back to English, then to the key itself', () {
    final th = EkycStrings.of(EkycLocale.th);
    expect(th.get('definitely_not_a_key'), 'definitely_not_a_key');
  });
}
