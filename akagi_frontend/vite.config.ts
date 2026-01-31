import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteCompression({
      verbose: true,
      disable: false,
      threshold: 10240,
      algorithm: 'gzip',
      ext: '.gz',
    }),
  ],
  base: './',
  build: {
    target: 'esnext',
    outDir: '../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split large libraries into separate chunks
          if (id.includes('node_modules')) {
            // React core libraries
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor';
            }
            // Router
            if (id.includes('react-router-dom')) {
              return 'router-vendor';
            }
            // i18n
            if (id.includes('i18next') || id.includes('react-i18next')) {
              return 'i18n-vendor';
            }
            // Toast notifications
            if (id.includes('react-toastify')) {
              return 'toast-vendor';
            }
            // UI components (Radix)
            if (id.includes('@radix-ui')) {
              return 'ui-vendor';
            }
            // Lucide icons
            if (id.includes('lucide-react')) {
              return 'icons-vendor';
            }
            // Remaining vendors
            return 'vendor';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __AKAGI_VERSION__: JSON.stringify(process.env.AKAGI_VERSION ?? 'dev'),
  },
  preview: {
    host: '127.0.0.1',
    port: 24701,
    allowedHosts: true,
  },
});
