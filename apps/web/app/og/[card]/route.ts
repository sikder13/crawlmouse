import { v2PublicPagesEnabled } from '@/lib/auth/flags';
import { socialCardResponse } from '@/lib/v2/social-card';

export const runtime = 'nodejs';

/**
 * A v2 public page's social card (lib/v2/social-card.tsx, SEO R2-N6): the page's title on the v2
 * tokens. A 404 while no CC-29 page is served, for a key that is not a card, and while the card's own
 * page is not served.
 *
 * The first line changes no status: with both flags off every card's own flag is off as well. What it
 * does is answer before the card table is read (route.test.tsx, "with both flags off"), in the
 * `if (!<flag>Enabled()) return 404` form that `isFlagGated` (__tests__/v1-inventory-source.ts) reads
 * to list this route as v2 rather than v1.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ card: string }> }) {
  if (!v2PublicPagesEnabled()) return new Response(null, { status: 404 });
  return socialCardResponse((await params).card);
}
