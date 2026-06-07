/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Sentry is optional — alias to a local stub until the real SDK is
      // installed. Tests use the same alias via the `test` block below.
      '@sentry/react': path.resolve(__dirname, './src/test/sentry.mock.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    alias: {
      // Mock optional @sentry/react during tests
      '@sentry/react': path.resolve(__dirname, './src/test/sentry.mock.ts'),
    },
  },
});
