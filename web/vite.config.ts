// Vite library build for @iapp-technology/ekyc-sdk.
//
// Bundling policy (see also src/core/opencv-loader.ts and
// src/active-liveness/mediapipe-loader.ts):
// - @techstark/opencv-js and @mediapipe/tasks-vision are EXTERNAL and only
//   ever referenced through dynamic `import()`. In the ESM output the bare
//   dynamic imports are preserved, so a consumer bundler (Vite/webpack/...)
//   code-splits them into lazy chunks and the SDK core chunk stays small.
// - The UMD output cannot code-split (Rollup inlines dynamic imports), so
//   the externals are resolved AT RUNTIME instead: the loaders fall back to
//   `globalThis.cv` / a CDN <script>/`import(url)` when the bare import is
//   not available. Nothing heavy is baked into the UMD bundle.
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      tsconfigPath: './tsconfig.json',
      // tsconfig has noEmit for `npm run lint`; the plugin needs emit on.
      compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      name: 'IappEkyc',
      formats: ['es', 'umd'],
      fileName: (format) => (format === 'es' ? 'ekyc-sdk.js' : 'ekyc-sdk.umd.cjs'),
    },
    rollupOptions: {
      external: ['@techstark/opencv-js', '@mediapipe/tasks-vision'],
      output: {
        globals: {
          '@techstark/opencv-js': 'cv',
          '@mediapipe/tasks-vision': 'MediapipeTasksVision',
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
