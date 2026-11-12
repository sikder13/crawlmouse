import { socialCardResponse } from '@/lib/v2/social-card';

export const runtime = 'nodejs';

/**
 * A v2 public page's social card (lib/v2/social-card.tsx, SEO R2-N6): the page's title on the v2
 * tokens; a 404 for a key that is not a card, and while the card's page is not served.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ card: string }> }) {
  return socialCardResponse((await params).card);
}
