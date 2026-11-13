/**
 * The help pages as their screens read them (CC-33 D4): the index of the twelve questions and each
 * article, with the links resolved, the support link built by `supportMailto`, and the footer line's
 * "coming" label.
 */
import { AGENCIES_COPY } from '../copy/agencies';
import { supportMailto } from '../support/mailto';
import { footerComing } from '../view/agencies';
import { HELP_COPY } from './copy';
import { helpArticles, type HelpArticle, type HelpBlock } from './articles';
import { helpPath, type HelpSlug } from './questions';

export const HELP_INDEX_PATH = '/help';

export interface HelpSupport {
  lead: string;
  label: string;
  href: string;
}

export interface HelpIndexView {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  lead: string;
  entries: { href: string; question: string; description: string }[];
  support: HelpSupport;
  footerComing: string | null;
}

/** An article's block, with a link to another article resolved to its address and question. */
export type HelpBlockView =
  | Exclude<HelpBlock, { kind: 'see' }>
  | { kind: 'see'; label: string; href: string; question: string };

export interface HelpArticleView {
  title: string;
  description: string;
  canonical: string;
  index: { label: string; href: string };
  h1: string;
  blocks: HelpBlockView[];
  comingLabel: string;
  support: HelpSupport;
  footerComing: string | null;
}

const support = (path: string): HelpSupport => ({
  lead: HELP_COPY.more,
  label: HELP_COPY.write,
  href: supportMailto({ topic: 'general', path }),
});

export function helpIndexView(): HelpIndexView {
  return {
    title: HELP_COPY.title,
    description: HELP_COPY.description,
    canonical: HELP_INDEX_PATH,
    h1: HELP_COPY.h1,
    lead: HELP_COPY.lead,
    entries: helpArticles().map((a) => ({
      href: helpPath(a.slug),
      question: a.question,
      description: a.description,
    })),
    support: support(HELP_INDEX_PATH),
    footerComing: footerComing(),
  };
}

function blockView(block: HelpBlock, all: readonly HelpArticle[]): HelpBlockView {
  if (block.kind !== 'see') return block;
  const target = all.find((a) => a.slug === block.slug)!;
  return {
    kind: 'see',
    label: HELP_COPY.seeAlso,
    href: helpPath(block.slug),
    question: target.question,
  };
}

export function helpArticleView(slug: HelpSlug): HelpArticleView {
  const all = helpArticles();
  const article = all.find((a) => a.slug === slug)!;
  const path = helpPath(slug);
  return {
    title: article.question,
    description: article.description,
    canonical: path,
    index: { label: HELP_COPY.index, href: HELP_INDEX_PATH },
    h1: article.question,
    blocks: article.blocks.map((b) => blockView(b, all)),
    comingLabel: AGENCIES_COPY.coming,
    support: support(path),
    footerComing: footerComing(),
  };
}
