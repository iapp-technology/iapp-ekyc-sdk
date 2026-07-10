/**
 * Public types, mirroring the WebView bridge contract
 * (docs/WEBVIEW_BRIDGE.md) and the web engine's result shapes.
 */

export type EkycFlowType = 'documentCapture' | 'activeLiveness' | 'faceCapture';

export type EkycDocumentType =
  | 'thaiIdFront'
  | 'thaiIdBack'
  | 'thaiIdWithSignature'
  | 'thaiDriverLicense'
  | 'bookBank'
  | 'passport';

export type EkycLocale = 'en' | 'th' | 'zh';

export type EkycCameraFacing = 'environment' | 'user';

/** Theme tokens → engine `--iapp-ekyc-*` CSS variables (docs/THEMING.md). */
export interface EkycThemeTokens {
  primary?: string;
  primaryDark?: string;
  primaryLight?: string;
  surface?: string;
  onPrimary?: string;
  success?: string;
  warning?: string;
  error?: string;
  overlayScrim?: string;
  brandDeep?: string;
  fontFamily?: string;
  /** Corner radius in px. */
  borderRadius?: number;
  /** Guide stroke width in px. */
  guideStrokeWidth?: number;
}

export interface EkycImagePayload {
  /** Raw base64 (no data: prefix). */
  base64: string;
  mimeType: string;
  byteLength: number;
}

export type EkycFlowResult =
  | {
      flow: 'documentCapture';
      /** Wire document type, e.g. 'thaiIdFront'. */
      documentType: string;
      /** Full OCR response, untouched. */
      raw: Record<string, unknown>;
      capturedImage: EkycImagePayload | null;
    }
  | {
      flow: 'activeLiveness';
      /** Full finalize response, untouched. */
      raw: Record<string, unknown>;
      /**
       * Server-signed verdict. Verify `signature` on YOUR backend
       * (docs/SECURITY.md) — never trust `passed` alone on-device.
       */
      verdict: Record<string, unknown>;
      passed: boolean;
      signature: string;
      signatureAlg: string;
      processTime: number | null;
      selfieImage: EkycImagePayload | null;
    }
  | {
      flow: 'faceCapture';
      image: EkycImagePayload;
    };

/** Progress event mirroring the engine's UX states (informational). */
export interface EkycFlowState {
  flow: EkycFlowType;
  state: string;
  messageKey: string;
  detail?: {
    phase?: string;
    challenge?: string;
    challengeIndex?: number;
    challengeCount?: number;
  };
}
