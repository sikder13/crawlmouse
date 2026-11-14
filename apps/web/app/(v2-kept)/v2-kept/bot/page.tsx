import { notFound } from 'next/navigation';
import BotPage from '@/app/bot/page';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { metadata } from '@/app/bot/page';

/** `/bot` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404 with it off. */
export default function KeptBotPage() {
  if (!checksPublicEnabled()) return notFound();
  return keptPage(BotPage());
}
