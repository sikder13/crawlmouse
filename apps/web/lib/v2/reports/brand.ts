/**
 * Goal 1 row 24, white-label's readers: the agency's brand on the reports it sends a client.
 *
 * The brand is stamped on a report's document when the report is made (`ReportDoc.brand`), so the
 * PDF, the shared page and the scheduled-report mail all read the same stamp, and what a client is
 * shown stays what was stored when the report was made. A document with no brand has no `brand` key
 * at all, so with no brand set, the switch hiding the feature, or the account off Agency, every file
 * is what it was before this existed.
 *
 * The logo is read from storage by its stored path, with the service role, and only from that
 * account's own folder in the shape the upload route writes (`app/api/agency/brand/route.ts`). It is
 * never fetched by URL, and its bytes are checked again at read, as untrusted input.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { effectiveTier } from '../../entitlement-v2';
import { featureShown } from '../../feature-switch';
import { MAX_LOGO_BYTES, type LogoFormat } from '../../logo-validation';
import { LOGO_BUCKET } from '../../report-brand';
import { ACCOUNT_CLOCK_COLUMNS, clockFromAccountRow } from '../pipeline/load-for';
import { checkedLogo, ownLogoFormat, type BrandReader } from './brand-doc';

export {
  checkedLogo,
  NO_BRAND,
  ownLogoFormat,
  type BrandLogo,
  type BrandReader,
  type DocBrand,
} from './brand-doc';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The reader over the service-role client. `brandFor` answers a brand only while the account has a
 * brand row, is on Agency at `now`, and `agency_white_label` is shown. A read error throws: the
 * report fails to build rather than going out without the brand its agency set.
 */
export function supabaseBrandReader(
  admin: SupabaseClient,
  now: () => Date = () => new Date(),
  env: Env = process.env,
): BrandReader {
  return {
    async brandFor(accountId) {
      if (!featureShown('agency_white_label', env)) return null;
      const [brand, account] = await Promise.all([
        admin
          .from('agency_brands')
          .select('agency_name, logo_path')
          .eq('account_id', accountId)
          .maybeSingle(),
        admin.from('accounts').select(ACCOUNT_CLOCK_COLUMNS).eq('id', accountId).maybeSingle(),
      ]);
      if (brand.error) throw new Error(`brand: agency_brands read failed: ${brand.error.code}`);
      if (account.error) throw new Error(`brand: accounts read failed: ${account.error.code}`);
      if (brand.data === null || account.data === null) return null;
      const clock = clockFromAccountRow(account.data as Record<string, unknown>);
      if (effectiveTier(clock, now()) !== 'agency') return null;
      const row = brand.data as { agency_name: unknown; logo_path: unknown };
      if (typeof row.agency_name !== 'string' || row.agency_name === '') return null;
      const logoPath =
        typeof row.logo_path === 'string' && ownLogoFormat(accountId, row.logo_path) !== null
          ? row.logo_path
          : null;
      return { name: row.agency_name, logoPath };
    },
    async logo(accountId, logoPath) {
      const format = ownLogoFormat(accountId, logoPath);
      if (format === null) return null;
      const { data, error } = await admin.storage.from(LOGO_BUCKET).download(logoPath);
      if (error || data === null) return null;
      if (data.size > MAX_LOGO_BYTES) return null;
      return checkedLogo(new Uint8Array(await data.arrayBuffer()), format);
    },
  };
}

const MEDIA: Readonly<Record<LogoFormat, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * A shared page's logo as a `data:` address: read and checked by `reader.logo` for `accountId`,
 * the report's own account; null with no path, or when the read or the check refuses.
 */
export async function logoSrcOf(
  reader: Pick<BrandReader, 'logo'>,
  accountId: string,
  logoPath: string | null,
): Promise<string | null> {
  if (logoPath === null) return null;
  const logo = await reader.logo(accountId, logoPath).catch(() => null);
  if (logo === null) return null;
  return `data:${MEDIA[logo.format]};base64,${Buffer.from(logo.bytes).toString('base64')}`;
}
