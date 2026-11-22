import { test, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '../pw';
import { writeRefusal } from './target';
import { readFileSync } from 'node:fs';

// Read, not imported: the spec runner loads this directory as ES modules, which need an import
// attribute for JSON that the TypeScript transform here does not emit.
const EXPECTED: Record<string, string[]> = JSON.parse(
  readFileSync(new URL('../expected-fail.json', import.meta.url), 'utf8'),
);

/** The ids that make a step fail today: expected-fail.json, the only list a test reads (STEPS.md). */
export function expectedFailOf(id: string): readonly string[] {
  return EXPECTED[id] ?? [];
}

export interface StepFixtures {
  page: Page;
  context: BrowserContext;
  request: APIRequestContext;
  baseURL: string | undefined;
}

export interface StepOptions {
  /** The step changes data, or needs a check it starts itself (STEPS.md "Writes"). */
  writes: boolean;
  /** The projects (playwright.config.ts) this step runs on, as STEPS.md "Devices"; all when absent. */
  devices?: readonly ('desktop' | 'phone' | 'firefox')[];
}

/** One STEPS.md step as a Playwright test, titled by its id so a run lists the ids it covers. */
export function step(
  id: string,
  title: string,
  opts: StepOptions,
  body: (fixtures: StepFixtures, info: TestInfo) => Promise<void>,
): void {
  // Playwright builds only the fixtures a test names in its first argument, so they are named here.
  test(`${id} ${title}`, async ({ page, context, request, baseURL }, info) => {
    const args: StepFixtures = { page, context, request, baseURL };
    info.annotations.push({ type: 'step', description: id });
    if (opts.devices) {
      const project = info.project.name as 'desktop' | 'phone' | 'firefox';
      test.skip(
        !opts.devices.includes(project),
        `${id} is not run on ${project} (STEPS.md devices)`,
      );
    }
    if (opts.writes) {
      const refused = writeRefusal(process.env);
      test.skip(refused !== null, `writes: ${refused}`);
    }
    const xfail = expectedFailOf(id);
    if (xfail.length > 0) {
      info.annotations.push({ type: 'expected-fail', description: xfail.join(', ') });
      test.fail(true, `expected to fail until ${xfail.join(', ')} are fixed`);
    }
    await body(args, info);
  });
}
