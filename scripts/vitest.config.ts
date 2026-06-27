import { defineConfig } from 'vitest/config';

// The ops scripts are mostly I/O harnesses, but the backtest's pure diff helpers (backtest-diff.ts)
// are unit-tested here so the SPEC 01 §8 cutover gate has teeth under `pnpm test` (turbo runs this
// package's `test`). Only *.test.ts at the scripts root are collected — the harness entrypoints
// (which read .env.local + hit Supabase at import) are never imported by a test.
export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: 'node',
    globals: false,
    include: ['*.test.ts'],
  },
});
