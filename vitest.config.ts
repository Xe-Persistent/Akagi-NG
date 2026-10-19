import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The main process imports `electron` directly; under Node it needs the
 * stand-in, which also records what would have been broadcast.
 */
const mainAlias = { electron: fromRoot('./packages/main/test/electron-stub.ts') };

export default defineConfig({
  test: {
    /**
     * `electron-log` requires the `electron` package, whose entry point
     * downloads the ~100 MB binary when its postinstall left no `path.txt`
     * behind — which is what a CI runner can end up with. Tests never launch
     * Electron, so pointing the lookup at a path that need not exist keeps the
     * require local and network-free.
     */
    env: { ELECTRON_OVERRIDE_DIST_PATH: fromRoot('./packages/main/test') },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: fromRoot('./coverage'),
      include: ['packages/main/src/**/*.{ts,cts}', 'packages/frontend/src/**/*.{ts,tsx}'],
      // `preload.cts` runs inside Electron's contextBridge and cannot be loaded
      // under Node; the coverage parser cannot even read it.
      exclude: ['**/*.d.ts', '**/test/**', 'packages/main/src/preload.cts'],
    },
    projects: [
      {
        resolve: { alias: mainAlias },
        test: {
          name: 'main',
          environment: 'node',
          // Replaying a recorded game is slower than the rest, so those tests
          // live in their own project and run from `npm run test:integration`.
          include: ['packages/main/test/unit/**/*.test.ts'],
          setupFiles: [fromRoot('./packages/main/test/setup.ts')],
        },
      },
      {
        resolve: {
          alias: {
            '@': fromRoot('./packages/frontend/src'),
            // The toast wrapper is a thin shell over react-toastify; the stub
            // records the calls so it can be checked without a DOM.
            'react-toastify': fromRoot('./packages/frontend/test/react-toastify-stub.ts'),
          },
        },
        test: {
          name: 'frontend',
          environment: 'node',
          include: ['packages/frontend/test/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: mainAlias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['packages/main/test/integration/**/*.test.ts'],
          setupFiles: [fromRoot('./packages/main/test/setup.ts')],
        },
      },
    ],
  },
});
