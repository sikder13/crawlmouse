import { defineConfig } from './pw';

/**
 * The launch walk (CC-38 D4): one spec per journey, on the production build (`next start`) against the
 * stand-in (harness/). Run by ./run.sh, which builds, starts both servers and stops them; it is not in
 * CI (docs/specs/v2/38-launch-qa.md). The JSON results are what `golive:check --go-no-go` reads.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /\d-[a-z-]+\.spec\.ts$/,
  // The journeys share one database and run in order: a later one may read what an earlier made.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: '../../apps/web/test-results/e2e',
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: {
    baseURL: process.env.WALK_BASE ?? 'http://localhost:3238',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
});
