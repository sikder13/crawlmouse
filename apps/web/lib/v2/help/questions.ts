/**
 * The help centre's addresses and questions (CC-33 D4), apart from the articles' text so the social
 * cards can name each page without loading what the articles are built from.
 */
export const HELP_QUESTIONS = {
  'what-an-audit-measures': 'What does a Crawlmouse audit measure?',
  'how-grades-are-calculated': 'How are the grades calculated?',
  'crawler-shown-as-blocked': 'Your audit says a crawler is blocked, but we never blocked it. Why?',
  'fix-still-open': 'I marked a fix done and it is still open.',
  'audit-expired': 'Where is my audit? The link says it expired.',
  'sign-in-email': 'I didn’t get the sign-in email.',
  trials: 'Does the trial need a card? What happens when it ends?',
  'cancel-and-refunds': 'How do I cancel or get a refund?',
  'other-tools-scores': 'Why does your score differ from Lighthouse, Semrush or Ahrefs?',
  'how-we-crawl': 'How does Crawlmouse crawl my site, and how do I allow or block it?',
  plans: 'What is in Free, Pro and Agency?',
  'delete-account': 'How do I delete my account and data?',
} as const;

export type HelpSlug = keyof typeof HELP_QUESTIONS;

/** The articles' slugs, in the index's order. */
export const HELP_SLUGS = Object.keys(HELP_QUESTIONS) as HelpSlug[];

export const isHelpSlug = (s: string): s is HelpSlug => Object.hasOwn(HELP_QUESTIONS, s);

export const helpPath = (slug: HelpSlug) => `/help/${slug}`;
