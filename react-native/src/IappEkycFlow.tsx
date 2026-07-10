import { useCallback, useMemo, useRef, type ComponentType, type Ref } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import {
  WebView as RNWebView,
  type WebViewMessageEvent,
  type WebViewProps,
} from 'react-native-webview';

/** The only instance method this component uses. */
interface WebViewHandle {
  injectJavaScript: (script: string) => void;
}

// react-native-webview's root index.d.ts types the class as
// `Component<WebViewProps & undefined>`, which collapses to `never` under
// strict TypeScript — re-type the (unchanged) runtime component instead.
const WebView = RNWebView as unknown as ComponentType<
  WebViewProps & { ref?: Ref<WebViewHandle> }
>;

import {
  buildConfigJson,
  buildStartScript,
  DEFAULT_HOST_PAGE_URL,
  originOf,
  parseBridgeEvent,
  SUPPORTED_HOST_PAGE_VERSION,
  toFlowResult,
} from './bridge';
import type { EkycFlowError } from './errors';
import type {
  EkycCameraFacing,
  EkycDocumentType,
  EkycFlowResult,
  EkycFlowState,
  EkycFlowType,
  EkycLocale,
  EkycThemeTokens,
} from './types';

export interface IappEkycFlowProps {
  flow: EkycFlowType;
  /** iApp API key. `''` = proxy mode: set `baseUrl` to your backend (docs/SECURITY.md). */
  apiKey: string;
  /** Required when `flow === 'documentCapture'`. */
  documentType?: EkycDocumentType;
  /** Override the API origin (proxy mode). */
  baseUrl?: string;
  /** Per-request timeout in ms (engine default 60000). */
  timeoutMs?: number;
  /** UI language, default 'en'. */
  locale?: EkycLocale;
  /** Theme tokens → engine CSS variables (docs/THEMING.md). */
  theme?: EkycThemeTokens;
  /** Camera for documentCapture (liveness always uses the front camera). */
  cameraFacing?: EkycCameraFacing;
  /** Include captured/selfie images in the result (default true). */
  returnSelfieImage?: boolean;
  /** Hosted bridge page; HTTPS only. Default: https://iapp.co.th/sdk/webview.html */
  hostPageUrl?: string;
  onResult: (result: EkycFlowResult) => void;
  onError: (error: EkycFlowError) => void;
  onCancel: () => void;
  /** Informational engine UX states (docs/WEBVIEW_BRIDGE.md). */
  onStateChange?: (state: EkycFlowState) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Full-screen eKYC flow (wrap in a `<Modal presentationStyle="fullScreen">`).
 * Exactly one of `onResult` / `onError` / `onCancel` fires per mount;
 * unmounting the component aborts the flow (camera + network stop with the
 * WebView). Android: request the CAMERA permission BEFORE mounting
 * (react-native-webview only auto-grants the in-page camera request when
 * the app already holds it). iOS: add `NSCameraUsageDescription`.
 */
export function IappEkycFlow(props: IappEkycFlowProps): JSX.Element {
  const {
    flow,
    apiKey,
    documentType,
    baseUrl,
    timeoutMs,
    locale,
    theme,
    cameraFacing,
    returnSelfieImage,
    hostPageUrl = DEFAULT_HOST_PAGE_URL,
    onResult,
    onError,
    onCancel,
    onStateChange,
    style,
  } = props;

  const webViewRef = useRef<WebViewHandle>(null);
  const doneRef = useRef(false);

  const finishOnce = useCallback((deliver: () => void) => {
    if (doneRef.current) return;
    doneRef.current = true;
    deliver();
  }, []);

  const configJson = useMemo(
    () =>
      buildConfigJson({
        flow,
        apiKey,
        documentType,
        cameraFacing,
        baseUrl,
        timeoutMs,
        locale,
        theme,
        returnSelfieImage,
        platformOS: Platform.OS,
      }),
    [
      flow,
      apiKey,
      documentType,
      cameraFacing,
      baseUrl,
      timeoutMs,
      locale,
      theme,
      returnSelfieImage,
    ],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const bridgeEvent = parseBridgeEvent(event.nativeEvent.data);
      if (!bridgeEvent || doneRef.current) return;

      switch (bridgeEvent.type) {
        case 'ready':
          if (bridgeEvent.hostPageVersion !== SUPPORTED_HOST_PAGE_VERSION) {
            finishOnce(() =>
              onError({
                code: 'PROTOCOL_MISMATCH',
                statusCode: null,
                messageKey: 'error_generic',
                message: `Host page version ${bridgeEvent.hostPageVersion} is not supported — update @iapp-technology/react-native-ekyc-sdk`,
              }),
            );
            return;
          }
          webViewRef.current?.injectJavaScript(buildStartScript(configJson));
          break;
        case 'state':
          onStateChange?.({
            flow,
            state: bridgeEvent.state,
            messageKey: bridgeEvent.messageKey,
            detail: bridgeEvent.detail as EkycFlowState['detail'],
          });
          break;
        case 'result': {
          const result = toFlowResult(bridgeEvent.flow, bridgeEvent.result);
          if (result) {
            finishOnce(() => onResult(result));
          } else {
            finishOnce(() =>
              onError({
                code: 'UNKNOWN',
                statusCode: null,
                messageKey: 'error_generic',
                message: `Malformed result payload for flow '${bridgeEvent.flow}'`,
              }),
            );
          }
          break;
        }
        case 'error':
          finishOnce(() => onError(bridgeEvent.error));
          break;
        case 'cancelled':
          finishOnce(() => onCancel());
          break;
      }
    },
    [configJson, finishOnce, flow, onCancel, onError, onResult, onStateChange],
  );

  const loadFailed = useCallback(
    (description: string) => {
      finishOnce(() =>
        onError({
          code: 'HOST_PAGE_LOAD_FAILED',
          statusCode: null,
          messageKey: 'error_network',
          message: `Could not load ${hostPageUrl}: ${description}`,
        }),
      );
    },
    [finishOnce, hostPageUrl, onError],
  );

  const onLoadError = useCallback<NonNullable<WebViewProps['onError']>>(
    (event) => loadFailed(event.nativeEvent.description),
    [loadFailed],
  );

  const onHttpError = useCallback<NonNullable<WebViewProps['onHttpError']>>(
    (event) => loadFailed(`HTTP ${event.nativeEvent.statusCode}`),
    [loadFailed],
  );

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: hostPageUrl }}
      originWhitelist={[originOf(hostPageUrl)]}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grant"
      onMessage={onMessage}
      onError={onLoadError}
      onHttpError={onHttpError}
      style={[styles.webview, style]}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
