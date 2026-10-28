import { defineConfig } from './pw';

/**
 * Visual harness for the v2 design system: screenshots, layout, accessibility and motion checks
 * over the dev-only preview pages. See README.md in this folder.
 *
 * The preview pages 404 when NODE_ENV is production, so the harness runs `next dev`.
 */
const PORT = Number(process.env.VISUAL_PORT ?? 3130);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
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
    command: `pnpm --filter @crawlmouse/web exec next dev -p ${PORT}`,
    cwd: '../..',
    url: `http://localhost:${PORT}/v2-preview`,
    reuseExistingServer: !CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
