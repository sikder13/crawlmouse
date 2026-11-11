import '../../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { EmailLinkScreen } from '@/components/v2/screens/email-change/EmailLinkScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { emailLinkPage } from '@/lib/v2/account/email-change-page';
import { readLinkRow } from '@/lib/v2/account/email-change-read';
import { LINK_FLOWS } from '@/lib/v2/account/link-cookie';
import { isToken } from '@/lib/v2/account/tokens';

export const dynamic = 'force-dynamic';

// Not indexed and not in the sitemap: a page reached from one person's emailed link. The root
// layout's canonical ("/") would be wrong here (OPERATING-RULES §13: indexing is the route's call).
export const metadata: Metadata = {
  title: 'Put your sign-in address back',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/** Where the emailUndo link lands (CC-27b D3). A 404 until V2_CHECKS_PUBLIC=1. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ done?: string | string[]; error?: string | string[] }>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const query = await searchParams;
  const raw = (await cookies()).get(LINK_FLOWS.emailUndo.cookie)?.value;
  const view = await emailLinkPage(
    readLinkRow(supabaseAdmin()),
    'emailUndo',
    isToken(raw) ? raw : null,
    { done: one(query.done), error: one(query.error) },
    new Date(),
  );
  return <EmailLinkScreen flow="emailUndo" view={view} />;
}
