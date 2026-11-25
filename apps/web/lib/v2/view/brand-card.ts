/**
 * The Settings Branding card's data, and what the card does with the brand route's answer (Goal 1
 * row 24). `settingsView` builds the card; this module holds its shape and the two pure steps the
 * client form takes, so a client component imports them without the rest of the Settings view.
 */
import type { LogoErr } from '../../logo-validation';
import { BRAND_FIELDS } from '../agency/brand-rules';

export interface BrandingCardView {
  title: string;
  sub: string;
  /** Where Save posts: the brand route with the account in its query string. */
  href: string;
  name: {
    id: string;
    label: string;
    /** The multipart field the route reads (`BRAND_FIELDS.name`). */
    field: string;
    value: string;
    /** The route's own rule (`BRAND_NAME_RULE`). */
    hint: string;
  };
  logo: {
    id: string;
    label: string;
    field: string;
    /** The validator's formats and limits, from its constants. */
    hint: string;
    /** The `accept` attribute: the content types the validator detects. */
    accept: string;
    /** The stored logo; null when there is none. */
    current: { src: string; alt: string } | null;
    currentLabel: string;
    none: string;
  };
  save: { label: string; busy: string };
  messages: BrandMessages;
}

export interface BrandMessages {
  saved: string;
  failed: string;
  rateLimited: string;
  /** 401 `auth_required`: the session ended; `signIn` is the way back. */
  signedOut: string;
  signIn: { label: string; href: string };
  /** 403 `role_refused`: the reader's seat may not set the brand. */
  roleRefused: string;
  /** 403 `upgrade_required`: the account's plan does not include branding. */
  planRefused: string;
  /** 404 `not_found`: the route is switched off. */
  unavailable: string;
  name: string;
  /** One sentence per reason `validateLogo` (and the route's size check) refuses with. */
  logo: Readonly<Record<LogoErr['reason'], string>> & { other: string };
}

/** What a save came to: the stored name, or a sentence, tied to its field where it has one. */
export type BrandOutcome =
  | { ok: true; agencyName: string }
  | {
      ok: false;
      field: 'name' | 'logo' | null;
      text: string;
      /** A link after the sentence: sign in again, for an ended session. */
      link?: { label: string; href: string };
    };

/** The logo's alternative text, for a brand of this name. */
export const brandLogoAlt = (name: string) => `${name} logo`;

/**
 * The multipart body the route reads: the name, and the logo whenever a file was chosen, an empty
 * one included, so the route's refusal of it (`invalid_logo`, `empty`) reaches the reader.
 */
export function brandBody(name: string, logo: File | null): FormData {
  const body = new FormData();
  body.append(BRAND_FIELDS.name, name);
  if (logo !== null) body.append(BRAND_FIELDS.logo, logo);
  return body;
}

/** The route's answer as the card says it (app/api/agency/brand/route.ts and its tests). */
export function brandOutcome(status: number, body: unknown, m: BrandMessages): BrandOutcome {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (status === 200 && typeof b.agencyName === 'string') {
    return { ok: true, agencyName: b.agencyName };
  }
  if (status === 400 && b.code === 'invalid_name') {
    return { ok: false, field: 'name', text: m.name };
  }
  if (status === 400 && b.code === 'invalid_logo') {
    const reason = b.reason;
    const text =
      typeof reason === 'string' && reason !== 'other' && Object.hasOwn(m.logo, reason)
        ? m.logo[reason as LogoErr['reason']]
        : m.logo.other;
    return { ok: false, field: 'logo', text };
  }
  // The whole body over its cap: only a logo can make it so.
  if (status === 413) return { ok: false, field: 'logo', text: m.logo.too_large };
  if (status === 429) return { ok: false, field: null, text: m.rateLimited };
  if (status === 401) return { ok: false, field: null, text: m.signedOut, link: m.signIn };
  if (status === 403 && b.code === 'role_refused') {
    return { ok: false, field: null, text: m.roleRefused };
  }
  if (status === 403 && b.code === 'upgrade_required') {
    return { ok: false, field: null, text: m.planRefused };
  }
  if (status === 404) return { ok: false, field: null, text: m.unavailable };
  return { ok: false, field: null, text: m.failed };
}
