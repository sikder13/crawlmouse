/**
 * The links of the v2 marketing header and footer, in one place. An `href` is a page the live site
 * serves today, under apps/web/app. An entry with `planned: true` has no page yet: it renders as
 * plain text, not as a link, until its page ships and the entry gets an `href`.
 * An entry with a `gate` is a page served only while that flag is on: the footer renders it as a link
 * then and as plain text otherwise (SiteFooter).
 * __tests__/v2/footer.test.tsx checks each `href` here against apps/web/app, and each footer `href`
 * against app/sitemap.ts, a gated one with its flag on (Log in, at /login, is deliberately not in the
 * sitemap).
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

/** A flag that serves a page the footer links to. */
export type FooterGate = 'checksPublic';

/** Which of the footer's gates are open. */
export type FooterGates = Readonly<Record<FooterGate, boolean>>;

/** Every gate shut: what a client page shows, which cannot read the server's flags. */
export const CLOSED_FOOTER_GATES: FooterGates = Object.freeze({ checksPublic: false });

/** A page served only while its flag is on: a link then, plain text otherwise. */
export type GatedLink = LiveLink & { gate: FooterGate };

/** The Status link, which carries the live status shape. */
export type StatusLink = LiveLink & { showsStatus: true };

/** A page on another site: opened apart from ours, and never checked against our routes. */
export interface ExternalLink {
  label: string;
  href: `https://${string}`;
  external: true;
}

/** A footer control that is a button, not a link. */
export interface FooterControl {
  label: string;
  control: 'cookie-settings';
}

export type FooterItem = SiteLink | StatusLink | GatedLink | FooterControl;

export interface FooterColumn {
  title: string;
  items: FooterItem[];
}

export const isGroup = (e: NavEntry): e is NavGroup => 'items' in e;

// Declared in lib, so the support link's builder (lib/v2/support/mailto.ts) reads the same constant.
export { SUPPORT_EMAIL } from '../../lib/v2/copy/support';

/** The footer's own words. */
export const FOOTER_COPY = {
  /** It names capabilities: lib/v2/copy/footer-line.ts (SEO R2-N2). */
  line: 'Crawlmouse fetches your site as each AI crawler and tells you when that changes.',
  company: 'Nahl Technologies Inc. · Indianapolis',
} as const;

// Shared by the header and the footer, so the two cannot point the same label at different pages.
const BLOG: LiveLink = { label: 'Blog', href: '/blog' };
const RESEARCH: LiveLink = { label: 'Research', href: '/blog/research' };
const SCREAMING_FROG: LiveLink = {
  label: 'Screaming Frog alternatives',
  href: '/blog/screaming-frog-alternative',
  note: 'The post with the most Search Console impressions (CC-42A brief, decision 7).',
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
      SCREAMING_FROG,
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
      { label: 'Is GPTBot blocked?', href: '/check/gptbot', gate: 'checksPublic' },
      { label: 'JavaScript-only content?', href: '/check/javascript', gate: 'checksPublic' },
      { label: 'robots.txt for AI', href: '/check/robots-ai', gate: 'checksPublic' },
    ],
  },
  {
    title: 'Company and legal',
    items: [
      { label: 'About', planned: true },
      { label: 'Contact', planned: true },
      {
        label: 'Help',
        href: '/help',
        gate: 'checksPublic',
        note: 'The help centre (CC-33 D4) answers 404 while V2_CHECKS_PUBLIC is off: a link while it is on, text while it is off.',
      },
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

/** Crawlmouse on other sites, in the footer's brand block. */
export const FOOTER_SOCIAL: ExternalLink[] = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/profile.php?id=61596663805615',
    external: true,
  },
];
