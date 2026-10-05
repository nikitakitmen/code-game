import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@prod/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
      '@prod/content': fileURLToPath(new URL('../../packages/content/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'jsdom', globals: true },
});
