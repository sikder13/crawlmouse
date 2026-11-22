import { readFileSync } from 'node:fs';
import { test, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '../pw';
import { stepMeta } from './steps-md';
import { writeRefusal } from './target';

// Read, not imported: the spec runner loads this directory as ES modules, which need an import
// attribute for JSON that the TypeScript transform here does not emit.
const EXPECTED: Record<string, string[]> = JSON.parse(
  readFileSync(new URL('../expected-fail.json', import.meta.url), 'utf8'),
);

/** The ids that make a step fail today: expected-fail.json, the only list a test reads (STEPS.md). */
export function expectedFailOf(id: string): readonly string[] {
  return Object.hasOwn(EXPECTED, id) ? EXPECTED[id] : [];
}

export interface StepFixtures {
  page: Page;
  context: BrowserContext;
  request: APIRequestContext;
  baseURL: string | undefined;
}

/**
 * One STEPS.md step as a Playwright test, titled by its id. Its devices and whether it writes come from
 * STEPS.md, so a spec cannot declare them differently; an id STEPS.md does not list throws here.
 *
 * Expected-fail: an assertion that encodes a registered defect names its id in its message. When the
 * step fails with a message naming one of its listed ids, it is an expected failure. When it fails for
 * any other reason, or passes while ids are still listed, it fails red: a page that breaks some other
 * way is never hidden behind an old defect, and a fixed defect cannot stay listed.
 */
export function step(
  id: string,
  title: string,
  body: (fixtures: StepFixtures, info: TestInfo) => Promise<void>,
): void {
  const meta = stepMeta(id);
  // Playwright builds only the fixtures a test names in its first argument, so they are named here.
  test(`${id} ${title}`, async ({ page, context, request, baseURL }, info) => {
    info.annotations.push({ type: 'step', description: id });
    test.skip(
      !meta.devices.includes(info.project.name),
      `${id} is not run on ${info.project.name} (STEPS.md devices)`,
    );
    if (meta.writes) {
      const refused = writeRefusal(process.env);
      test.skip(refused !== null, `writes: ${refused}`);
    }
    const listed = expectedFailOf(id);
    try {
      await body({ page, context, request, baseURL }, info);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const named = listed.filter((f) => message.includes(f));
      if (named.length > 0) {
        info.annotations.push({ type: 'expected-fail', description: named.join(', ') });
        test.fail();
      }
      throw error;
    }
    if (listed.length > 0) {
      throw new Error(
        `${id} passed, but expected-fail.json still lists ${listed.join(', ')}: delete the fixed ids`,
      );
    }
  });
}
