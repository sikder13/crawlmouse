import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HostSchema } from '@crawlmouse/types/v2';
import { accountDoorEnabled, pipelineEnabled } from '@/lib/auth/flags';
import {
  CheckEmailScreen,
  type CheckEmailKind,
} from '@/components/v2/screens/check-email/CheckEmailScreen';

export const metadata: Metadata = { title: 'Check your email' };

const KINDS: readonly CheckEmailKind[] = ['signin', 'named-site', 'from-audit'];

/**
 * Check your email (CC-25). A 404 until V2_ACCOUNT_DOOR=1. `kind` picks the variant; `site` is shown
 * only when it is a hostname, and a kind that needs one without one reads as the sign-in kind.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[]; site?: string | string[] }>;
}) {
  if (!accountDoorEnabled()) notFound();
  const params = await searchParams;
  const raw = typeof params.site === 'string' ? params.site.toLowerCase() : '';
  const site = HostSchema.safeParse(raw).success ? raw : null;
  const asked = KINDS.find((k) => k === params.kind) ?? 'signin';
  const kind = asked !== 'signin' && site === null ? 'signin' : asked;
  return <CheckEmailScreen kind={kind} site={site} pipeline={pipelineEnabled()} />;
}
