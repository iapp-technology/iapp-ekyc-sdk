# Theming

Both packages ship the same **light-blue default theme** and accept full
overrides. Token names and default values are identical across platforms.

| Token | Default | Used for |
|---|---|---|
| `primary` | `#0284C7` | buttons, active guide frame, progress |
| `primaryDark` | `#0C4A6E` | headings, instruction text |
| `primaryLight` | `#BAE6FD` | idle guide frame, subtle accents |
| `surface` | `#F0F9FF` | sheets, instruction chips |
| `onPrimary` | `#FFFFFF` | text/icons on primary |
| `success` | `#22C55E` | quad locked, challenge passed |
| `warning` | `#F59E0B` | hold still / too blurry |
| `error` | `#EF4444` | failures |
| `overlayScrim` | `#0C4A6E` at 60% | camera overlay outside the guide |
| `brandDeep` | `#113F7B` | optional iApp brand accent |
| `borderRadius` | `16` | chips, buttons, result cards |
| `guideStrokeWidth` | `3` | guide frame stroke |
| `fontFamily` | platform default | optional override |

## Flutter

```dart
const theme = EkycTheme.lightBlue;             // default
final custom = EkycTheme.lightBlue.copyWith(
  primary: Color(0xFF113F7B),
  borderRadius: 12,
);
DocumentCaptureView.start(context, theme: custom, ...);
```

`EkycTheme` is a plain immutable class — no dependency on `Theme.of`, so it
works in any app regardless of Material/Cupertino setup.

## Web

Tokens are injected as CSS custom properties on the mount element:

```js
new IappEkyc({ apiKey, theme: { primary: '#113F7B', borderRadius: 12 } });
```

```css
/* or override with plain CSS */
#ekyc-mount { --iapp-ekyc-primary: #113f7b; --iapp-ekyc-border-radius: 12px; }
```

Every visual element in the overlay uses only `--iapp-ekyc-*` variables.
