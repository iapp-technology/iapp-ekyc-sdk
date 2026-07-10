/**
 * @iapp-technology/react-native-ekyc-sdk — public entry point.
 * WebView shell over the iApp eKYC engine (docs/WEBVIEW_BRIDGE.md).
 */
export { IappEkycFlow, type IappEkycFlowProps } from './IappEkycFlow';
export {
  DEFAULT_HOST_PAGE_URL,
  PROTOCOL_VERSION,
  SUPPORTED_HOST_PAGE_VERSION,
  WRAPPER_VERSION,
} from './bridge';
export type { EkycErrorCode, EkycFlowError } from './errors';
export type {
  EkycCameraFacing,
  EkycDocumentType,
  EkycFlowResult,
  EkycFlowState,
  EkycFlowType,
  EkycImagePayload,
  EkycLocale,
  EkycThemeTokens,
} from './types';
