import {
  CrawlScreen,
  type CrawlScreenProps,
} from '../../../../components/v2/screens/crawl/CrawlScreen';
import { findCheck, fixesAsOf, fixture } from '../../../../lib/v2/fixtures';
import { scoredCrawlersMeasured } from '@crawlmouse/types/v2';
import { recording, recordingSpec, type RecordingName } from '../../../../lib/v2/recordings';
import { aiShortSummary, aiWithheldSummary, seoShortSummary } from '../../../../lib/v2/sentences';
import { mapDrawing } from '../../../../lib/v2/view/map';
import { FREE_FIXES } from '../../../../lib/v2/view/result';

export type CrawlSearchParams = Promise<{ at?: string; play?: string }>;

const RESULT_FOR: Record<RecordingName, string> = {
  'bad-site': '/v2-preview/screens/result',
  'clean-site': '/v2-preview/screens/result/clean',
  'clean-site-rerun': '/v2-preview/screens/result/clean',
  'challenged-site': '/v2-preview/screens/result/challenged',
};

/**
 * The crawl screen's props for a recording. With no `at` it replays from the start at the
 * recording's own timing; `at` (milliseconds, or "end") opens it paused at that moment, and `play`
 * plays on from there.
 */
export function crawlProps(
  name: RecordingName,
  { at, play }: { at?: string; play?: string } = {},
): CrawlScreenProps {
  const rec = recording(name);
  const spec = recordingSpec(name);
  const d = fixture(spec.fixture);
  const shape = findCheck(d, spec.shape_check_id ?? spec.check_id);
  const startAt = at === 'end' ? rec.until_ms : at ? Math.max(0, Number(at) || 0) : 0;
  const fixes = fixesAsOf(d, shape);
  const ai = shape.ai_readability;
  return {
    recording: { events: rec.events, until_ms: rec.until_ms },
    context: {
      domain: rec.host,
      crawlers: shape.crawlers
        .filter((c) => c.group !== 'search_engine')
        .map((c) => ({ ua: c.ua, scored: c.scored })),
    },
    startAt,
    autoplay: at === undefined || play !== undefined,
    initialMap: mapDrawing(name, startAt).positions,
    gradeSummaries: [
      shape.technical_seo
        ? seoShortSummary(shape, fixes, (f) => fixes.indexOf(f) < FREE_FIXES)
        : '',
      !ai
        ? ''
        : ai.withheld
          ? aiWithheldSummary(shape, scoredCrawlersMeasured(shape.crawlers))
          : aiShortSummary(shape),
    ],
    resultHref: RESULT_FOR[name],
  };
}

/** One crawl preview, from the page's search parameters. */
export async function CrawlPreview({
  name,
  searchParams,
}: {
  name: RecordingName;
  searchParams: CrawlSearchParams;
}) {
  return <CrawlScreen {...crawlProps(name, await searchParams)} />;
}
