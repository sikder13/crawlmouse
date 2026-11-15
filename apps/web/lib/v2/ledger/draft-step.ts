/**
 * The check's build step's one ledger act (CC-41 D4): it computes the check's draft from what only
 * the build has (the crawl batches, robots.txt as read) and stores it for the writer. Only while a
 * usable RESEARCH_SITE_KEY is set: with no key the writer writes nothing, so nothing is stored for it.
 * Anything that throws here is queued to Sentry as `ledger-write-failed` (stage `draft`) and the step
 * goes on, unchanged: the draft never fails or alters the check.
 */
import { CRAWLER_REGISTRY_V2, robotsText, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { CrawlBatchResult } from '@crawlmouse/types/v2';
import { ledgerDraft, type LedgerDraft } from './draft';
import { queueLedgerFailure } from './report';
import { siteKeySecretOk } from './site-key';

export interface LedgerDraftSink {
  put(checkId: string, draft: LedgerDraft): Promise<void>;
}

export async function storeLedgerDraft(
  sink: LedgerDraftSink | undefined,
  env: Readonly<Record<string, string | undefined>>,
  input: {
    checkId: string;
    built: Pick<BuiltCheck, 'check'>;
    crawl: readonly CrawlBatchResult[];
    homepage: string;
  },
): Promise<'stored' | 'no_sink' | 'no_key' | 'failed'> {
  if (sink === undefined) return 'no_sink';
  if (!siteKeySecretOk(env.RESEARCH_SITE_KEY)) return 'no_key';
  try {
    const draft = ledgerDraft({
      check: input.built.check,
      crawl: input.crawl,
      robotsTxt: robotsText(input.crawl, input.homepage),
      registry: CRAWLER_REGISTRY_V2,
    });
    await sink.put(input.checkId, draft);
    return 'stored';
  } catch {
    queueLedgerFailure('draft', input.checkId);
    return 'failed';
  }
}
