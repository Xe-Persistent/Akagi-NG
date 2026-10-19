import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  const pkgVersion = process.env.npm_package_version ?? '0.0.0';

  return {
    base: './',
    plugins: [react(), tailwindcss()],
    build: {
      target: 'esnext',
      outDir: path.resolve(__dirname, '../../dist/renderer'),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    define: {
      __AKAGI_VERSION__: JSON.stringify(isDev ? 'dev' : pkgVersion),
    },
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
    },
  };
});
