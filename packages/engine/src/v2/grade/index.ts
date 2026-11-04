/**
 * Both v2 grades for one check (CC-17), from the check's records and the other detectors' results:
 * Technical SEO (technical-seo.ts) and AI readability (access, readable, quotable, signals), with the
 * content checks' summary, page failures and fix records, and the two declarations that count.
 * `components` keeps the inputs each component was computed from, so a fix's effect can be computed
 * by recomputing them (effects.ts).
 */
import type {
  AiReadability,
  Check,
  ContentCheck,
  LinkEdge,
  PageResult,
  TechnicalSeo,
} from '@crawlmouse/types/v2';
import type { CrawlerAccess } from '../access/types.js';
import type { SignalResult } from '../access/declarations.js';
import { aggregateContent, type ContentDetection } from '../content/aggregate.js';
import type { ContentFeatures } from '../content/read.js';
import type { Detection } from '../detectors/types.js';
import { accessScore, type CrawlerTally } from './access.js';
import { aiReadability } from './ai-readability.js';
import { round } from './numbers.js';
import { contentSignals, schemaOrg } from './declarations.js';
import { quotableRate, quotableScore, type QuotableInput } from './quotable.js';
import { readableScore, type ReadablePage } from './readable.js';
import { signalsScore, type SignalStates } from './signals.js';
import { isGraded, technicalSeo, type Tally, type TechnicalSeoInput } from './technical-seo.js';
import { GRADE_VERSION } from './weights.js';

export interface GradeInput {
  pages: readonly PageResult[];
  edges: readonly LinkEdge[];
  homepage_url: string;
  /** What readPage read of each crawled HTML page, by URL; a page not here was not read. */
  content: ReadonlyMap<string, ContentFeatures>;
  /** The access detectors' matrix rows (CC-15). */
  crawlers: readonly Pick<CrawlerAccess, 'ua' | 'scored' | 'counts' | 'extent'>[];
  /** The structure detectors' records (CC-16). */
  structure: readonly Detection[];
  /** robots.txt as read: '' when the site has none, null when it could not be read. */
  robots_txt: string | null;
  title_and_meta: Tally | null;
  refusal: TechnicalSeoInput['refusal'];
}

/** The inputs each AI readability component is computed from. */
export interface AiInputs {
  crawlers: readonly CrawlerTally[];
  readable: readonly ReadablePage[];
  quotable: QuotableInput;
  signals: SignalStates;
}

export interface Grades {
  grade_version: string;
  technical_seo: TechnicalSeo;
  ai_readability: AiReadability;
  /** The Content section: null when Quotable has no score. */
  content: Check['content'];
  /** schema_org and content_signals, as Check.signals carries them. */
  signals: SignalResult[];
  /** Each graded page's failed checks; null when the page was not read for content. */
  content_failures: ReadonlyMap<string, ContentCheck[] | null>;
  content_detections: ContentDetection[];
  inputs: { seo: TechnicalSeoInput; ai: AiInputs };
}

export function aiFrom(inputs: AiInputs): AiReadability {
  return aiReadability({
    access: accessScore(inputs.crawlers),
    readable: readableScore(inputs.readable),
    quotable: quotableScore(inputs.quotable),
    signals: signalsScore(inputs.signals),
  });
}

export function gradeCheck(input: GradeInput): Grades {
  const graded = input.pages.filter(isGraded);
  const homepage = input.content.get(input.homepage_url);
  const seo: TechnicalSeoInput = {
    pages: input.pages,
    edges: input.edges,
    homepage_url: input.homepage_url,
    homepage_client_rendered: homepage?.client_rendered ?? false,
    detections: input.structure,
    title_and_meta: input.title_and_meta,
    refusal: input.refusal,
    added_links: [],
  };
  const content = aggregateContent(
    graded.map((p) => ({
      url: p.url,
      template_key: p.template_key,
      features: input.content.get(p.url) ?? null,
    })),
  );
  const declarations = [
    schemaOrg(
      graded.flatMap((p) => input.content.get(p.url) ?? []),
      graded.filter((p) => !input.content.has(p.url)).length,
    ),
    contentSignals(input.robots_txt),
  ];
  const ai: AiInputs = {
    crawlers: input.crawlers,
    readable: graded.map((p) => ({
      template_key: p.template_key,
      text_share: p.without_js?.text_share ?? null,
    })),
    quotable: content.quotable,
    signals: { schema_org: declarations[0]!.state, content_signals: declarations[1]!.state },
  };
  const ai_readability = aiFrom(ai);
  const rate = quotableRate(content.quotable);
  return {
    grade_version: GRADE_VERSION,
    technical_seo: technicalSeo(seo),
    ai_readability,
    content: rate === null ? null : { score: round(100 * rate), checks: content.by_template },
    signals: declarations,
    content_failures: content.content_failures,
    content_detections: content.detections,
    inputs: { seo, ai },
  };
}
