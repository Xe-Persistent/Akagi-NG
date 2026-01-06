import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(__dirname, 'frontend'),
    emptyOutDir: true,
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
    host: '0.0.0.0',
    port: 24701,
    allowedHosts: true,
  },
});
