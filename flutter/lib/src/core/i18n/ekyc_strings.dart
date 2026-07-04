import 'strings_en.dart';
import 'strings_th.dart';
import 'strings_zh.dart';

/// Locales supported out of the box by the iApp eKYC SDK.
enum EkycLocale {
  /// English.
  en,

  /// Thai (polite formal register).
  th,

  /// Chinese, Simplified (formal register).
  zh,
}

/// Localized string table used by all SDK UI.
///
/// ```dart
/// final strings = EkycStrings.of(EkycLocale.th);
/// strings.get('hold_still');
///
/// // Override individual keys:
/// final custom = EkycStrings.of(
///   EkycLocale.en,
///   overrides: {'hold_still': 'Keep steady!'},
/// );
/// ```
class EkycStrings {
  final EkycLocale locale;
  final Map<String, String> _table;

  EkycStrings._(this.locale, this._table);

  /// Returns the string table for [locale], with optional [overrides]
  /// merged on top of the built-in table.
  factory EkycStrings.of(EkycLocale locale, {Map<String, String>? overrides}) {
    final base = tableFor(locale);
    if (overrides == null || overrides.isEmpty) {
      return EkycStrings._(locale, base);
    }
    return EkycStrings._(locale, {...base, ...overrides});
  }

  /// The raw built-in table for [locale] (unmodifiable input; do not mutate).
  static Map<String, String> tableFor(EkycLocale locale) {
    switch (locale) {
      case EkycLocale.en:
        return ekycStringsEn;
      case EkycLocale.th:
        return ekycStringsTh;
      case EkycLocale.zh:
        return ekycStringsZh;
    }
  }

  /// Looks up [key]; falls back to English, then to the key itself so a
  /// missing translation never crashes the UI.
  String get(String key) => _table[key] ?? ekycStringsEn[key] ?? key;

  /// Shorthand for [get].
  String operator [](String key) => get(key);

  /// All keys available in this table.
  Iterable<String> get keys => _table.keys;
}
