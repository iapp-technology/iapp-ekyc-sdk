/**
 * Lazy MediaPipe FaceLandmarker loader with a single shared ready-promise.
 *
 * Resolution order (mirrors core/opencv-loader.ts — see vite.config.ts):
 * 1. Bare dynamic `import('@mediapipe/tasks-vision')` — ESM bundlers
 *    code-split it; kept external so it never lands in the core chunk.
 * 2. UMD/no-bundler fallback: native `import(url)` of the CDN ESM bundle
 *    (called through an indirection so Rollup leaves it untouched).
 *
 * WASM assets + the .task model default to public CDNs; self-host them by
 * passing `assetBaseUrl` / `modelUrl` (CSP / privacy, docs/SECURITY.md).
 */

const MEDIAPIPE_VERSION = '0.10.35';
const DEFAULT_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const DEFAULT_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Structural subset of the FaceLandmarker instance we use. */
export interface FaceLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): unknown;
  close(): void;
}

interface TasksVisionModuleLike {
  FilesetResolver: {
    forVisionTasks(basePath: string): Promise<unknown>;
  };
  FaceLandmarker: {
    createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<unknown>;
  };
}

export interface LoadFaceLandmarkerOptions {
  /**
   * Base URL for self-hosted MediaPipe assets. Expected layout:
   * `${assetBaseUrl}/wasm/*` and `${assetBaseUrl}/vision_bundle.mjs`.
   */
  assetBaseUrl?: string;
  /** Override the face_landmarker .task model URL. */
  modelUrl?: string;
  /**
   * Max faces to track. 2 lets the machine see a second person at all; the
   * price is that the detector re-scans every frame for that second face
   * and occasionally returns a phantom, which face-metrics.ts filters out.
   */
  numFaces?: number;
  /**
   * Pin the inference delegate. Left unset, the GPU is tried first and the
   * CPU is used if creating the GPU landmarker throws. Some devices instead
   * create a GPU landmarker successfully and then emit numerically garbage
   * landmarks — the flow detects that at runtime and reloads with 'CPU'.
   */
  delegate?: 'GPU' | 'CPU';
}

/** One shared instance per delegate: reloading on CPU must not hand back the broken GPU one. */
const sharedPromises = new Map<string, Promise<FaceLandmarkerLike>>();

/** Indirect dynamic import so bundlers do not rewrite/deny the URL import. */
const importByUrl: (url: string) => Promise<unknown> =
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('url', 'return import(url);') as (url: string) => Promise<unknown>;

async function loadTasksVisionModule(assetBaseUrl?: string): Promise<TasksVisionModuleLike> {
  try {
    // 1. Bundler / Node path (external, lazily code-split).
    const mod = (await import('@mediapipe/tasks-vision')) as unknown as TasksVisionModuleLike;
    if (mod?.FaceLandmarker && mod?.FilesetResolver) return mod;
  } catch {
    /* fall through to the URL import */
  }
  const bundleUrl = assetBaseUrl
    ? `${assetBaseUrl.replace(/\/+$/, '')}/vision_bundle.mjs`
    : DEFAULT_BUNDLE_URL;
  const mod = (await importByUrl(bundleUrl)) as TasksVisionModuleLike;
  if (!mod?.FaceLandmarker || !mod?.FilesetResolver) {
    throw new Error(`Failed to load @mediapipe/tasks-vision from ${bundleUrl}`);
  }
  return mod;
}

/**
 * Load (once) and configure a FaceLandmarker for VIDEO mode with
 * blendshapes + facial transformation matrices, per docs/ACTIVE_LIVENESS.md.
 * Tries the GPU delegate first, falls back to CPU.
 */
export function loadFaceLandmarker(
  options: LoadFaceLandmarkerOptions = {},
): Promise<FaceLandmarkerLike> {
  const key = options.delegate ?? 'auto';
  const existing = sharedPromises.get(key);
  if (existing) return existing;
  const promise = doLoad(options).catch((e) => {
    sharedPromises.delete(key); // allow retry after transient network failure
    throw e;
  });
  sharedPromises.set(key, promise);
  return promise;
}

/**
 * Support / verification hook: when a page sets
 * `window.__iappEkycSimulateBrokenGpu = true` BEFORE a flow starts, every
 * landmarker created on the GPU (or auto) path returns the garbage this
 * fault produces in the field — two landmark sets with ~1e12 coordinates,
 * matching the Galaxy S25 Ultra report of Aug 2026 — while the CPU delegate
 * stays real. This lets the unusable-output recovery be exercised end to
 * end on any machine (desktop Chrome with a fake camera, an Android
 * emulator, the hosted demo via the devtools console) without needing a
 * device that is actually faulty. Inert unless the flag is set.
 */
function withSimulatedGpuFault(
  instance: FaceLandmarkerLike,
  delegate: 'GPU' | 'CPU',
): FaceLandmarkerLike {
  // true / 'garbage' = 1e12 coordinates; 'throw' = detect throws;
  // 'empty' = zero faces forever. All three shapes seen on the same field
  // device on different days.
  const mode = (globalThis as { __iappEkycSimulateBrokenGpu?: boolean | string })
    .__iappEkycSimulateBrokenGpu;
  const active = mode === true || mode === 'garbage' || mode === 'throw' || mode === 'empty';
  if (!active || delegate === 'CPU') return instance;
  const junk = (offsetX: number) => {
    const S = 1e12;
    return [
      { x: -0.6 * S + offsetX, y: -0.28 * S, z: 0 },
      { x: 0.77 * S + offsetX, y: -0.28 * S, z: 0 },
      { x: 0.77 * S + offsetX, y: 0.51 * S, z: 0 },
      { x: -0.6 * S + offsetX, y: 0.51 * S, z: 0 },
    ];
  };
  return {
    detectForVideo(video: HTMLVideoElement, ts: number) {
      instance.detectForVideo(video, ts); // keep the real per-frame cost
      if (mode === 'throw') throw new Error('simulated GPU detect failure');
      if (mode === 'empty') {
        return { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] };
      }
      return {
        faceLandmarks: [junk(0), junk(2e11)],
        faceBlendshapes: [{ categories: [] }, { categories: [] }],
        facialTransformationMatrixes: [],
      };
    },
    close: () => instance.close(),
  };
}

async function doLoad(options: LoadFaceLandmarkerOptions): Promise<FaceLandmarkerLike> {
  const mod = await loadTasksVisionModule(options.assetBaseUrl);
  const wasmBase = options.assetBaseUrl
    ? `${options.assetBaseUrl.replace(/\/+$/, '')}/wasm`
    : DEFAULT_WASM_BASE;
  const fileset = await mod.FilesetResolver.forVisionTasks(wasmBase);

  const baseOptions = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: {
      modelAssetPath: options.modelUrl ?? DEFAULT_MODEL_URL,
      delegate,
    },
    runningMode: 'VIDEO',
    numFaces: options.numFaces ?? 2,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });

  if (options.delegate) {
    return withSimulatedGpuFault(
      (await mod.FaceLandmarker.createFromOptions(
        fileset,
        baseOptions(options.delegate),
      )) as FaceLandmarkerLike,
      options.delegate,
    );
  }
  try {
    return withSimulatedGpuFault(
      (await mod.FaceLandmarker.createFromOptions(
        fileset,
        baseOptions('GPU'),
      )) as FaceLandmarkerLike,
      'GPU',
    );
  } catch {
    return withSimulatedGpuFault(
      (await mod.FaceLandmarker.createFromOptions(
        fileset,
        baseOptions('CPU'),
      )) as FaceLandmarkerLike,
      'CPU',
    );
  }
}

/** Test hook: clear the shared promises. */
export function resetFaceLandmarkerLoaderForTests(): void {
  sharedPromises.clear();
}
