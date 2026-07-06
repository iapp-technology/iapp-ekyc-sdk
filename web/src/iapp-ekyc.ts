/**
 * Public facade. One instance holds the API client + default theme/locale
 * and spawns interactive flows (document capture, active liveness) or
 * calls the stateless endpoints directly.
 *
 * ```js
 * const ekyc = new IappEkyc({ apiKey: '...', locale: 'th' });
 * const doc = await ekyc.captureDocument({
 *   mount: document.getElementById('mount'),
 *   documentType: 'thaiIdFront',
 * });
 * ```
 */
import { EkycApiClient, type EkycApiClientOptions } from './core/api-client';
import type { Locale } from './core/i18n/i18n';
import type { EkycTheme } from './core/theme';
import type {
  ActiveLivenessResult,
  DocumentResult,
  FaceVerificationResult,
  PassiveLivenessResult,
} from './core/types';
import {
  ActiveLivenessFlow,
  type ActiveLivenessStartOptions,
} from './active-liveness/active-liveness';
import { FaceCapture, type FaceCaptureStartOptions } from './active-liveness/face-capture';
import {
  DocumentCapture,
  type DocumentCaptureStartOptions,
} from './document-capture/document-capture';
import type { DocumentType } from './document-capture/document-types';
import { FaceApi } from './face-api/index';

export interface IappEkycOptions extends EkycApiClientOptions {
  /** Default UI locale for flows started from this instance. */
  locale?: Locale;
  /** Default theme overrides for flows started from this instance. */
  theme?: Partial<EkycTheme>;
}

export class IappEkyc {
  /** Low-level API client (exposed for advanced integrations/proxies). */
  readonly api: EkycApiClient;
  /** Thin face-endpoint wrappers. */
  readonly face: FaceApi;

  private readonly defaultLocale?: Locale;
  private readonly defaultTheme?: Partial<EkycTheme>;

  constructor(options: IappEkycOptions) {
    this.api = new EkycApiClient(options);
    this.face = new FaceApi(this.api);
    this.defaultLocale = options.locale;
    this.defaultTheme = options.theme;
  }

  /** Run the interactive document auto-capture flow. */
  captureDocument(options: DocumentCaptureStartOptions): Promise<DocumentResult> {
    return new DocumentCapture(this.api).start({
      locale: this.defaultLocale,
      theme: this.defaultTheme,
      ...options,
    });
  }

  /** Run the interactive active-liveness flow. */
  startActiveLiveness(options: ActiveLivenessStartOptions): Promise<ActiveLivenessResult> {
    return new ActiveLivenessFlow(this.api).start({
      locale: this.defaultLocale,
      theme: this.defaultTheme,
      ...options,
    });
  }

  /**
   * Auto-capture a frontal selfie from the camera (no liveness challenges).
   * Resolves with the cropped selfie JPEG Blob — feed it straight to
   * {@link verifyFaces} or {@link checkPassiveLiveness}.
   */
  captureFace(options: FaceCaptureStartOptions): Promise<Blob> {
    return new FaceCapture().captureFace({
      locale: this.defaultLocale,
      theme: this.defaultTheme,
      ...options,
    });
  }

  /** Submit an already-captured document image (no UI). */
  submitDocument(documentType: DocumentType, image: Blob): Promise<DocumentResult> {
    return this.api.submitDocument(documentType, image);
  }

  /** Compare two face images. */
  verifyFaces(file1: Blob, file2: Blob): Promise<FaceVerificationResult> {
    return this.api.verifyFaces(file1, file2);
  }

  /** Run passive liveness on a single selfie image. */
  checkPassiveLiveness(file: Blob): Promise<PassiveLivenessResult> {
    return this.api.checkPassiveLiveness(file);
  }
}
