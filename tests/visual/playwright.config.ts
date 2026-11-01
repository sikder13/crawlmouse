import { totalmem } from 'node:os';
import { defineConfig } from './pw';

/**
 * Visual harness for the v2 design system: screenshots, layout, accessibility and motion checks
 * over the dev-only preview pages. See README.md in this folder.
 *
 * The preview pages 404 when NODE_ENV is production, so the harness runs `next dev`.
 */
/** The dev server's heap limit: three quarters of the machine's memory (see webServer.env). */
const HEAP_MB = Math.floor((totalmem() / 1024 / 1024) * 0.75);
const PORT = Number(process.env.VISUAL_PORT ?? 3130);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  // The performance budget runs on its own (VISUAL_PERF=1, one worker): beside other specs it
  // would measure their load, not the page's.
  testIgnore: process.env.VISUAL_PERF ? undefined : /perf\.spec\.ts$/,
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
    command: `pnpm --filter @crawlmouse/web exec next dev -p ${PORT}`,
    cwd: '../..',
    url: `http://localhost:${PORT}/v2-preview`,
    reuseExistingServer: !CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // `next dev` restarts itself once its used heap passes 80% of the heap limit, which it sets to
    // half the machine's memory when nothing else does ("approaching the used memory threshold").
    // In a CI shard the restart came mid-run once the segment previews were added, and a request
    // made during it and the cold recompile after it ran past a test's two minutes. Three quarters
    // of the memory moves that point past what one shard compiles; the browsers keep the rest.
    // Playwright merges this over the inherited environment.
    env: {
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${HEAP_MB}`.trim(),
    },
  },
});
