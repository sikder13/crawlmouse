import { defineConfig, devices } from './pw';
import { baseUrlOf } from './lib/target';

/**
 * The customer journeys (STEPS.md) against a deployed base URL: JOURNEY_BASE_URL, required. Nothing is
 * started locally. Steps that write run only where lib/target.ts allows. See README.md.
 */
const base = baseUrlOf(process.env).origin;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  // Stops a run against a protected deployment with its reason (lib/protection.ts).
  globalSetup: './global-setup.ts',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  outputDir: '../../apps/web/test-results/journeys',
  reporter: [
    ['list'],
    ['json', { outputFile: '../../apps/web/test-results/journeys/results.json' }],
  ],
  use: {
    baseURL: base,
    // A trace records request headers and URLs, so a run that holds a bypass cookie or sign-in links keeps none.
    trace:
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET || process.env.JOURNEY_ALLOW_WRITES
        ? 'off'
        : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'phone', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
