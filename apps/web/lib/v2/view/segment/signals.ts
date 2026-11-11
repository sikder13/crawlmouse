/**
 * Agent-readiness signals (Final-Seg-Signals) as data: the seven signals, what the check found for
 * each, what it is worth in the grade, and, when the audit named one, how a competitor compares.
 * What each signal is and who reads it is product copy (SIGNAL_COPY); what the check found is the
 * fixture's.
 */
import type { Check, RecommendationClass } from '@crawlmouse/types/v2';
import { SCREEN_SIGNALS, screenSignals, type ScreenSignal } from '../screen-signals';
import { findCheck } from '../../fixtures';
import { listOf, percent, testedAt } from '../../format';
import { isAi, isAllowed } from '../../sentences';
import { capitalise, numberWord, plural } from '../../words';
import type { DoorView } from '../result';
import { RECOMMENDATION_LABELS, type RecommendationView } from './fixes';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';
import type { ViewDataset } from '../dataset';

/**
 * The recommendation class of each signal. PROPOSED: the contract's SignalResult has no
 * `recommendation_class` (only Fix does), so the class is set here until it does.
 */
export const SIGNAL_CLASSES: Record<ScreenSignal, RecommendationClass> = {
  schema_org: 'best_practice',
  content_signals: 'best_practice',
  web_bot_auth: 'experimental',
  llms_txt: 'experimental',
  mcp_server_card: 'experimental',
  markdown_negotiation: 'experimental',
  agent_skills_index: 'experimental',
};

interface SignalCopy {
  name: string;
  /** How a sentence names it, where it counts towards the grade. */
  short: string;
  advice: { present: string; absent: string };
  lift: string;
  readers: string;
}

/** What each signal is and who reads it: the locked page's copy, with Web Bot Auth per FACTS I10. */
const SIGNAL_COPY: Record<ScreenSignal, SignalCopy> = {
  schema_org: {
    name: 'schema.org structured data',
    short: 'schema',
    advice: {
      present: 'Keep it.',
      absent: 'Add it: Product and Article types carry price, availability and author as facts.',
    },
    lift: 'Yes, well established',
    readers: 'Google, Bing, every answer engine',
  },
  content_signals: {
    name: 'Content Signals in robots.txt',
    short: 'Content Signals',
    advice: {
      present: 'Keep it. It says what you mean without blocking anyone.',
      absent: 'Optional. It says what you mean without blocking anyone.',
    },
    lift: 'No measured lift; it is a statement of policy',
    readers: 'Any crawler that chooses to honor it; none is obliged to',
  },
  web_bot_auth: {
    name: 'Signed-crawler verification at your edge (Web Bot Auth)',
    short: 'Web Bot Auth',
    advice: {
      present: 'Keep it.',
      absent: 'Worth knowing about: signed crawlers can pass without an IP list to maintain.',
    },
    lift: 'Not measured: we cannot test it from outside yet',
    readers:
      "Cloudflare, which checks the signature; crawlers that sign, OpenAI's among them. A signed request gets through without an IP list to maintain.",
  },
  llms_txt: {
    name: 'llms.txt',
    short: 'llms.txt',
    advice: {
      present: 'Keep it if you like; we have not seen it change anything.',
      absent: 'Skip for now. We re-check this every audit and will say if that changes.',
    },
    lift: 'No measured lift in our crawls',
    readers: 'Proposed for LLM agents; no major engine has confirmed reading it',
  },
  mcp_server_card: {
    name: 'MCP server card',
    short: 'the MCP server card',
    advice: {
      present: 'Keep it current.',
      absent:
        'Not for a store this size yet. Revisit when an agent platform you sell through asks for it.',
    },
    lift: 'Too new to measure',
    readers: 'Agents that act, not just read: price checks, stock, orders',
  },
  markdown_negotiation: {
    name: 'Markdown content negotiation',
    short: 'markdown negotiation',
    advice: {
      present: 'Keep it.',
      absent: 'Skip. Text in the HTML gives agents what they need.',
    },
    lift: 'Too new to measure',
    readers: 'Agents that prefer plain text over HTML',
  },
  agent_skills_index: {
    name: 'Agent skills index',
    short: 'the agent skills index',
    advice: { present: 'Keep it.', absent: 'Skip for now.' },
    lift: 'Too new to measure',
    readers: 'Agent frameworks discovering what a site can do',
  },
};

const UNTESTED_ADVICE = 'Nothing to do yet: we check it again on the next audit.';

export interface SignalRowView {
  signal: ScreenSignal;
  name: string;
  status: { state: DoorView['pill']['state']; label: string };
  advice: string;
  lift: string;
  readers: string;
  where: string;
  /** Whether it counts towards the grade, as the check records it; null when not recorded. */
  weight: string | null;
  recommendation: RecommendationView;
}

export interface CompetitorRowView {
  measure: string;
  own: string;
  theirs: string;
  /** The competitor's figure is held for Pro. */
  pro: boolean;
}

export interface SignalsView {
  frame: SegmentFrame;
  headline: { title: string; pill: DoorView['pill'] };
  body: string;
  tiles: { label: string; value: string; note: string | null }[];
  rows: SignalRowView[];
  coverage: { read: string };
  competitor: { host: string; rows: CompetitorRowView[]; verdict: string } | null;
  keep: { title: string; sub: string } | null;
}

const KINDS = SCREEN_SIGNALS;

function row(check: Check, signal: ScreenSignal): SignalRowView {
  const copy = SIGNAL_COPY[signal];
  const rec = check.signals.find((s) => s.signal === signal);
  const status: SignalRowView['status'] = !rec
    ? { state: 'neutral', label: 'not tested' }
    : rec.state === 'detected'
      ? { state: 'ok', label: 'present' }
      : rec.state === 'not_detected'
        ? { state: 'bad', label: 'absent' }
        : { state: 'unverified', label: 'not tested' };
  return {
    signal,
    name: copy.name,
    status,
    advice:
      rec?.state === 'detected'
        ? copy.advice.present
        : rec?.state === 'not_detected'
          ? copy.advice.absent
          : UNTESTED_ADVICE,
    lift: copy.lift,
    readers: copy.readers,
    where: rec ? rec.evidence : 'not checked in this audit',
    weight: !rec
      ? null
      : rec.counts_toward_grade
        ? 'Counts towards AI readability.'
        : 'Carries no weight in the grade.',
    recommendation: {
      cls: SIGNAL_CLASSES[signal],
      label: RECOMMENDATION_LABELS[SIGNAL_CLASSES[signal]],
    },
  };
}

/** "Two of them, schema and Content Signals, are worth five points each of the AI readability grade…" */
function weightSentence(check: Check): string {
  const counting = KINDS.filter((k) =>
    check.signals.some((s) => s.signal === k && s.counts_toward_grade),
  );
  const rest = KINDS.length - counting.length;
  const max = check.ai_readability?.components.signals.max ?? 0;
  if (!counting.length) {
    return 'None of them counts towards the AI readability grade yet, and none adds a fix.';
  }
  const names = listOf(counting.map((k) => SIGNAL_COPY[k].short));
  const share = max / counting.length;
  const each = Number.isInteger(share) ? numberWord(share) : share.toFixed(1);
  const worth =
    counting.length === 1 ? `is worth ${each} points of` : `are worth ${each} points each of`;
  return `${capitalise(numberWord(counting.length))} of them, ${names}, ${worth} the AI readability grade; the other ${numberWord(rest)} change nothing yet and add no fixes.`;
}

function competitorOf(check: Check, present: number): SignalsView['competitor'] {
  const c = check.competitors[0];
  if (!c) return null;
  const ai = check.crawlers.filter(isAi);
  const seo = check.technical_seo;
  const air = check.ai_readability;
  const own = {
    seo: seo?.score ?? null,
    read: check.without_js?.site_text_share ?? null,
  };
  const side = (mine: number | null, theirs: number) =>
    mine === null ? null : mine > theirs ? 'ahead' : mine < theirs ? 'behind' : 'level';
  const seoSide = side(own.seo, c.technical_seo.score);
  const readSide = side(own.read, c.text_share);
  const parts = [
    seoSide ? `${seoSide} on technical SEO` : null,
    readSide ? `${readSide} on what AI crawlers can read` : null,
  ].filter(Boolean);
  return {
    host: c.host,
    rows: [
      {
        measure: 'Crawlers that get in',
        own: `${ai.filter((x) => isAllowed(x.verdict)).length} of ${ai.length}`,
        theirs: `${c.crawlers_with_access} of ${c.crawlers_tested}`,
        pro: false,
      },
      {
        measure: 'Text without JavaScript',
        own: own.read === null ? 'not measured' : `${percent(own.read)}%`,
        theirs: `${percent(c.text_share)}%`,
        pro: false,
      },
      {
        measure: 'Technical SEO',
        own: seo?.grade ? `${seo.grade} · ${seo.score}` : 'not graded',
        theirs: `${c.technical_seo.grade} · ${c.technical_seo.score}`,
        pro: false,
      },
      {
        measure: 'AI readability',
        own: air && !air.withheld ? `${air.grade} · ${air.total}` : 'withheld',
        theirs: 'with Pro',
        pro: true,
      },
      {
        measure: 'Agent signals present',
        own: `${present} of ${KINDS.length}`,
        theirs: 'with Pro',
        pro: true,
      },
    ],
    verdict: parts.length ? `You are ${parts.join(' and ')}.` : '',
  };
}

export function signalsView(
  d: ViewDataset,
  checkId: string,
  options: SegmentOptions = {},
): SignalsView {
  const check = findCheck(d, checkId);
  const frame = segmentFrame(d, checkId, 'signals', options);
  const rows = KINDS.map((k) => row(check, k));
  const by = (state: string) => screenSignals(check).filter((s) => s.state === state).length;
  const present = by('detected');
  const absent = by('not_detected');
  const competitor = competitorOf(check, present);
  const max = check.ai_readability?.components.signals.max;
  return {
    frame,
    headline: {
      title: `${capitalise(numberWord(present))} of ${numberWord(KINDS.length)} agent signals ${plural(present, 'is', 'are')} present.`,
      pill: { state: 'neutral', label: `${present} of ${KINDS.length}` },
    },
    body: [
      'These are the files and headers that AI agents, not just crawlers, look for when they decide how to read a site. Most are new and some have no measured effect yet.',
      weightSentence(check),
      'It tells you what is there, what is not, and which of the missing ones we have seen make a difference.',
      check.tested_at ? `Checked ${testedAt(check.tested_at)}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
    tiles: [
      { label: 'Present', value: String(present), note: null },
      { label: 'Absent', value: String(absent), note: null },
      { label: 'Not tested', value: String(KINDS.length - present - absent), note: null },
      {
        label: 'Effect on the grade',
        value: max === undefined ? 'not graded' : `${max} of 100`,
        note: null,
      },
    ],
    rows,
    coverage: { read: `Tested ${present + absent} of ${KINDS.length} signals` },
    competitor,
    keep: frame.keptUntil
      ? {
          title: `Keep this audit: these ${numberWord(KINDS.length)} signals are re-checked monthly, and the note you get when something changes covers them too.`,
          sub: `One email creates a free account that re-checks monthly, with 14 days of Pro to start${competitor ? `, including the ${competitor.host} comparison` : ''}. Otherwise this page expires ${frame.keptUntil}.`,
        }
      : null,
  };
}
