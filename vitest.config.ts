import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The suite ran without a config until middleware.test.ts arrived. That test has
 * to import the real `middleware.ts`, which imports through the `@/` alias
 * tsconfig defines, and Vitest does not read tsconfig paths on its own.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
});
