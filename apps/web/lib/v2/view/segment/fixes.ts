/**
 * The fixes block at the foot of a segment: the section's fixes among the audit's free three, each
 * with its packet, and the rest as Pro rows. The free three are the audit's, not the section's
 * (FREE_FIXES over `fixesAsOf`), so the sections' open counts add up to the overview's.
 */
import type {
  Check,
  Fix,
  FixSection,
  FixtureDataset,
  RecommendationClass,
} from '@crawlmouse/types/v2';
import { fixesAsOf } from '../../fixtures';
import { listOf } from '../../format';
import { numberWord, plural } from '../../words';
import { FREE_FIXES } from '../result';

/** The four recommendation classes as a reader sees them (the CC-23 brief's wording). */
export const RECOMMENDATION_LABELS: Record<RecommendationClass, string> = {
  confirmed_defect: 'confirmed defect',
  documented_requirement: 'documented platform requirement',
  best_practice: 'supported best practice',
  experimental: 'experimental hypothesis',
};

export interface RecommendationView {
  cls: RecommendationClass;
  label: string;
}

export interface OpenFixView {
  id: string;
  number: number;
  title: string;
  /** The estimated points, as a number with its sign ("+24"); the screen sets it in the data face. */
  points: string;
  unit: string;
  effort: string | null;
  recommendation: RecommendationView;
  /** What the packet says about the problem. */
  paragraph: string[];
  /** The steps, what to keep, and the check we run afterwards, as the packet block shows them. */
  packet: string;
  handoff: string;
  /** The whole packet as plain text, for "Copy as a prompt". */
  prompt: string;
}

export interface ProFixView {
  key: string;
  title: string;
  scope: string | null;
  points: string;
  /** Null for a row that groups several fixes. */
  recommendation: RecommendationView | null;
  count: number;
}

export interface SectionFixesView {
  /** "1 open · 7 on Pro", or "nothing to fix". */
  summary: string;
  open: OpenFixView[];
  pro: ProFixView[];
  proCount: number;
  /** The audit's free fixes that live in other sections, in rank order. */
  openElsewhere: { title: string; section: FixSection }[];
}

/** What each section's fixes are called in a grouped row ("5 more structure fixes"). */
const SECTION_NOUN: Record<FixSection, string> = {
  crawler_access: 'crawler access',
  without_js: 'JavaScript',
  structure: 'structure',
  content: 'content',
};

/** How many Pro fixes are named; beyond this, all but the first two are grouped into one row. */
const NAMED_PRO = 3;

/** A packet's first context line names the site and audit (the page's crumb already does). */
const SITE_LINE = /^Site: /;

const recommendation = (f: Fix): RecommendationView => ({
  cls: f.recommendation_class,
  label: RECOMMENDATION_LABELS[f.recommendation_class],
});

function effortText(f: Fix): string | null {
  const e = f.effort;
  if (!e) return null;
  return e.kind === 'minutes'
    ? `about ${e.minutes} ${plural(e.minutes, 'minute', 'minutes')}`
    : `${numberWord(e.templates)} ${plural(e.templates, 'template', 'templates')}, ${numberWord(e.deploys)} ${plural(e.deploys, 'deploy', 'deploys')}`;
}

/** "+1 Technical SEO; AI effect estimated after fixes 1 and 2", from the fix's own numbers. */
function proPoints(f: Fix, all: readonly Fix[]): string {
  const parts: string[] = [];
  if (f.effect.ai_readability) parts.push(`+${f.effect.ai_readability} AI readability`);
  if (f.effect.technical_seo) parts.push(`+${f.effect.technical_seo} Technical SEO`);
  const head = parts.join(', ') || 'no estimated effect';
  const waits = f.effect.ai_readability_pending_on
    .map((fp) => all.find((x) => x.fingerprint === fp)?.number)
    .filter((n): n is number => n !== undefined);
  return f.effect.ai_readability === null && waits.length
    ? `${head}; AI effect estimated after ${plural(waits.length, 'fix', 'fixes')} ${listOf(waits.map(String))}`
    : head;
}

function openFix(f: Fix): OpenFixView {
  const ai = f.effect.ai_readability;
  const [points, unit] = ai
    ? [`+${ai}`, 'AI readability, estimated']
    : [`+${f.effect.technical_seo}`, 'Technical SEO, estimated'];
  const p = f.packet;
  const paragraph = p ? p.context.filter((l) => !SITE_LINE.test(l)) : [];
  const verify = p
    ? [
        'Verify (we run this after you mark done):',
        `  ${p.verify.command}`,
        `  → expect ${p.verify.expect}`,
      ]
    : [];
  const block = p
    ? [...p.change, ...(p.keep.length ? ['', ...p.keep] : []), '', ...verify].join('\n')
    : '';
  const prompt = p
    ? [
        f.title,
        '',
        ...p.context,
        '',
        'Change:',
        ...p.change,
        ...(p.keep.length ? ['', 'Keep:', ...p.keep] : []),
        '',
        ...verify,
      ].join('\n')
    : f.title;
  const check = p?.verify.ua ? 'request' : 'check';
  return {
    id: f.id,
    number: f.number,
    title: f.title,
    points,
    unit,
    effort: effortText(f),
    recommendation: recommendation(f),
    paragraph,
    packet: block,
    handoff: `Handing this to your coding tool or your developer? The packet contains the steps above and the ${check} we’ll run afterwards to confirm it worked.`,
    prompt,
  };
}

export function sectionFixes(
  d: FixtureDataset,
  check: Check,
  section: FixSection,
): SectionFixesView {
  const all = fixesAsOf(d, check);
  const free = all.slice(0, FREE_FIXES);
  const here = all.filter((f) => f.section === section);
  const open = here.filter((f) => free.includes(f));
  const pro = here.filter((f) => !free.includes(f));
  const row = (f: Fix): ProFixView => ({
    key: f.id,
    title: f.title,
    scope: f.detail,
    points: proPoints(f, d.fixes),
    recommendation: recommendation(f),
    count: 1,
  });
  const named = pro.length <= NAMED_PRO ? pro : pro.slice(0, NAMED_PRO - 1);
  const rest = pro.slice(named.length);
  const rows = named.map(row);
  if (rest.length) {
    const seo = rest.reduce((n, f) => n + f.effect.technical_seo, 0);
    rows.push({
      key: 'rest',
      title: `${rest.length} more ${SECTION_NOUN[section]} fixes`,
      scope: listOf(rest.map((f) => f.title.replace(/^./u, (c) => c.toLowerCase()))),
      points: `+${seo} Technical SEO together`,
      recommendation: null,
      count: rest.length,
    });
  }
  return {
    summary: here.length
      ? [`${open.length} open`, pro.length ? `${pro.length} on Pro` : null]
          .filter(Boolean)
          .join(' · ')
      : 'nothing to fix',
    open: open.map(openFix),
    pro: rows,
    proCount: pro.length,
    openElsewhere: free
      .filter((f) => f.section !== section)
      .map((f) => ({ title: f.title, section: f.section })),
  };
}
