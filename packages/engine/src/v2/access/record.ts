/**
 * Access detection records: their fingerprint keys (ENGINE-GAP §5, ARCH-2 appendix B), and the
 * evidence a record carries, built from the cells behind it.
 */
import type { AccessCause, CrawlerRegistryEntry, RecommendationClass } from '@crawlmouse/types/v2';
import { fingerprintOf } from '../detectors/fingerprint.js';
import { byText, sorted } from '../detectors/scope.js';
import type { AccessDetection, AccessFixType, AccessIndeterminateReason, Cell } from './types.js';

/** The key prefix of each access fix type; the subject is the crawler's token in lower case. */
export const ACCESS_KEY_PREFIX = {
  edge_rule_blocks_crawler: 'edge',
  robots_txt_blocks_crawler: 'robots',
} as const satisfies Record<AccessFixType, string>;

/**
 * How strong the case for acting is, per fix type. A user-agent block that robots.txt contradicts is
 * a defect; a robots.txt block is the site's stated intent, a requirement of the platform the site
 * chose to state, never a defect on its own.
 */
export const RECOMMENDATION_CLASS = {
  edge_rule_blocks_crawler: 'confirmed_defect',
  robots_txt_blocks_crawler: 'documented_requirement',
} as const satisfies Record<AccessFixType, RecommendationClass>;

export const accessKey = (type: AccessFixType, token: string): string =>
  `${ACCESS_KEY_PREFIX[type]}:${token.toLowerCase()}`;

/** Response headers a record quotes, and how: the value, or only that the header was there. */
export const SIGNATURE_HEADERS: Readonly<Record<string, 'value' | 'present'>> = {
  'cf-mitigated': 'value',
  'x-vercel-mitigated': 'value',
  server: 'value',
  'cf-ray': 'present',
};

function signaturesOf(cells: readonly Cell[]): string[] {
  return sorted(
    cells.flatMap((c) =>
      c.headers.flatMap((h) => {
        const name = h.name.toLowerCase();
        const how = Object.hasOwn(SIGNATURE_HEADERS, name) ? SIGNATURE_HEADERS[name] : undefined;
        return how === undefined ? [] : [how === 'present' ? name : `${name}: ${h.value}`];
      }),
    ),
  );
}

export interface RecordSpec {
  state: AccessDetection['state'];
  reason?: AccessIndeterminateReason;
  measured: number | null;
  confidence: AccessDetection['confidence'];
  intent?: 'respected';
  /** The pages the problem holds on; only a detected record has any. */
  affected: readonly Cell[];
  /** The cells whose rows are the record's evidence. */
  evidence: readonly Cell[];
}

export function record(
  type: AccessFixType,
  entry: CrawlerRegistryEntry,
  v: RecordSpec,
): AccessDetection {
  const key = accessKey(type, entry.token);
  if ((v.state === 'indeterminate') !== (v.reason !== undefined))
    throw new Error(`access detectors: ${key} is ${v.state} with reason ${v.reason ?? 'none'}`);
  if (v.state !== 'detected' && v.affected.length > 0)
    throw new Error(`access detectors: ${key} is ${v.state} and names affected pages`);
  const intent = v.intent ?? null;
  return {
    type,
    fingerprint: fingerprintOf(key),
    key,
    crawler: entry.token,
    group: entry.group,
    scored: entry.scored,
    state: v.state,
    reason: v.reason ?? null,
    measured: v.measured,
    recommendation_class: RECOMMENDATION_CLASS[type],
    confidence: v.confidence,
    intent,
    opens_fix: v.state === 'detected' && intent === null,
    affected_urls: sorted(v.affected.map((c) => c.page_url)),
    evidence: {
      access_test_ids: sorted(v.evidence.flatMap((c) => (c.id === null ? [] : [c.id]))),
      pages: sorted(v.evidence.map((c) => c.page_url)),
      causes: sorted(
        v.evidence.flatMap((c) => (c.cause === null ? [] : [c.cause])),
      ) as AccessCause[],
      signatures: signaturesOf(v.evidence),
    },
  };
}

export const byKey = (a: AccessDetection, b: AccessDetection): number =>
  byText(a.type, b.type) || byText(a.key, b.key);
