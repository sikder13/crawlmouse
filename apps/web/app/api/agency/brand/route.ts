import { createHash } from 'node:crypto';
import { accountDoorEnabled } from '@/lib/auth/flags';
import { featureShown } from '@/lib/feature-switch';
import { MAX_LOGO_BYTES, validateLogo } from '@/lib/logo-validation';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  BRAND_EDITORS,
  BRAND_FIELDS,
  BRAND_NAME_MAX,
  BRAND_NAME_RULE,
  BRAND_SAVES_PER_HOUR,
} from '@/lib/v2/agency/brand-rules';
import { LOGO_BUCKET, logoPublicUrl } from '@/lib/report-brand';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { isId, notFound, refuse } from '@/lib/v2/account/route';
import { accountNameText } from '@/lib/v2/mail/templates/parts';
import { readEntitlement } from '@/lib/v2/account/viewer-read';

// node:crypto (the content address) and the storage upload need the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOADS_PER_HOUR = BRAND_SAVES_PER_HOUR;
const HOUR_MS = 60 * 60 * 1000;
/** The request body's cap: the logo's, plus room for the two text fields and the multipart framing. */
const BODY_MAX = MAX_LOGO_BYTES + 16 * 1024;
const NAME_MAX = BRAND_NAME_MAX;
/** What a refused name must change, said with the refusal (lib/v2/agency/brand-rules.ts). */
const NAME_RULE = BRAND_NAME_RULE;
/**
 * Controls (`Cc`: C0, DEL and C1), format characters (`Cf`: the bidi marks, embeddings, overrides and
 * isolates U+200E/F, U+202A–U+202E and U+2066–U+2069, the Arabic letter mark U+061C, the zero-width
 * U+200B–U+200D and U+FEFF among them), and the line and paragraph separators (`Zl`, `Zp`).
 */
const CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const EDITORS: ReadonlySet<unknown> = new Set<unknown>(BRAND_EDITORS);

/**
 * The name as stored: the controls removed, then trimmed; null unless 1 to 60 code points remain,
 * and null when it holds text a mail client or a browser may read as a link or an address. That is
 * the guard the mail templates apply to an account or agency name (`accountNameText`), so a name it
 * would refuse to show is refused here instead of stored.
 */
function cleanName(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(CONTROLS, '').trim();
  const length = [...name].length;
  if (length < 1 || length > NAME_MAX) return null;
  return accountNameText(name) === null ? null : name;
}

/** The body's bytes, or null once more than `BODY_MAX` arrive; the stream is cancelled there. */
async function readCapped(req: Request): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > BODY_MAX) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The part a browser sends for a file input left empty: no bytes and no file name. */
function isEmptyFileField(part: Blob): boolean {
  return part.size === 0 && part instanceof File && part.name === '';
}

/** A missing bucket, matched as v1's logo route matches it (app/api/reports/[slug]/logo/route.ts). */
function isBucketMissing(e: {
  message?: unknown;
  statusCode?: unknown;
  status?: unknown;
}): boolean {
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('bucket not found') || e.statusCode === '404' || e.status === 404;
}

/** An object already at the path: storage answers a duplicate with statusCode '409'. */
function isDuplicate(e: { statusCode?: unknown; status?: unknown }): boolean {
  return e.statusCode === '409' || e.status === 409;
}

/**
 * The stored logo's public URL, as the account dataset derives it (lib/v2/account/rows.ts): null
 * with no logo, and null unless `logoPublicUrl` builds an https URL for it.
 */
function storedLogoUrl(path: string | null): string | null {
  if (path === null) return null;
  const url = logoPublicUrl(path);
  return url !== null && url.startsWith('https://') ? url : null;
}

/**
 * Set an Agency account's white-label brand (Goal 1 row 24). The account is named in the query
 * string (`?account=<uuid>`); the multipart body carries `agencyName` and an optional `logo` file,
 * and any `accountId` field in it is never read. A save answers `{ agencyName, logoPath, logoUrl }`,
 * `logoUrl` the stored logo's https URL or null. Each step refuses before the next runs, the body is
 * not read until the caller's role, tier and rate limit have passed, and nothing is written until
 * every check has. The middleware has already refused a cross-site request (route-policy: strict).
 */
export async function POST(req: Request) {
  // 1. The account door (a v2 route, a 404 with V2_ACCOUNT_DOOR off) and the feature switch, before
  // the session or the body is read.
  if (!accountDoorEnabled()) return notFound();
  if (!featureShown('agency_white_label')) return notFound();

  // 2. Signed in.
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  // 3. The account, from the query string.
  const accountId = new URL(req.url).searchParams.get('account');
  if (accountId === null || !isId(accountId)) return refuse(400, 'invalid');

  // 4. The caller's role on that account, asked through the caller's own session. No seat and a
  //    developer seat get the same answer, so it says nothing about whether the account exists.
  const { data: role, error: roleError } = await sb.rpc('member_role', { p_account: accountId });
  if (roleError) {
    console.error(`agency brand: member_role failed: ${roleError.message}`);
    return refuse(500, 'internal');
  }
  if (!EDITORS.has(role)) return refuse(403, 'role_refused');

  // 5. The account's effective tier, read through the caller's session.
  const entitlement = await readEntitlement(sb, accountId, new Date()).catch((e: unknown) => {
    console.error(`agency brand: ${e instanceof Error ? e.message : 'entitlement read failed'}`);
    return undefined;
  });
  if (entitlement === undefined) return refuse(500, 'internal');
  if (entitlement === null || entitlement.tier !== 'agency' || !entitlement.gates.agencyBranding) {
    return refuse(403, 'upgrade_required', { gate: 'agencyBranding' });
  }

  // 6. Five uploads an hour per account; a counter outage refuses.
  const rl = await checkRateLimit(`agency-brand:${accountId}`, UPLOADS_PER_HOUR, HOUR_MS, {
    failClosed: true,
  });
  if (!rl.allowed) return refuse(429, 'rate_limited');

  // 7. The body: multipart, refused on its declared length before it is read, then read up to the cap.
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    return refuse(415, 'unsupported_media_type');
  }
  const declared = req.headers.get('content-length');
  if (declared !== null && !(/^\d+$/.test(declared) && Number(declared) <= BODY_MAX)) {
    return refuse(413, 'too_large');
  }
  const raw = await readCapped(req);
  if (raw === null) return refuse(413, 'too_large');
  const form = await new Response(raw as BodyInit, { headers: { 'content-type': type } })
    .formData()
    .catch(() => null);
  if (form === null) return refuse(400, 'invalid');

  // 8. The brand name.
  const agencyName = cleanName(form.get(BRAND_FIELDS.name));
  if (agencyName === null) return refuse(400, 'invalid_name', { message: NAME_RULE });

  // 9. The logo, if one was sent: the part's size first, then the validator decides on its bytes.
  //    A form's empty file input arrives as a nameless, empty file part, which is no logo.
  const part = form.get(BRAND_FIELDS.logo);
  const file = part instanceof Blob && isEmptyFileField(part) ? null : part;
  let logo: { bytes: Uint8Array; contentType: string; ext: string } | null = null;
  if (file !== null) {
    if (!(file instanceof Blob)) {
      return refuse(400, 'invalid_logo', { reason: 'unsupported_type' });
    }
    if (file.size > MAX_LOGO_BYTES) return refuse(400, 'invalid_logo', { reason: 'too_large' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const v = validateLogo(bytes);
    if (!v.ok) return refuse(400, 'invalid_logo', { reason: v.reason });
    logo = { bytes, contentType: v.contentType, ext: v.ext };
  }

  // 10. The writes. The object path is content-addressed and never overwritten, so a report made
  //     earlier keeps the logo it was made with; the same bytes again reuse the path.
  const admin = supabaseAdmin();
  let logoPath: string | undefined;
  if (logo) {
    const hash = createHash('sha256').update(logo.bytes).digest('hex').slice(0, 16);
    logoPath = `agency/${accountId}/${hash}.${logo.ext}`;
    const up = await admin.storage.from(LOGO_BUCKET).upload(logoPath, logo.bytes, {
      contentType: logo.contentType, // the detected type, never the declared one
      cacheControl: '31536000, immutable',
      upsert: false,
    });
    if (up.error) {
      const err = up.error as { message?: unknown; statusCode?: unknown; status?: unknown };
      if (isBucketMissing(err)) {
        console.error(`agency brand: bucket "${LOGO_BUCKET}" missing`);
        return refuse(503, 'unavailable');
      }
      if (!isDuplicate(err)) {
        console.error(`agency brand: upload failed: ${String(err.message ?? 'unknown')}`);
        return refuse(500, 'upload_failed');
      }
    }
  }

  // Without a logo the row has no logo_path key, so the upsert leaves the stored one as it is.
  const row = {
    account_id: accountId,
    agency_name: agencyName,
    updated_at: new Date().toISOString(),
    ...(logoPath === undefined ? {} : { logo_path: logoPath }),
  };
  const { data, error } = await admin
    .from('agency_brands')
    .upsert(row, { onConflict: 'account_id' })
    .select('agency_name, logo_path')
    .single();
  if (error) {
    console.error(`agency brand: agency_brands upsert failed: ${error.message}`);
    return refuse(500, 'save_failed');
  }
  const saved = data as { agency_name: string; logo_path: string | null };
  return Response.json({
    agencyName: saved.agency_name,
    logoPath: saved.logo_path,
    logoUrl: storedLogoUrl(saved.logo_path),
  });
}
