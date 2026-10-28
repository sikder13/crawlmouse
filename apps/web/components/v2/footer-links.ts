/**
 * Every link in the v2 marketing header and footer, in one place. An `href` is a page the live
 * site serves today (apps/web/app, listed in app/sitemap.ts). An entry with `planned: true` has no
 * page yet: it renders as plain text, never as a link, until its page ships and the entry gets an
 * `href`. __tests__/v2/footer.test.tsx checks each `href` against the app and the sitemap.
 */

/** A page the live site serves. */
export interface LiveLink {
  label: string;
  href: string;
  planned?: never;
  /** Why the target is what it is, when that is not obvious. */
  note?: string;
}

/** A page that does not exist yet: shown as text. */
export interface PlannedLink {
  label: string;
  planned: true;
  href?: never;
  note?: string;
}

export type SiteLink = LiveLink | PlannedLink;

/** A header item that opens a list of links. */
export interface NavGroup {
  label: string;
  items: SiteLink[];
}

export type NavEntry = SiteLink | NavGroup;

/** The Status link, which carries the live status shape. */
export type StatusLink = LiveLink & { showsStatus: true };

/** A footer control that is a button, not a link. */
export interface FooterControl {
  label: string;
  control: 'cookie-settings';
}

export type FooterItem = SiteLink | StatusLink | FooterControl;

export interface FooterColumn {
  title: string;
  items: FooterItem[];
}

export const isGroup = (e: NavEntry): e is NavGroup => 'items' in e;

export const SUPPORT_EMAIL = 'support@crawlmouse.com';

/** The footer's own words. */
export const FOOTER_COPY = {
  line: 'Crawlmouse fetches your site as each AI crawler and tells you when that changes.',
  company: 'Nahl Technologies Inc. · Indianapolis',
} as const;

// Shared by the header and the footer, so the two cannot point the same label at different pages.
const BLOG: LiveLink = { label: 'Blog', href: '/blog' };
const RESEARCH: LiveLink = {
  label: 'Research',
  href: '/blog',
  note: 'The blog has no tags yet (app/blog/page.tsx reads no search params), so this is the whole blog rather than /blog?tag=research.',
};
const GUIDES: LiveLink = { label: 'Guides', href: '/guides' };
const DOCS: PlannedLink = { label: 'Docs', planned: true };
const DEVELOPERS: LiveLink = { label: 'Developers', href: '/developers' };
const PRICING: LiveLink = { label: 'Pricing', href: '/pricing' };
const FOR_AGENCIES: PlannedLink = { label: 'For agencies', planned: true };

/** The marketing header: four top-level items, Developers under Learn. */
export const MARKETING_NAV: NavEntry[] = [
  { label: 'Product', href: '/' },
  FOR_AGENCIES,
  { label: 'Learn', items: [BLOG, RESEARCH, GUIDES, DOCS, DEVELOPERS] },
  PRICING,
];

export const LOG_IN: LiveLink = { label: 'Log in', href: '/login' };

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: 'Product',
    items: [
      { label: 'Free audit', href: '/' },
      PRICING,
      FOR_AGENCIES,
      DEVELOPERS,
      { label: 'Changelog', planned: true },
      { label: 'Status', href: '/status', showsStatus: true },
    ],
  },
  {
    title: 'Learn',
    items: [
      BLOG,
      RESEARCH,
      GUIDES,
      DOCS,
      { label: 'How the grade works', planned: true },
      { label: 'Our crawler', href: '/bot' },
    ],
  },
  {
    title: 'Free checks',
    items: [
      {
        label: 'Is GPTBot blocked?',
        href: '/ai-readiness-checker',
        note: 'The checker reads robots.txt and builds the per-crawler access matrix, GPTBot included.',
      },
      {
        label: 'JavaScript-only content?',
        href: '/blog/can-ai-crawlers-see-javascript',
        note: 'An article on how to check, until a dedicated check exists.',
      },
      {
        label: 'robots.txt for AI',
        href: '/blog/block-ai-crawlers-robots-txt',
        note: 'An article: the robots.txt guide for GPTBot, ClaudeBot and the rest.',
      },
    ],
  },
  {
    title: 'Company and legal',
    items: [
      { label: 'About', planned: true },
      { label: 'Contact', planned: true },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Acceptable use', href: '/aup' },
      {
        label: 'Refunds',
        planned: true,
        note: 'The refund terms are one sentence in /terms §8, which has no anchor to link to.',
      },
      { label: 'DPA', planned: true },
      { label: 'Subprocessors', href: '/subprocessors' },
      // The live footer's consent control (GDPR Art. 7(3): withdrawing consent as easy as giving it).
      { label: 'Cookie settings', control: 'cookie-settings' },
    ],
  },
];
