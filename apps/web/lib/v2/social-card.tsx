/**
 * The social card of a v2 public page that has no card of its own (CC-29 review r2, SEO R2-N6): the
 * page's title on the v2 tokens, laid out as the v2 report's card is (a line of text at the top, the
 * words, a ruled foot). Each page names its card in its `openGraph.images` (`socialCardPath`), which
 * Next prefers to the root's file card (`app/opengraph-image.tsx`, v1's "internal linking" card):
 * a segment's file card applies only where that segment's own metadata names no image.
 *
 * Served at `/og/<key>` (app/og/[card]/route.ts): not under a rewrite target (`/v2-*` answers 404 by
 * its own address) and not under v1's `/pricing` or `/developers`, whose output stays v1's while
 * their flags are off. A card answers 404 while its page's flag is off, and for any key not in
 * `SOCIAL_CARDS`; nothing from the request is drawn.
 */
import { ImageResponse } from 'next/og';
import { checksPublicEnabled } from '../auth/flags';
import { billingV2Enabled } from '../billing/flags';
import { AGENCIES_COPY } from './copy/agencies';
import { CHECK_COPY, CHECK_QUESTIONS } from './copy/check-pages';
import { DEVELOPERS_COPY } from './copy/developers';
import { PRICING_COPY } from './copy/pricing';

export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

/**
 * A served card's `CDN-Cache-Control`, so Vercel's CDN keeps it for a day rather than rendering it per
 * request. Next's ImageResponse sets the browser's `Cache-Control` itself and copies this header beside
 * it (`next/dist/server/og/image-response.js`). The 404s below set no `CDN-Cache-Control`. A card
 * fetched while its page's flag was on can be served from the CDN for up to a day after the flag goes
 * off.
 */
export const SOCIAL_CARD_CDN_CACHE = 'public, max-age=86400';

/**
 * The v2 light tokens the card draws with, as plain values: satori reads no CSS. `social-card.test.tsx`
 * holds each to its declaration in styles/v2/tokens.css.
 */
export const CARD_TOKENS = {
  '--v2-bg': '#f7f8fa',
  '--v2-line': '#e2e6eb',
  '--v2-fg': '#13161b',
  '--v2-mut': '#5b6472',
} as const;

export interface SocialCard {
  /** The page's address, shown in the card's foot. */
  path: string;
  /** The page's title, as its metadata gives it. */
  title: string;
  /** Whether the page is served: the flag its route answers 404 behind. */
  served: () => boolean;
}

export const SOCIAL_CARDS: Readonly<Record<string, SocialCard>> = {
  pricing: { path: '/pricing', title: PRICING_COPY.pageTitle, served: () => billingV2Enabled() },
  developers: {
    path: '/developers',
    title: DEVELOPERS_COPY.title,
    served: () => billingV2Enabled(),
  },
  agencies: { path: '/agencies', title: AGENCIES_COPY.title, served: () => billingV2Enabled() },
  ...Object.fromEntries(
    CHECK_QUESTIONS.map((q) => [
      `check-${q}`,
      { path: `/check/${q}`, title: CHECK_COPY[q].title, served: () => checksPublicEnabled() },
    ]),
  ),
};

/** The address of a page's card. */
export function socialCardPath(key: string): string {
  if (!Object.hasOwn(SOCIAL_CARDS, key)) throw new Error(`no social card ${key}`);
  return `/og/${key}`;
}

function Card({ card }: { card: SocialCard }) {
  const t = CARD_TOKENS;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: t['--v2-bg'],
        display: 'flex',
        flexDirection: 'column',
        padding: 64,
        fontFamily: 'sans-serif',
        color: t['--v2-fg'],
      }}
    >
      <div style={{ display: 'flex', fontSize: 40, fontWeight: 600, letterSpacing: -0.8 }}>
        Crawlmouse
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 56,
          fontSize: 72,
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: -1.5,
        }}
      >
        {card.title}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 'auto',
          paddingTop: 28,
          borderTop: `1px solid ${t['--v2-line']}`,
          fontSize: 28,
          color: t['--v2-mut'],
        }}
      >
        {`crawlmouse.com${card.path}`}
      </div>
    </div>
  );
}

/** The card for `key`, or a 404 when there is no such card or its page is not served. */
export function socialCardResponse(key: string): Response {
  if (!Object.hasOwn(SOCIAL_CARDS, key)) return new Response(null, { status: 404 });
  const card = SOCIAL_CARDS[key]!;
  if (!card.served()) return new Response(null, { status: 404 });
  return new ImageResponse(<Card card={card} />, {
    ...SOCIAL_CARD_SIZE,
    headers: { 'CDN-Cache-Control': SOCIAL_CARD_CDN_CACHE },
  });
}
