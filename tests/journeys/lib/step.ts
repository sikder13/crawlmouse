import { readFileSync } from 'node:fs';
import { test, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '../pw';
import { originHeaders } from './protection';
import { stepMeta } from './steps-md';
import { databaseRefusal, writeRefusal } from './target';

// Read, not imported: the spec runner loads this directory as ES modules, which need an import
// attribute for JSON that the TypeScript transform here does not emit.
const EXPECTED: Record<string, string[]> = JSON.parse(
  readFileSync(new URL('../expected-fail.json', import.meta.url), 'utf8'),
);

/** The ids that make a step fail today: expected-fail.json, the only list a test reads (STEPS.md). */
export function expectedFailOf(id: string): readonly string[] {
  return Object.hasOwn(EXPECTED, id) ? EXPECTED[id] : [];
}

/** A failure that must stay red even when its message names listed ids (a stale list, for example). */
export class RedFailure extends Error {}

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
 * Expected-fail: an assertion that encodes a registered defect names its id in its message, and names it
 * only when the page shows that defect's own symptom (lib/pages.ts). When the step fails with a message
 * naming one of its listed ids, it is an expected failure. It fails red when it fails for any other
 * reason, throws a RedFailure, records a soft assertion, or passes while ids are still listed.
 */
export function step(
  id: string,
  title: string,
  body: (fixtures: StepFixtures, info: TestInfo) => Promise<void>,
): void {
  const meta = stepMeta(id);
  // Playwright builds only the fixtures a test names in its first argument, so they are named here.
  test(`${id} ${title}`, async ({ page, context, playwright, baseURL }, info) => {
    info.annotations.push({ type: 'step', description: id });
    test.skip(
      !meta.devices.includes(info.project.name),
      `${id} is not run on ${info.project.name} (STEPS.md devices)`,
    );
    // The fixture's base URL, not the environment's: a spec's own baseURL is the one it would write to.
    const refused = meta.writes
      ? writeRefusal({ ...process.env, JOURNEY_BASE_URL: baseURL })
      : null;
    test.skip(refused !== null, `writes: ${refused}`);
    // The bypass secret, when set, goes only to the deployment's own origin (lib/protection.ts).
    const origin = new URL(baseURL!).origin;
    const headers = originHeaders(process.env);
    if (Object.keys(headers).length > 0) {
      await context.route(
        (url) => url.origin === origin,
        (route) => route.continue({ headers: { ...route.request().headers(), ...headers } }),
      );
    }
    const request = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers });
    try {
      if (meta.writes) {
        const db = databaseRefusal((await request.get('/', { maxRedirects: 0 })).headers());
        test.skip(db !== null, `writes: ${db}`);
      }
      const listed = expectedFailOf(id);
      try {
        await body({ page, context, request, baseURL }, info);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const named = listed.filter((f) => message.includes(f));
        // A soft assertion recorded before the throw is a cause of its own, so the failure is not expected.
        if (named.length > 0 && !(error instanceof RedFailure) && info.errors.length === 0) {
          info.annotations.push({ type: 'expected-fail', description: named.join(', ') });
          test.fail();
        }
        throw error;
      }
      if (info.errors.length > 0)
        throw new RedFailure(`${id} recorded a soft assertion: journey steps use hard ones`);
      if (listed.length > 0) {
        throw new RedFailure(
          `${id} passed, but expected-fail.json still lists ${listed.join(', ')}: delete the fixed ids`,
        );
      }
    } finally {
      await request.dispose();
    }
  });
}
