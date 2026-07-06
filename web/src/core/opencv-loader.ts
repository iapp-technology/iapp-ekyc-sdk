/**
 * Lazy OpenCV.js loader with a single shared ready-promise.
 *
 * Resolution order (see vite.config.ts bundling policy):
 * 1. Bare dynamic `import('@techstark/opencv-js')` — works in ESM builds
 *    (consumer bundler code-splits it) and in Node (tests). The import is
 *    marked external so it never lands in the SDK core chunk.
 * 2. An existing `globalThis.cv` (e.g. the integrator loaded opencv.js via
 *    a <script> tag — the usual path for the UMD bundle).
 * 3. Browser-only fallback: inject a <script> tag pointing at the pinned
 *    jsDelivr build (override with `scriptUrl`).
 *
 * OpenCV.js runtime init is asynchronous in all cases: the module object
 * may be a thenable, may expose `onRuntimeInitialized`, or may already be
 * ready — `awaitRuntime` handles every variant.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface CvMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32S: Int32Array;
  data32F: Float32Array;
  data64F: Float64Array;
  delete(): void;
  roi(rect: CvRect): CvMat;
  clone(): CvMat;
  isDeleted?(): boolean;
}

export interface CvMatVector {
  size(): number;
  get(index: number): CvMat;
  delete(): void;
}

export interface CvSize {
  width: number;
  height: number;
}

export interface CvRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimal structural typing for the OpenCV.js surface the SDK uses. */
export interface CV {
  Mat: new (...args: any[]) => CvMat;
  MatVector: new () => CvMatVector;
  Size: new (width: number, height: number) => CvSize;
  Rect: new (x: number, y: number, width: number, height: number) => CvRect;
  matFromImageData(imageData: ImageDataLike): CvMat;
  matFromArray(rows: number, cols: number, type: number, array: ArrayLike<number>): CvMat;
  cvtColor(src: CvMat, dst: CvMat, code: number): void;
  resize(src: CvMat, dst: CvMat, dsize: CvSize, fx: number, fy: number, interpolation: number): void;
  GaussianBlur(src: CvMat, dst: CvMat, ksize: CvSize, sigmaX: number): void;
  Canny(src: CvMat, dst: CvMat, threshold1: number, threshold2: number): void;
  dilate(src: CvMat, dst: CvMat, kernel: CvMat): void;
  morphologyEx(src: CvMat, dst: CvMat, op: number, kernel: CvMat): void;
  getStructuringElement(shape: number, ksize: CvSize): CvMat;
  findContours(src: CvMat, contours: CvMatVector, hierarchy: CvMat, mode: number, method: number): void;
  contourArea(contour: CvMat): number;
  arcLength(curve: CvMat, closed: boolean): number;
  approxPolyDP(curve: CvMat, approxCurve: CvMat, epsilon: number, closed: boolean): void;
  isContourConvex(contour: CvMat): boolean;
  Laplacian(src: CvMat, dst: CvMat, ddepth: number): void;
  meanStdDev(src: CvMat, mean: CvMat, stddev: CvMat): void;
  absdiff(src1: CvMat, src2: CvMat, dst: CvMat): void;
  convexHull(points: CvMat, hull: CvMat, clockwise: boolean, returnPoints: boolean): void;
  getPerspectiveTransform(src: CvMat, dst: CvMat): CvMat;
  warpPerspective(src: CvMat, dst: CvMat, M: CvMat, dsize: CvSize): void;
  COLOR_RGBA2GRAY: number;
  COLOR_RGBA2RGB: number;
  INTER_AREA: number;
  INTER_LINEAR: number;
  MORPH_RECT: number;
  MORPH_CLOSE: number;
  RETR_EXTERNAL: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
  CHAIN_APPROX_NONE: number;
  CV_8UC1: number;
  CV_8UC4: number;
  CV_32FC2: number;
  CV_64F: number;
}

/** Pinned CDN build used only by the UMD runtime fallback. */
const DEFAULT_OPENCV_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.min.js';

let sharedPromise: Promise<CV> | null = null;

export interface LoadOpenCvOptions {
  /** Self-hosted opencv.js URL for the script-tag fallback (CSP/privacy). */
  scriptUrl?: string;
}

/** Load OpenCV.js once; every caller shares the same promise. */
export function loadOpenCv(options: LoadOpenCvOptions = {}): Promise<CV> {
  if (!sharedPromise) {
    sharedPromise = doLoad(options).catch((e) => {
      sharedPromise = null; // allow a later retry (e.g. after a network blip)
      throw e;
    });
  }
  return sharedPromise;
}

async function doLoad(options: LoadOpenCvOptions): Promise<CV> {
  // 0. Node (incl. vitest/SSR): require() the CJS build natively.
  //    `import()` MUST be avoided here — Node's/vite-node's dynamic-import
  //    interop awaits thenable CJS exports, and the legacy emscripten
  //    `Module.then` (see awaitRuntime) then unwraps itself forever,
  //    pinning the CPU. Native require() returns the raw exports object
  //    synchronously, which awaitRuntime settles safely.
  try {
    const proc = (globalThis as any).process;
    const nodeModule = proc?.getBuiltinModule?.('module');
    if (nodeModule?.createRequire) {
      const req = nodeModule.createRequire(`${proc.cwd()}/__iapp_ekyc_loader__.js`);
      const mod = req('@techstark/opencv-js');
      const ready = await awaitRuntime(mod?.default ?? mod);
      if (ready) return ready;
    }
  } catch {
    // Not Node, or the package is not installed — fall through.
  }

  // 1. Bare import (ESM bundlers).
  try {
    const mod: any = await import('@techstark/opencv-js');
    const ready = await awaitRuntime(mod?.default ?? mod);
    if (ready) return ready;
  } catch {
    // No bundler resolution available (plain-browser UMD usage) — fall through.
  }

  // 2. Pre-existing global (integrator's own <script src="opencv.js">).
  const existing = (globalThis as any).cv;
  if (existing) {
    const ready = await awaitRuntime(existing?.default ?? existing);
    if (ready) return ready;
  }

  // 3. Script-tag injection (browser only).
  if (typeof document !== 'undefined') {
    await injectScript(options.scriptUrl ?? DEFAULT_OPENCV_SCRIPT_URL);
    const injected = (globalThis as any).cv;
    const ready = await awaitRuntime(injected?.default ?? injected);
    if (ready) return ready;
  }

  throw new Error(
    'Unable to load OpenCV.js. Install @techstark/opencv-js (bundler build), ' +
      'or load opencv.js via a <script> tag before using the UMD bundle.',
  );
}

/**
 * Normalize the many opencv.js init styles into one awaited CV object.
 *
 * CAUTION: legacy emscripten builds (incl. @techstark/opencv-js 4.12)
 * define `Module.then(cb)` where cb receives the Module ITSELF — which is
 * again thenable. A plain `await module` therefore unwraps recursively
 * forever, pinning the CPU in an endless microtask loop and starving all
 * timers. We must never hand the thenable to the promise machinery:
 * results are boxed in `{ m }` before being resolved.
 */
/**
 * The initialized module must NOT keep its legacy `then` property:
 * anything that resolves a Promise with it (our async loader, user code
 * doing `await loadOpenCv()`) would recurse forever. Emscripten itself
 * recommends deleting it once the runtime is up.
 */
function stripLegacyThen(mod: any): any {
  try {
    if (mod && typeof mod.then === 'function') delete mod.then;
  } catch {
    /* non-configurable — nothing we can do */
  }
  return mod;
}

async function awaitRuntime(candidate: any): Promise<CV | null> {
  if (!candidate) return null;
  if (candidate.Mat) return stripLegacyThen(candidate) as CV;

  const boxed = await new Promise<{ m: any }>((resolve) => {
    let settled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const finish = (m: any) => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      if (deadline) clearTimeout(deadline);
      resolve({ m: m ?? candidate }); // box: never resolve with a thenable
    };

    if (typeof candidate.then === 'function') {
      // Legacy emscripten shim: calls back once the runtime has started.
      try {
        candidate.then((m: any) => finish(m));
      } catch {
        /* ignore — poll below still covers us */
      }
    } else {
      try {
        const previous = candidate.onRuntimeInitialized;
        candidate.onRuntimeInitialized = () => {
          if (typeof previous === 'function') previous();
          finish(candidate);
        };
      } catch {
        /* read-only property on some builds */
      }
      if (candidate.ready && typeof candidate.ready.then === 'function') {
        candidate.ready.then((m: any) => finish(m), () => finish(candidate));
      }
    }
    // Belt and braces: some builds are already initialized (calledRun).
    poll = setInterval(() => {
      if (candidate.Mat) finish(candidate);
    }, 50);
    deadline = setTimeout(() => finish(candidate), 60_000);
  });

  const mod = boxed.m;
  return mod && mod.Mat ? (stripLegacyThen(mod) as CV) : null;
}

function injectScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load OpenCV.js from ${url}`));
    document.head.appendChild(script);
  });
}

/** Test hook: clear the shared promise. */
export function resetOpenCvLoaderForTests(): void {
  sharedPromise = null;
}
