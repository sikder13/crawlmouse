/**
 * What a report's document carries of the agency's brand (Goal 1 row 24, white-label), and the pure
 * rules for its logo. No server code, so the document's own module, the pages that draw it and the
 * tests import it freely; the service-role reader is `brand.ts`.
 */
import { MAX_LOGO_BYTES, validateLogo, type LogoFormat } from '../../logo-validation';

export interface DocBrand {
  /** The agency's name as its owner or account manager wrote it (1 to 60 characters, checked at write). */
  name: string;
  /** The logo's object in `report-logos`, as the upload route stored it, or null for none. */
  logoPath: string | null;
}

/** A logo read and checked: its bytes and the format its bytes are. */
export interface BrandLogo {
  bytes: Uint8Array;
  format: LogoFormat;
}

export interface BrandReader {
  /** The brand to stamp on a report of `accountId` made now, or null for none. */
  brandFor(accountId: string): Promise<DocBrand | null>;
  /** The logo at `logoPath`, read only when it is `accountId`'s own and its bytes are a logo. */
  logo(accountId: string, logoPath: string): Promise<BrandLogo | null>;
}

/** No brand on any report: the generator's behaviour before white-label had readers. */
export const NO_BRAND: BrandReader = {
  brandFor: async () => null,
  logo: async () => null,
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXTENSIONS: Readonly<Record<string, LogoFormat>> = { png: 'png', jpg: 'jpeg', webp: 'webp' };

/**
 * The format a stored logo path names when it is `accountId`'s own, in the upload route's shape
 * (`agency/<account>/<16 hex>.<png|jpg|webp>`), or null for any other path.
 */
export function ownLogoFormat(accountId: string, logoPath: string): LogoFormat | null {
  if (!new RegExp(`^${UUID}$`).test(accountId)) return null;
  const m = new RegExp(`^agency/(${UUID})/[0-9a-f]{16}\\.(png|jpg|webp)$`).exec(logoPath);
  if (m === null || m[1] !== accountId) return null;
  return EXTENSIONS[m[2]!] ?? null;
}

/**
 * Whether `bytes` may be drawn as `accountId`'s logo stored as `expected`: within the upload's size
 * bound, a format `validateLogo` accepts, and the format the path's extension names.
 */
export function checkedLogo(bytes: Uint8Array, expected: LogoFormat): BrandLogo | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) return null;
  const v = validateLogo(bytes);
  if (!v.ok || v.format !== expected) return null;
  return { bytes, format: v.format };
}
