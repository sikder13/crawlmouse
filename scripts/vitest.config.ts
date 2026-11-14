import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The ops scripts are mostly I/O harnesses, but the backtest's pure diff helpers (backtest-diff.ts)
// are unit-tested here so the SPEC 01 §8 cutover gate has teeth under `pnpm test` (turbo runs this
// package's `test`). The *.test.ts files at the scripts root, under research/ and under db/ are
// collected, as are those under ops/, golive/ and qa/ — the harness entrypoints (which read .env.local + hit Supabase at import) are never
// imported by a test.
export default defineConfig({
  // The app's billing modules import `server-only`, which Next resolves and Node cannot; the QA tests
  // import them (qa/server-only-stub.ts says why).
  resolve: {
    alias: { 'server-only': fileURLToPath(new URL('./qa/server-only-stub.ts', import.meta.url)) },
  },
  test: {
    passWithNoTests: true,
    environment: 'node',
    globals: false,
    include: [
      '*.test.ts',
      'research/**/*.test.ts',
      'db/**/*.test.ts',
      'ops/**/*.test.ts',
      'golive/**/*.test.ts',
      'qa/**/*.test.ts',
    ],
  },
});
