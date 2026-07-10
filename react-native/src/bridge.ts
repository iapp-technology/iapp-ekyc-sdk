/**
 * Bridge protocol v1 codec (docs/WEBVIEW_BRIDGE.md). No react-native
 * imports — pure functions, unit-testable anywhere.
 */
import type { EkycErrorCode, EkycFlowError } from './errors';
import type {
  EkycCameraFacing,
  EkycDocumentType,
  EkycFlowResult,
  EkycFlowType,
  EkycLocale,
  EkycThemeTokens,
} from './types';

export const PROTOCOL_VERSION = 1;
export const SUPPORTED_HOST_PAGE_VERSION = 1;
export const DEFAULT_HOST_PAGE_URL = 'https://iapp.co.th/sdk/webview.html';
export const WRAPPER_VERSION = '0.2.0';
const ENGINE_VERSION = '0.2.0';

const ERROR_CODES: readonly EkycErrorCode[] = [
  'BAD_REQUEST',
  'INVALID_API_KEY',
  'INSUFFICIENT_CREDIT',
  'FILE_TOO_LARGE',
  'RATE_LIMITED',
  'SERVER_ERROR',
  'NETWORK_ERROR',
  'TIMEOUT',
  'LIVENESS_FAILED',
  'CAMERA_PERMISSION_DENIED',
  'CAMERA_NOT_FOUND',
  'INSECURE_CONTEXT',
  'ENGINE_LOAD_FAILED',
  'INVALID_CONFIG',
  'INVALID_STATE',
  'HOST_PAGE_LOAD_FAILED',
  'PROTOCOL_MISMATCH',
  'UNKNOWN',
];

export type BridgeEvent =
  | { type: 'ready'; hostPageVersion: number; engineVersion: string | null }
  | {
      type: 'state';
      flow: string;
      state: string;
      messageKey: string;
      detail?: Record<string, unknown>;
    }
  | { type: 'result'; flow: string; result: Record<string, unknown> }
  | { type: 'error'; error: EkycFlowError }
  | { type: 'cancelled' };

/** Parse a host-page event JSON string; null for foreign/invalid messages. */
export function parseBridgeEvent(json: string): BridgeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const dict = parsed as Record<string, unknown>;

  switch (dict.type) {
    case 'ready':
      return {
        type: 'ready',
        hostPageVersion: typeof dict.hostPageVersion === 'number' ? dict.hostPageVersion : -1,
        engineVersion: typeof dict.engineVersion === 'string' ? dict.engineVersion : null,
      };
    case 'state':
      return {
        type: 'state',
        flow: String(dict.flow ?? ''),
        state: String(dict.state ?? ''),
        messageKey: String(dict.messageKey ?? ''),
        detail:
          dict.detail && typeof dict.detail === 'object'
            ? (dict.detail as Record<string, unknown>)
            : undefined,
      };
    case 'result': {
      const result = dict.result;
      if (!result || typeof result !== 'object') return null;
      return {
        type: 'result',
        flow: String(dict.flow ?? ''),
        result: result as Record<string, unknown>,
      };
    }
    case 'error': {
      const raw = (dict.error ?? {}) as Record<string, unknown>;
      const rawCode = String(raw.code ?? 'UNKNOWN');
      const code: EkycErrorCode = (ERROR_CODES as readonly string[]).includes(rawCode)
        ? (rawCode as EkycErrorCode)
        : 'UNKNOWN';
      return {
        type: 'error',
        error: {
          code,
          statusCode: typeof raw.statusCode === 'number' ? raw.statusCode : null,
          messageKey: String(raw.messageKey ?? 'error_generic'),
          message: String(raw.message ?? 'Unknown error'),
          retryAfterSeconds:
            typeof raw.retryAfterSeconds === 'number' ? raw.retryAfterSeconds : null,
          reason: typeof raw.reason === 'string' ? raw.reason : null,
        },
      };
    }
    case 'cancelled':
      return { type: 'cancelled' };
    default:
      return null;
  }
}

export interface BridgeConfigInput {
  flow: EkycFlowType;
  apiKey: string;
  documentType?: EkycDocumentType;
  cameraFacing?: EkycCameraFacing;
  baseUrl?: string;
  timeoutMs?: number;
  locale?: EkycLocale;
  theme?: EkycThemeTokens;
  returnSelfieImage?: boolean;
  /** The real OS the app runs on ('ios' | 'android'). */
  platformOS: string;
}

/**
 * Bridge config JSON for `IappEkycHost.start(...)` (docs/WEBVIEW_BRIDGE.md).
 * The API key travels only here — never in the page URL.
 */
export function buildConfigJson(input: BridgeConfigInput): string {
  const config: Record<string, unknown> = {
    protocolVersion: PROTOCOL_VERSION,
    flow: input.flow,
    apiKey: input.apiKey,
    locale: input.locale ?? 'en',
    returnSelfieImage: input.returnSelfieImage !== false,
    integration: {
      name: 'iapp-ekyc-sdk-react-native',
      platform: input.platformOS === 'android' ? 'android' : 'ios',
      version: `${WRAPPER_VERSION}+engine.${ENGINE_VERSION}`,
    },
  };
  if (input.flow === 'documentCapture') {
    config.documentType = input.documentType;
    if (input.cameraFacing) config.cameraFacing = input.cameraFacing;
  }
  if (input.baseUrl) config.baseUrl = input.baseUrl;
  if (typeof input.timeoutMs === 'number') config.timeoutMs = input.timeoutMs;
  if (input.theme && Object.keys(input.theme).length > 0) config.theme = input.theme;
  return JSON.stringify(config);
}

/** JS injected on `ready`; double-stringify makes a JS string literal. */
export function buildStartScript(configJson: string): string {
  return `window.IappEkycHost.start(${JSON.stringify(configJson)}); true;`;
}

/** 'https://iapp.co.th/sdk/webview.html' → 'https://iapp.co.th' */
export function originOf(url: string): string {
  const match = /^(https?:\/\/[^/]+)/i.exec(url);
  return match ? match[1] : url;
}

/** Narrow a bridge `result` payload into the typed union; null if malformed. */
export function toFlowResult(
  flow: string,
  result: Record<string, unknown>,
): EkycFlowResult | null {
  const image = (key: string) => {
    const payload = result[key];
    if (!payload || typeof payload !== 'object') return null;
    const dict = payload as Record<string, unknown>;
    if (typeof dict.base64 !== 'string' || !dict.base64) return null;
    return {
      base64: dict.base64,
      mimeType: typeof dict.mimeType === 'string' ? dict.mimeType : 'image/jpeg',
      byteLength: typeof dict.byteLength === 'number' ? dict.byteLength : 0,
    };
  };

  switch (flow) {
    case 'documentCapture':
      return {
        flow: 'documentCapture',
        documentType: String(result.documentType ?? ''),
        raw: (result.raw ?? {}) as Record<string, unknown>,
        capturedImage: image('capturedImage'),
      };
    case 'activeLiveness':
      return {
        flow: 'activeLiveness',
        raw: (result.raw ?? {}) as Record<string, unknown>,
        verdict: (result.verdict ?? {}) as Record<string, unknown>,
        passed: result.passed === true,
        signature: String(result.signature ?? ''),
        signatureAlg: String(result.signatureAlg ?? ''),
        processTime: typeof result.processTime === 'number' ? result.processTime : null,
        selfieImage: image('selfieImage'),
      };
    case 'faceCapture': {
      const payload = image('image');
      if (!payload) return null;
      return { flow: 'faceCapture', image: payload };
    }
    default:
      return null;
  }
}
