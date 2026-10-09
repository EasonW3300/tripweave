import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite serves the React client and forwards API requests to the local agent server.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:4321' } },
  test: { environment: 'node' },
});
