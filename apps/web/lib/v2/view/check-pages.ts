/**
 * The three `/check` pages as data (CC-29 D8): the copy of `lib/v2/copy/check-pages.ts`, with the
 * sentences that state what the example audit measured built from the bad-site fixture's first audit,
 * the one the home replays. The crawler names in a sentence come from that check's crawler rows, and
 * what each OpenAI crawler does from the engine's crawler list (`AI_BOT_REGISTRY`), so neither is
 * typed here.
 */
import { AI_BOT_REGISTRY } from '@crawlmouse/engine';
import { GATES } from '../../entitlement-v2';
import {
  CHECK_COPY,
  CHECK_DATA_COPY,
  FUNNEL,
  checkPath,
  type CheckQuestion,
  type Paragraph,
} from '../copy/check-pages';
import { findCheck, fixture } from '../fixtures';
import { listOf } from '../format';
import { stateAt } from '../progress';
import { CHECKS, recording } from '../recordings';
import { capitalise, count } from '../words';
import { homeView } from './home';
import { mapDrawing } from './map';

export type CheckPageBlock =
  | ({ kind: 'paragraph' } & Paragraph)
  | {
      kind: 'table';
      label: string;
      columns: [string, string, string];
      rows: { key: string; cells: [string, string, string] }[];
      sources: readonly string[];
    };

export interface CheckPageView {
  question: CheckQuestion;
  canonical: string;
  h1: string;
  sub: string;
  heroNote: string;
  heading: string;
  blocks: CheckPageBlock[];
  closing: string;
  formLabel: string;
}

/** OpenAI's three crawlers, in the order the gptbot page discusses them. */
const OPENAI = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User'] as const;

const paragraph = (p: Paragraph): CheckPageBlock => ({ kind: 'paragraph', ...p });

function exampleCheck() {
  const d = fixture('bad-site');
  return { d, check: findCheck(d, CHECKS.badFirstAudit) };
}

function gptbotBlocks(): CheckPageBlock[] {
  const { check } = exampleCheck();
  const [p1, ...rest] = CHECK_COPY.gptbot.paragraphs;
  const t = CHECK_DATA_COPY.openAiTable;
  const rows = OPENAI.map((ua) => {
    const crawler = check.crawlers.find((c) => c.ua === ua);
    const bot = AI_BOT_REGISTRY.find((b) => b.token === ua);
    if (!crawler || !bot) throw new Error(`The check pages need ${ua} in the check and the list`);
    return {
      key: ua,
      cells: [ua, bot.note, crawler.scored ? t.counted : t.notCounted] as [string, string, string],
    };
  });
  const scored = check.crawlers.filter((c) => c.scored).map((c) => c.ua);
  return [
    paragraph(p1!),
    {
      kind: 'table',
      label: t.label,
      columns: [t.crawler, t.does, t.grade],
      rows,
      sources: CHECK_DATA_COPY.openAiSources,
    },
    paragraph({
      text: CHECK_DATA_COPY.scored(listOf(scored)),
      sources: CHECK_DATA_COPY.scoredSources,
    }),
    ...rest.map(paragraph),
  ];
}

function javascriptBlocks(): CheckPageBlock[] {
  const { d, check } = exampleCheck();
  const ai = check.crawlers.filter((c) => c.group !== 'search_engine').map((c) => c.ua);
  const { withoutJs: w } = homeView(d, CHECKS.badFirstAudit, {
    map: mapDrawing('bad-site'),
    end: stateAt(recording('bad-site').events, Infinity),
  });
  const [p1, p2, p3] = CHECK_COPY.javascript.paragraphs;
  return [
    paragraph({ text: CHECK_DATA_COPY.noJs(listOf(ai)), sources: CHECK_DATA_COPY.noJsSources }),
    paragraph(p1!),
    paragraph(p2!),
    paragraph({
      text: CHECK_DATA_COPY.example({
        path: w.path,
        browser: count(w.browserWords),
        bot: w.bot,
        botWords: count(w.botWords),
        share: w.share,
        pages: capitalise(count(w.templatePages)),
        noun: w.templateNoun,
      }),
      sources: CHECK_DATA_COPY.exampleSources,
    }),
    paragraph(p3!),
  ];
}

const BLOCKS: Record<CheckQuestion, () => CheckPageBlock[]> = {
  gptbot: gptbotBlocks,
  javascript: javascriptBlocks,
  'robots-ai': () => CHECK_COPY['robots-ai'].paragraphs.map(paragraph),
};

export function checkPageView(question: CheckQuestion): CheckPageView {
  const copy = CHECK_COPY[question];
  return {
    question,
    canonical: checkPath(question),
    h1: copy.h1,
    sub: copy.sub,
    heroNote: FUNNEL.heroNote(count(GATES.free.pagesPerCheck)),
    heading: copy.heading,
    blocks: BLOCKS[question](),
    closing: FUNNEL.closing,
    formLabel: FUNNEL.formLabel,
  };
}
