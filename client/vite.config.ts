import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/apps': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/brand': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/favicon.ico': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
});
