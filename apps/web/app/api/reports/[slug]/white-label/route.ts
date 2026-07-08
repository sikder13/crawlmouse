import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { WhiteLabelConfig } from '@crawlmouse/types';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readReportRow, purgePublicReport } from '@/lib/reports';
import { isReportGone } from '@/lib/report-visibility';
import { isDomainVerifiedForUser } from '@/lib/report-ownership';
import { isUndefinedColumnError } from '@/lib/pg-errors';
import { deriveTier, entitlementFor } from '@/lib/entitlement';
import { whiteLabelBrandName } from '@/lib/report-brand';
import { checkRateLimit } from '@/lib/rate-limit';
import { WHITE_LABEL_UPDATES_PER_HOUR } from '@/lib/limits';

const HOUR_MS = 60 * 60 * 1000;

// SPEC 04 §5 (V9) — the white-label toggle: the one paid agency lever inside $19 Pro. A CLAIMED report
// owned by a PAID user (the §5 `canWhiteLabel` change) may replace the Crawlmouse wordmark with the
// owner's own brand (name + optional logo) on the report page, print/PDF, and OG card. Free/unclaimed
// reports always stay Crawlmouse-branded — that asymmetry IS the business model. Every write is gated
// SERVER-SIDE (never client-asserted): auth → paid entitlement → domain-verified ownership → the report
// is claimed. Enabling DEFAULTS the report to unlisted+noindex (a white-label report is a client
// deliverable, not a viral artifact — §5); the owner may re-list/-index via the visibility route.
// Snapshot / grade / claimed_at are NEVER touched here (minted-snapshot immutability, §4/§12). Writes
// go through the service-role client (client UPDATE on public_reports is revoked). Deploy-order-safe:
// the white_label column is absent pre-Runbook-B → PGRST204/42703 → 503 (fail-closed, like mint/hide).
const schema = z.discriminatedUnion('enabled', [
  z.object({
    enabled: z.literal(true),
    brandName: z.string().trim().min(1).max(60),
    // Optional storage path of a validated logo (from the logo upload route). null/absent = text-only.
    logoPath: z.string().max(300).nullish(),
  }),
  z.object({ enabled: z.literal(false) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  // A logo (if any) MUST live in THIS report's storage namespace (`${slug}/<file>`, written by the logo
  // upload route). A client can never point the brand at another report's — or an arbitrary — bucket
  // object. The strict two-segment charset allowlist rejects extra slashes, backslashes, and encoded
  // traversal (`%2e%2e`) that a bare `..` check would miss; the prefix binds it to this report; and the
  // explicit `..` check closes the one segment the charset would otherwise permit.
  if (parsed.data.enabled && parsed.data.logoPath != null) {
    const lp = parsed.data.logoPath;
    const okShape = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(lp);
    if (!okShape || !lp.startsWith(`${slug}/`) || lp.includes('..')) {
      return NextResponse.json({ error: 'invalid logo path' }, { status: 400 });
    }
  }

  const rl = await checkRateLimit(`report-white-label:${user.id}`, WHITE_LABEL_UPDATES_PER_HOUR, HOUR_MS);
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const sb = supabaseAdmin();

  // Paid entitlement — recomputed SERVER-SIDE from the user's OWN row, never trusted from the client.
  // Reads only pro_until: the `tier`/agency seam column isn't in this DB yet (selecting it would
  // 42703), and pro_until fully covers the Pro case (`entitlementFor` makes canWhiteLabel true for any
  // paid tier after the §5 flip). No 'agency' is producible in this phase.
  const { data: me } = await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle<{ pro_until: string | null }>();
  const proUntil = me?.pro_until ?? null;
  const ent = entitlementFor(deriveTier({ pro_until: proUntil }), proUntil);
  if (!ent.canWhiteLabel) return NextResponse.json({ error: 'pro_required' }, { status: 402 });

  const report = await readReportRow(sb, slug);
  if (!report) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // A hidden / taken-down / ungradeable report is not a brandable artifact.
  if (isReportGone(report)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Ownership: the caller must hold a VERIFIED domain_verifications row for the report's domain (the
  // same claim gate as claim/visibility, re-derived on every write — there is no claimed_by column).
  const owns = await isDomainVerifiedForUser(sb, user.id, report.domain);
  if (!owns) return NextResponse.json({ error: 'verification_required' }, { status: 403 });

  // Enabling: set the brand. Default the report unlisted+noindex ONLY on the OFF→ON transition (§5: a
  // white-label report defaults to a client deliverable) — a brand/logo EDIT on an already-white-labeled
  // report preserves the owner's current listed/indexable (they may have deliberately re-listed it, "the
  // owner may still list/index them explicitly"). Disabling: clear ONLY the brand, leaving visibility to
  // the owner. The `claimed_at is not null` predicate makes an unclaimed (or pre-migration
  // undefined-column) row a 0-row no-op → 409 / 503, never a silent write. snapshot/grade/claimed_at
  // are never in the patch (immutability §4/§12).
  let patch: { white_label: WhiteLabelConfig | null; listed?: boolean; indexable?: boolean };
  if (parsed.data.enabled) {
    const cfg: WhiteLabelConfig = { brandName: parsed.data.brandName, logoPath: parsed.data.logoPath ?? null };
    const alreadyWhiteLabeled = whiteLabelBrandName(report.white_label) != null;
    patch = alreadyWhiteLabeled ? { white_label: cfg } : { white_label: cfg, listed: false, indexable: false };
  } else {
    patch = { white_label: null };
  }

  const { data, error } = await sb
    .from('public_reports')
    .update(patch)
    .eq('slug', slug)
    .not('claimed_at', 'is', null)
    .select('slug, white_label, listed, indexable')
    .maybeSingle();

  if (error) {
    if (isUndefinedColumnError(error)) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    return NextResponse.json({ error: 'could not update' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'not claimed' }, { status: 409 });

  // Flip the report page branding/robots + OG immediately, and revalidate the /r/ sitemap (enabling
  // white-label drops the report from the indexable section).
  purgePublicReport(slug);
  revalidatePath('/sitemap.xml');
  const row = data as { white_label: WhiteLabelConfig | null; listed: boolean; indexable: boolean };
  return NextResponse.json({ ok: true, whiteLabel: row.white_label, listed: row.listed, indexable: row.indexable });
}
