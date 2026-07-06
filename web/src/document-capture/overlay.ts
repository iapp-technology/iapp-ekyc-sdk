/**
 * DOM + canvas overlay used by the capture flows.
 *
 * THEMING RULE (docs/THEMING.md): every visual element here derives its
 * color/radius/stroke EXCLUSIVELY from the `--iapp-ekyc-*` CSS custom
 * properties injected by core/theme.ts (DOM elements via `var(...)`,
 * canvas strokes via `readThemeToken`, which resolves the same variables
 * through getComputedStyle so plain-CSS overrides win).
 */
import { readThemeToken, type EkycTheme } from '../core/theme';
import type { Translator } from '../core/i18n/i18n';
import type { Quad } from '../vision/geometry';
import type { GuideRect } from '../vision/quad-detector';
import type { CardLayout } from './document-types';

export type GuideTone = 'idle' | 'active' | 'locked' | 'warning' | 'error';

const TONE_TOKEN: Record<GuideTone, keyof EkycTheme> = {
  idle: 'primaryLight',
  active: 'primary',
  locked: 'success',
  warning: 'warning',
  error: 'error',
};

export interface OverlayElements {
  root: HTMLDivElement;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  chip: HTMLDivElement;
  progressTrack: HTMLDivElement;
  progressBar: HTMLDivElement;
  manualButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  /** White flash layer for the camera-shutter effect. */
  flash: HTMLDivElement;
  /** Frozen still of the captured image, shown over the video on upload. */
  freeze: HTMLImageElement;
  destroy(): void;
}

function styleButton(button: HTMLButtonElement, variant: 'primary' | 'ghost'): void {
  button.type = 'button';
  button.style.cssText = [
    'padding: 10px 20px',
    'border-radius: var(--iapp-ekyc-border-radius)',
    'font-family: var(--iapp-ekyc-font-family)',
    'font-size: 15px',
    'cursor: pointer',
    variant === 'primary'
      ? 'background: var(--iapp-ekyc-primary); color: var(--iapp-ekyc-on-primary); border: none'
      : 'background: transparent; color: var(--iapp-ekyc-on-primary); border: 1px solid var(--iapp-ekyc-on-primary)',
  ].join(';');
}

/**
 * Build the capture DOM inside `mount`:
 * video + overlay canvas + status chip + progress bar + (hidden) manual
 * capture button + cancel button. `destroy()` removes everything.
 */
export function buildOverlay(
  mount: HTMLElement,
  t: Translator,
  options: { mirror?: boolean } = {},
): OverlayElements {
  const root = document.createElement('div');
  root.className = 'iapp-ekyc-root';
  root.style.cssText = [
    'position: relative',
    'width: 100%',
    'overflow: hidden',
    'background: #000',
    'border-radius: var(--iapp-ekyc-border-radius)',
    'font-family: var(--iapp-ekyc-font-family)',
    'line-height: 1.4',
  ].join(';');

  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = [
    'display: block',
    'width: 100%',
    'height: auto',
    options.mirror ? 'transform: scaleX(-1)' : '',
  ].join(';');

  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;';

  // Frozen still shown over the video while uploading, so the user sees the
  // exact image being submitted. Hidden until capture.
  const freeze = document.createElement('img');
  freeze.alt = '';
  freeze.style.cssText =
    'position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; display: none;';

  // White shutter-flash layer (fades out via a CSS transition on opacity).
  const flash = document.createElement('div');
  flash.style.cssText =
    'position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; transition: opacity 320ms ease-out;';

  const chip = document.createElement('div');
  chip.className = 'iapp-ekyc-chip';
  chip.textContent = t('initializing');
  chip.style.cssText = [
    'position: absolute',
    'top: 12px',
    'left: 50%',
    'transform: translateX(-50%)',
    'max-width: 90%',
    'padding: 8px 16px',
    'border-radius: var(--iapp-ekyc-border-radius)',
    'background: var(--iapp-ekyc-surface)',
    'color: var(--iapp-ekyc-primary-dark)',
    'font-size: 15px',
    'font-weight: 600',
    'text-align: center',
    'font-family: var(--iapp-ekyc-font-family)',
  ].join(';');

  const progressTrack = document.createElement('div');
  progressTrack.style.cssText = [
    'position: absolute',
    'left: 50%',
    'transform: translateX(-50%)',
    'bottom: 64px',
    'width: 40%',
    'height: 6px',
    'border-radius: 3px',
    'background: var(--iapp-ekyc-primary-light)',
    'overflow: hidden',
  ].join(';');
  const progressBar = document.createElement('div');
  progressBar.style.cssText =
    'width: 0%; height: 100%; background: var(--iapp-ekyc-primary); transition: width 120ms linear;';
  progressTrack.appendChild(progressBar);

  const controls = document.createElement('div');
  controls.style.cssText = [
    'position: absolute',
    'bottom: 12px',
    'left: 0',
    'right: 0',
    'display: flex',
    'justify-content: center',
    'gap: 12px',
  ].join(';');

  const manualButton = document.createElement('button');
  manualButton.textContent = t('manual_capture');
  styleButton(manualButton, 'primary');
  manualButton.style.display = 'none'; // shown after manualFallbackMs

  const cancelButton = document.createElement('button');
  cancelButton.textContent = t('cancel');
  styleButton(cancelButton, 'ghost');

  controls.append(manualButton, cancelButton);
  // freeze sits above the video, flash above everything visual.
  root.append(video, freeze, canvas, chip, progressTrack, controls, flash);
  mount.appendChild(root);

  return {
    root,
    video,
    canvas,
    chip,
    progressTrack,
    progressBar,
    manualButton,
    cancelButton,
    flash,
    freeze,
    destroy(): void {
      root.remove();
    },
  };
}

function tracePathRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function pxToken(el: HTMLElement, name: keyof EkycTheme, fallback: number): number {
  const parsed = Number.parseFloat(readThemeToken(el, name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Draw the faint per-card schematic (photo box, text lines, flag, emblem,
 * MRZ) inside the guide so the user aligns the document the right way up.
 * Uses only theme tokens; `onPrimary` at low alpha reads on the scrim in
 * both light and dark themes.
 */
function drawCardSchematic(
  ctx: CanvasRenderingContext2D,
  themeSource: HTMLElement,
  guide: GuideRect,
  layout: CardLayout,
): void {
  const ink = readThemeToken(themeSource, 'onPrimary');
  const accent = readThemeToken(themeSource, 'primaryLight');
  const px = (nx: number) => guide.x + nx * guide.width;
  const py = (ny: number) => guide.y + ny * guide.height;
  const pw = (nw: number) => nw * guide.width;
  const ph = (nh: number) => nh * guide.height;
  const unit = Math.min(guide.width, guide.height);

  ctx.save();
  // Faint panel so the schematic reads over any camera background.
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = ink;
  ctx.fillRect(guide.x, guide.y, guide.width, guide.height);

  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1.5, unit * 0.01);

  for (const h of layout.hints) {
    const x = px(h.x);
    const y = py(h.y);
    const w = pw(h.w);
    const hh = ph(h.h);
    switch (h.kind) {
      case 'photo': {
        // Box + simple person glyph (head + shoulders).
        ctx.strokeStyle = ink;
        ctx.strokeRect(x, y, w, hh);
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.35;
        const cx = x + w / 2;
        const headR = w * 0.18;
        ctx.beginPath();
        ctx.arc(cx, y + hh * 0.4, headR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, y + hh * 0.95, w * 0.34, Math.PI, 0);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        break;
      }
      case 'lines':
      case 'mrz': {
        const n = h.lines ?? 3;
        ctx.fillStyle = h.kind === 'mrz' ? ink : accent;
        const gap = hh / n;
        const barH = Math.min(gap * 0.5, unit * 0.02);
        for (let i = 0; i < n; i++) {
          const by = y + i * gap + (gap - barH) / 2;
          // MRZ bars run full width; data lines taper for realism.
          const bw = h.kind === 'mrz' ? w : w * (i % 2 === 0 ? 1 : 0.7);
          ctx.fillRect(x, by, bw, barH);
        }
        break;
      }
      case 'flag': {
        // Three horizontal stripes (Thai-flag-ish proportions).
        ctx.fillStyle = ink;
        const bands = [0.25, 0.5, 0.25];
        let by = y;
        for (let i = 0; i < bands.length; i++) {
          ctx.globalAlpha = i === 1 ? 0.5 : 0.3;
          ctx.fillRect(x, by, w, hh * bands[i]);
          by += hh * bands[i];
        }
        ctx.globalAlpha = 0.5;
        break;
      }
      case 'emblem': {
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }
  }
  ctx.restore();
}

/**
 * Draw the document overlay: scrim outside the guide, rounded guide frame,
 * and the detected quad highlight. All coordinates are in canvas pixels
 * (canvas is sized to the native video resolution).
 */
export function drawDocumentOverlay(
  canvas: HTMLCanvasElement,
  themeSource: HTMLElement,
  guide: GuideRect,
  quad: Quad | null,
  tone: GuideTone,
  layout?: CardLayout,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const radius = pxToken(themeSource, 'borderRadius', 16);
  const stroke = pxToken(themeSource, 'guideStrokeWidth', 3);

  ctx.clearRect(0, 0, width, height);

  // Scrim with a rounded-rect cutout over the guide area.
  ctx.save();
  ctx.fillStyle = readThemeToken(themeSource, 'overlayScrim');
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  tracePathRoundedRect(ctx, guide.x, guide.y, guide.width, guide.height, radius);
  ctx.fill('evenodd');
  ctx.restore();

  // Card-layout schematic hint — only while still searching (no quad yet),
  // so the user knows which way up to hold this particular document.
  if (layout && !quad) {
    drawCardSchematic(ctx, themeSource, guide, layout);
  }

  // Guide frame.
  ctx.save();
  ctx.strokeStyle = readThemeToken(themeSource, TONE_TOKEN[tone]);
  ctx.lineWidth = stroke;
  ctx.beginPath();
  tracePathRoundedRect(ctx, guide.x, guide.y, guide.width, guide.height, radius);
  ctx.stroke();
  ctx.restore();

  // Detected quad highlight.
  if (quad) {
    ctx.save();
    ctx.strokeStyle = readThemeToken(
      themeSource,
      tone === 'locked' ? 'success' : 'primary',
    );
    ctx.lineWidth = stroke;
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

export interface OvalGuide {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Default face oval: centered slightly above middle, per common eKYC UX. */
export function computeOvalGuide(width: number, height: number): OvalGuide {
  return {
    cx: width * 0.5,
    cy: height * 0.45,
    rx: Math.min(width * 0.3, height * 0.28),
    ry: Math.min(width * 0.42, height * 0.38),
  };
}

/**
 * Draw the liveness overlay: scrim with an elliptical cutout, oval stroke
 * colored by tone, and one progress dot per challenge below the oval.
 */
export function drawOvalOverlay(
  canvas: HTMLCanvasElement,
  themeSource: HTMLElement,
  oval: OvalGuide,
  tone: GuideTone,
  challengeCount: number,
  challengesDone: number,
  /** Turn-challenge direction hint: big chevrons beside the oval. */
  arrow: 'left' | 'right' | null = null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const stroke = pxToken(themeSource, 'guideStrokeWidth', 3);

  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = readThemeToken(themeSource, 'overlayScrim');
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.ellipse(oval.cx, oval.cy, oval.rx, oval.ry, 0, 0, Math.PI * 2);
  ctx.fill('evenodd');
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = readThemeToken(themeSource, TONE_TOKEN[tone]);
  ctx.lineWidth = stroke;
  ctx.beginPath();
  ctx.ellipse(oval.cx, oval.cy, oval.rx, oval.ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Turn-direction HUD: three large chevrons beside the oval pointing the
  // way the user must turn (preview is mirrored → user-left = screen-left).
  if (arrow) {
    const dir = arrow === 'left' ? -1 : 1;
    const chevW = Math.max(14, oval.rx * 0.18);
    const chevH = chevW * 1.6;
    const baseX = oval.cx + dir * (oval.rx + chevW * 1.2);
    const color = readThemeToken(themeSource, 'primary');
    for (let i = 0; i < 3; i++) {
      const x = baseX + dir * i * chevW * 1.1;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(5, stroke * 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1 - i * 0.28; // leading chevron boldest
      ctx.beginPath();
      ctx.moveTo(x, oval.cy - chevH / 2);
      ctx.lineTo(x + dir * chevW * 0.8, oval.cy);
      ctx.lineTo(x, oval.cy + chevH / 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Challenge progress dots.
  if (challengeCount > 0) {
    const dotRadius = Math.max(4, stroke * 2);
    const gap = dotRadius * 3;
    const totalWidth = (challengeCount - 1) * gap;
    const y = Math.min(height - dotRadius * 2, oval.cy + oval.ry + dotRadius * 4);
    const doneColor = readThemeToken(themeSource, 'success');
    const pendingColor = readThemeToken(themeSource, 'primaryLight');
    for (let i = 0; i < challengeCount; i++) {
      ctx.save();
      ctx.fillStyle = i < challengesDone ? doneColor : pendingColor;
      ctx.beginPath();
      ctx.arc(oval.cx - totalWidth / 2 + i * gap, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
