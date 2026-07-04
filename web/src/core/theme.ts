/**
 * Theme tokens per docs/THEMING.md. Tokens are injected as CSS custom
 * properties (`--iapp-ekyc-*`) on the mount element; every visual element
 * rendered by the SDK reads ONLY these variables, so integrators can also
 * override them with plain CSS.
 */

export interface EkycTheme {
  /** Buttons, active guide frame, progress. */
  primary: string;
  /** Headings, instruction text. */
  primaryDark: string;
  /** Idle guide frame, subtle accents. */
  primaryLight: string;
  /** Sheets, instruction chips. */
  surface: string;
  /** Text/icons on primary. */
  onPrimary: string;
  /** Quad locked, challenge passed. */
  success: string;
  /** Hold still / too blurry. */
  warning: string;
  /** Failures. */
  error: string;
  /** Camera overlay outside the guide. */
  overlayScrim: string;
  /** Optional iApp brand accent. */
  brandDeep: string;
  /** Chips, buttons, result cards (px). */
  borderRadius: number;
  /** Guide frame stroke (px). */
  guideStrokeWidth: number;
  /** Optional font family override; null = platform default. */
  fontFamily: string | null;
}

/** The shared light-blue default theme (identical to the Flutter SDK). */
export const DEFAULT_THEME: EkycTheme = {
  primary: '#0284C7',
  primaryDark: '#0C4A6E',
  primaryLight: '#BAE6FD',
  surface: '#F0F9FF',
  onPrimary: '#FFFFFF',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  overlayScrim: 'rgba(12, 74, 110, 0.6)', // #0C4A6E at 60%
  brandDeep: '#113F7B',
  borderRadius: 16,
  guideStrokeWidth: 3,
  fontFamily: null,
};

/** token key -> CSS custom property name */
export const THEME_CSS_VARS: Record<keyof EkycTheme, string> = {
  primary: '--iapp-ekyc-primary',
  primaryDark: '--iapp-ekyc-primary-dark',
  primaryLight: '--iapp-ekyc-primary-light',
  surface: '--iapp-ekyc-surface',
  onPrimary: '--iapp-ekyc-on-primary',
  success: '--iapp-ekyc-success',
  warning: '--iapp-ekyc-warning',
  error: '--iapp-ekyc-error',
  overlayScrim: '--iapp-ekyc-overlay-scrim',
  brandDeep: '--iapp-ekyc-brand-deep',
  borderRadius: '--iapp-ekyc-border-radius',
  guideStrokeWidth: '--iapp-ekyc-guide-stroke-width',
  fontFamily: '--iapp-ekyc-font-family',
};

/**
 * Merge overrides onto the default theme and inject the tokens as
 * `--iapp-ekyc-*` CSS custom properties on `element`. Returns the resolved
 * theme. Numeric tokens are written with a `px` unit.
 */
export function applyTheme(element: HTMLElement, overrides?: Partial<EkycTheme>): EkycTheme {
  const theme: EkycTheme = { ...DEFAULT_THEME, ...overrides };
  const set = (key: keyof EkycTheme, value: string) =>
    element.style.setProperty(THEME_CSS_VARS[key], value);
  set('primary', theme.primary);
  set('primaryDark', theme.primaryDark);
  set('primaryLight', theme.primaryLight);
  set('surface', theme.surface);
  set('onPrimary', theme.onPrimary);
  set('success', theme.success);
  set('warning', theme.warning);
  set('error', theme.error);
  set('overlayScrim', theme.overlayScrim);
  set('brandDeep', theme.brandDeep);
  set('borderRadius', `${theme.borderRadius}px`);
  set('guideStrokeWidth', `${theme.guideStrokeWidth}px`);
  set('fontFamily', theme.fontFamily ?? 'inherit');
  return theme;
}

/**
 * Read a resolved token off an element (respects plain-CSS overrides).
 * `name` is the token key, e.g. `primary`. Falls back to the default theme.
 */
export function readThemeToken(element: HTMLElement, name: keyof EkycTheme): string {
  const cssVar = THEME_CSS_VARS[name];
  const value = getComputedStyle(element).getPropertyValue(cssVar).trim();
  if (value) return value;
  const fallback = DEFAULT_THEME[name];
  return typeof fallback === 'number' ? `${fallback}px` : (fallback ?? 'inherit');
}
