import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// The v1 keep-page check (CC-V1AUDIT D7) on `next start` of a production build, not `pnpm dev`: the
// metadata a crawler reads is the build's, and the dev server adds console noise of its own. Build
// first, with the CI placeholders (apps/web/.env.ci) in the environment:
//   cd apps/web && set -a && . ./.env.ci && set +a && pnpm build
//   pnpm exec playwright test -c tests/e2e/v1-keep.config.ts
// V1_INVENTORY names another inventory file to read (default docs/ops/v1-inventory.json).
const PORT = 3200;

export default defineConfig({
  testDir: '.',
  testMatch: 'v1-keep.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
