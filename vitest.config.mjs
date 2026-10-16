import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next preserves JSX for its own compiler; tests need executable JSX instead.
  oxc: { jsx: { runtime: 'automatic' } },
});
