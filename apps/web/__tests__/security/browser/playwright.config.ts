import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// The security checks on `next start` of a production build (docs/specs/v2/sec-baseline.md): the
// headers by route class, the cross-site refusal, and the report-only CSP against the third parties.
// CI's security-browser job runs them on the build job's output, with apps/web/.env.ci and the build's
// placeholders in the environment. Files are *.pw.ts so vitest does not collect them.
const PORT = 3100;

export default defineConfig({
  testDir: '.',
  testMatch: '*.pw.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
