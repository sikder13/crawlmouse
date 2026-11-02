import { defineConfig } from './pw';

/**
 * Visual harness for the v2 design system: screenshots, layout, accessibility and motion checks
 * over the dev-only preview pages. See README.md in this folder.
 *
 * It runs `next dev` by default. With VISUAL_SERVER=start it runs `next start` on the production
 * build instead (built beforehand), with V2_PREVIEW_ON_NEXT_START=1, the one way a production build
 * serves the previews (_preview/guard.ts); the performance budgets and production.spec.ts run so.
 */
const PORT = Number(process.env.VISUAL_PORT ?? 3130);
const CI = Boolean(process.env.CI);
const START = process.env.VISUAL_SERVER === 'start';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  // The performance budget runs on its own (VISUAL_PERF=1, one worker): beside other specs it
  // would measure their load, not the page's.
  // production.spec.ts needs the production build, so it runs only with VISUAL_SERVER=start.
  testIgnore: [
    // The budgets are set for the production build: they run only on next start.
    ...(process.env.VISUAL_PERF && START ? [] : [/perf\.spec\.ts$/]),
    ...(START ? [] : [/production\.spec\.ts$/]),
  ],
  // Compiles each preview route once before the tests (warm-routes.ts).
  globalSetup: './warm-routes.ts',
  timeout: 120_000,
  retries: 0,
  workers: 2,
  fullyParallel: true,
  forbidOnly: CI,
  outputDir: '../../apps/web/test-results/visual',
  reporter: CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: '../../apps/web/playwright-report/visual' }],
      ]
    : 'list',
  // One file per screenshot, named by the test: tests/visual/__snapshots__/<name>.png
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
  // CI never writes a baseline, so a missing one fails the run. Locally a missing one is written.
  updateSnapshots: CI ? 'none' : 'missing',
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      stylePath: './screenshot.css',
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: START
      ? `pnpm --filter @crawlmouse/web exec next start -p ${PORT}`
      : `pnpm --filter @crawlmouse/web exec next dev -p ${PORT}`,
    env: START ? { V2_PREVIEW_ON_NEXT_START: '1' } : {},
    cwd: '../..',
    url: `http://localhost:${PORT}/v2-preview`,
    reuseExistingServer: !CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
