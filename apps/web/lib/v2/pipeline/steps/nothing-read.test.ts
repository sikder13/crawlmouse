import { describe, expect, it } from 'vitest';
import { GRADE_VERSION } from '@crawlmouse/engine/v2/pipeline';
import type { CrawlBatchResult, Finding } from '@crawlmouse/types/v2';
import {
  CHECK,
  SITE,
  crawlBatch,
  crawlRow,
} from '../../../../../../packages/engine/fixtures/v2/build/rows';
import { recordedInput } from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { failureReasonOf, type CheckRequested } from '../../../../../../inngest/check-events';
import { putJson } from '../evidence';
import { memoryStore, queuedCheck } from '../test-support/fakes';
import { memoryEvidenceStore } from '../test-support/memory-evidence';
import { NO_DAILY_BUDGET, checkSteps, type StepDeps } from './index';
import { pathOf } from './stored';

const HOME = 'https://example.test/';
const EVENT: CheckRequested = {
  checkId: CHECK,
  siteId: SITE,
  accountId: null,
  host: 'example.test',
  homepageUrl: HOME,
  trigger: 'first_audit',
  pageCap: 25,
};

/** The build step over one stored crawl batch, on a check that has been claimed. */
async function buildOver(result: CrawlBatchResult) {
  const at = '2026-11-22T12:00:00.000Z';
  const { store } = memoryStore(
    { ...recordedInput().site, id: SITE },
    [queuedCheck(CHECK, SITE, at, GRADE_VERSION)],
    () => at,
  );
  await store.claim(CHECK, 'run-1', null as never);
  const evidence = memoryEvidenceStore();
  const path = `anon/${SITE}/${CHECK}/batch-1.json.gz`;
  await putJson(evidence, path, result);
  await store.upsertBatch({
    check_id: CHECK,
    batch: 1,
    kind: 'crawl',
    nonce: 'n',
    posted_at: at,
  } as never);
  await store.endBatch(CHECK, 1, {
    status: 'done',
    result_path: path,
    finished_at: at,
    summary: {},
  } as never);
  await putJson(evidence, pathOf(EVENT, 'seeds'), [
    { url: HOME, source: 'homepage', lastmod: null },
  ]);
  await putJson(evidence, pathOf(EVENT, 'render'), { pages: [] });
  const deps = {
    store,
    evidence,
    now: () => Date.parse(at),
    env: { VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) },
    render: { daily: NO_DAILY_BUDGET },
  } as unknown as StepDeps;
  const error = await checkSteps(deps)
    .build(EVENT, {} as never)
    .then(
      () => null,
      (e: unknown) => e,
    );
  return { error, built: evidence.objects.has(pathOf(EVENT, 'built')) };
}

const dead = (why: 'network' | 'server_error'): CrawlBatchResult => ({
  ...crawlBatch(1, [crawlRow({ url: HOME, outcome: 'not_requested' })]),
  findings: [{ kind: 'robots_unreachable', origin: 'https://example.test', why } as Finding],
});

describe('the build step, on a crawl that read no page', () => {
  it('fails site_unreachable for a host that did not answer, and stores no built check', async () => {
    const { error, built } = await buildOver(dead('network'));
    expect(failureReasonOf(error)).toBe('site_unreachable');
    expect(built).toBe(false);
  });

  it('fails nothing_read for a host that answered and gave us no page', async () => {
    const { error, built } = await buildOver(dead('server_error'));
    expect(failureReasonOf(error)).toBe('nothing_read');
    expect(built).toBe(false);
  });
});
