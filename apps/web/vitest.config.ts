import { defineConfig, configDefaults } from 'vitest/config';

// Unit tests only — Playwright specs under tests/e2e/ run via `pnpm test:e2e`,
// not Vitest (Playwright's test() throws if collected by Vitest).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
