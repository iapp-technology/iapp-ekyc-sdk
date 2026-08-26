/**
 * @iapp-technology/ekyc-sdk — public entry point.
 * Side-effect free: importing this module performs no DOM/network work;
 * OpenCV.js and MediaPipe are loaded lazily on first use.
 */

// Facade
export { IappEkyc, type IappEkycOptions } from './iapp-ekyc';
export { SDK_NAME, SDK_VERSION, resolveSdkIdentity } from './version';

// Core API
export { EkycApiClient, type EkycApiClientOptions } from './core/api-client';
export {
  EkycError,
  BadRequestError,
  InvalidApiKeyError,
  InsufficientCreditError,
  FileTooLargeError,
  RateLimitedError,
  ServerError,
  NetworkError,
  TimeoutError,
  CancelledError,
  LivenessFailedError,
  CameraError,
  CameraPermissionDeniedError,
  CameraNotFoundError,
  InsecureContextError,
  errorFromResponse,
  type EkycErrorOptions,
} from './core/errors';
export type {
  ApiResult,
  DocumentResult,
  FaceVerificationResult,
  PassiveLivenessResult,
  ActiveLivenessResult,
  ActiveLivenessVerdict,
  ActiveLivenessSelfieEcho,
  ChallengeLogWire,
  SdkIntegration,
} from './core/types';

// Theming (docs/THEMING.md)
export {
  DEFAULT_THEME,
  THEME_CSS_VARS,
  applyTheme,
  readThemeToken,
  type EkycTheme,
} from './core/theme';

// i18n
export {
  createTranslator,
  MESSAGE_TABLES,
  SUPPORTED_LOCALES,
  type Locale,
  type MessageKey,
  type Translator,
} from './core/i18n/i18n';

// Camera
export { CameraController, type CameraOpenOptions } from './core/camera';

// Document capture
export {
  DocumentCapture,
  type CaptureState,
  type DocumentCaptureStartOptions,
} from './document-capture/document-capture';
export { DOCUMENT_SPECS, type DocumentSpec, type DocumentType } from './document-capture/document-types';

// Active liveness
export {
  ActiveLivenessFlow,
  type ActiveLivenessStartOptions,
  type LivenessStateInfo,
} from './active-liveness/active-liveness';
export {
  ChallengeMachine,
  DEFAULT_CHALLENGE_MACHINE_CONFIG,
  CHALLENGE_WIRE_TYPE,
  type ChallengeMachineConfig,
  type ChallengeType,
  type CompletedChallenge,
  type FaceObservation,
  type FailReason,
  type MachinePhase,
  type MachineSnapshot,
  type SdkIdentity,
} from './active-liveness/challenge-machine';
export {
  BestFrameSelector,
  DEFAULT_BEST_FRAME_CONFIG,
  laplacianVarianceRgba,
  type BestFrameSelectorConfig,
} from './active-liveness/best-frame-selector';
export {
  DEFAULT_FACE_SELECTION_CONFIG,
  eulerFromMatrix,
  faceBoundingBox,
  mapObservation,
  selectFaces,
  type EulerAngles,
  type FaceBox,
  type FaceLandmarkerResultLike,
  type FaceSelection,
  type FaceSelectionConfig,
  type MapObservationOptions,
} from './active-liveness/face-metrics';
export {
  loadFaceLandmarker,
  type FaceLandmarkerLike,
  type LoadFaceLandmarkerOptions,
} from './active-liveness/mediapipe-loader';
export {
  FaceCapture,
  type FaceCaptureState,
  type FaceCaptureStartOptions,
} from './active-liveness/face-capture';

// Face APIs
export { FaceApi } from './face-api/index';

// Vision primitives (pure — usable headless / in tests)
export {
  orderCorners,
  interiorAngles,
  aspectRatio,
  aspectAccepted,
  anglesOk,
  quadShapeAccepted,
  quadArea,
  centroid,
  maxCornerDistance,
  ASPECT_ID1,
  ASPECT_PASSPORT,
  ASPECT_TOLERANCE,
  type Point,
  type Quad,
} from './vision/geometry';
export { StabilityTracker, type StabilityTrackerOptions } from './vision/stability-tracker';
export {
  detectQuad,
  computeGuideRect,
  DEFAULT_DETECTION_PARAMS,
  type DetectionParams,
  type GuideRect,
  type QuadDetectionResult,
  type RejectReason,
} from './vision/quad-detector';
export { laplacianVariance, quadBoundingBox, type BoundsRect } from './vision/blur-score';
export {
  warpQuad,
  warpToJpegBlob,
  matToJpegBlob,
  JPEG_QUALITY,
  MAX_UPLOAD_BYTES,
} from './vision/perspective';

// OpenCV loader (lazy, shared promise)
export {
  loadOpenCv,
  type CV,
  type CvMat,
  type ImageDataLike,
  type LoadOpenCvOptions,
} from './core/opencv-loader';
