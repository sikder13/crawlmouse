import { defineConfig, configDefaults } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Mirror the tsconfig `@/*` -> apps/web root mapping so component tests (which import
// app code that uses the `@/` alias) resolve under Vitest too. This is purely additive:
// existing unit tests use relative imports and are unaffected.
const webRoot = fileURLToPath(new URL('.', import.meta.url));

// Unit tests only — Playwright specs under tests/e2e/ run via `pnpm test:e2e`,
// not Vitest (Playwright's test() throws if collected by Vitest).
export default defineConfig({
  // Use the automatic JSX runtime (same as Next), so component tests can render TSX without
  // importing React explicitly. Matches how the app's own components are authored.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@/': `${webRoot}`,
    },
  },
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
