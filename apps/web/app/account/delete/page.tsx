import '../../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DeletionScreen } from '@/components/v2/screens/deletion/DeletionScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readDeletionLink } from '@/lib/v2/account/deletion-link';
import { serviceRpc } from '@/lib/v2/account/deletion-ports';
import { LINK_FLOWS } from '@/lib/v2/account/link-cookie';
import { LINK_STATES } from '@/lib/v2/copy/deletion';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Delete your account',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * Where the confirmation link lands (D4): the accounts its button acts on, read from the
 * link's cookie without using it, or, after the button (`?result=`), what happened. A 404 with
 * V2_CHECKS_PUBLIC unset.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const { result } = await searchParams;
  if (typeof result === 'string' && Object.hasOwn(LINK_STATES, result)) {
    return <DeletionScreen flow="deleteConfirm" view={{ ok: false, code: result }} />;
  }
  const token = (await cookies()).get(LINK_FLOWS.deleteConfirm.cookie)?.value;
  const view = await readDeletionLink(
    serviceRpc(supabaseAdmin()),
    'deleteConfirm',
    token,
    new Date(),
  );
  return <DeletionScreen flow="deleteConfirm" view={view} />;
}
