import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readReportRow, purgePublicReport } from '@/lib/reports';
import { isReportGone } from '@/lib/report-visibility';
import { isDomainVerifiedForUser } from '@/lib/report-ownership';
import { isUndefinedColumnError } from '@/lib/pg-errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { VISIBILITY_UPDATES_PER_HOUR } from '@/lib/limits';

const HOUR_MS = 60 * 60 * 1000;

// SPEC 04 §8 — owner visibility toggle. A CLAIMED report's owner may opt out of listing/indexing. Same
// server-side ownership gate as claim (authed + a verified domain_verifications row for the report's
// domain), re-derived on every write — never client-asserted. Only listed/indexable are writable;
// claimed_at / report_snapshot / white_label are never touched here (snapshot immutability, §4/§12).
// Service-role write (client UPDATE on public_reports is revoked). Deploy-order-safe: the columns are
// absent pre-Runbook-B → PGRST204/42703 → 503 (fail-closed, like mint/hide).
const schema = z
  .object({ listed: z.boolean().optional(), indexable: z.boolean().optional() })
  .refine((v) => v.listed !== undefined || v.indexable !== undefined, { message: 'no change requested' });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  const rl = await checkRateLimit(`report-visibility:${user.id}`, VISIBILITY_UPDATES_PER_HOUR, HOUR_MS);
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const sb = supabaseAdmin();
  const report = await readReportRow(sb, slug);
  if (!report) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (isReportGone(report)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const owns = await isDomainVerifiedForUser(sb, user.id, report.domain);
  if (!owns) return NextResponse.json({ error: 'verification_required' }, { status: 403 });

  // Only the fields the caller sent (partial update). claimed_at is the atomic gate: a report must be
  // CLAIMED to have its visibility toggled → an unclaimed (or, pre-migration, undefined-column) row
  // matches 0 rows and is reported as 409 / 503 respectively rather than silently no-op'ing.
  const patch: { listed?: boolean; indexable?: boolean } = {};
  if (parsed.data.listed !== undefined) patch.listed = parsed.data.listed;
  if (parsed.data.indexable !== undefined) patch.indexable = parsed.data.indexable;

  const { data, error } = await sb
    .from('public_reports')
    .update(patch)
    .eq('slug', slug)
    .not('claimed_at', 'is', null)
    .select('slug, listed, indexable')
    .maybeSingle();

  if (error) {
    if (isUndefinedColumnError(error)) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    return NextResponse.json({ error: 'could not update' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'not claimed' }, { status: 409 });

  // Flip the report page robots + OG immediately; drop/add it from the /r/ sitemap on the next build.
  purgePublicReport(slug);
  revalidatePath('/sitemap.xml');
  const row = data as { listed: boolean; indexable: boolean };
  return NextResponse.json({ ok: true, listed: row.listed, indexable: row.indexable });
}
