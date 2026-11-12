import { v2PublicPagesEnabled } from '@/lib/auth/flags';
import { socialCardResponse } from '@/lib/v2/social-card';

export const runtime = 'nodejs';

/**
 * A v2 public page's social card (lib/v2/social-card.tsx, SEO R2-N6): the page's title on the v2
 * tokens. A 404 while no CC-29 page is served, for a key that is not a card, and while the card's own
 * page is not served.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ card: string }> }) {
  if (!v2PublicPagesEnabled()) return new Response(null, { status: 404 });
  return socialCardResponse((await params).card);
}
