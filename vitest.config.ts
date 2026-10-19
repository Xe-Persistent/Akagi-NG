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
