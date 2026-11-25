/**
 * Settings' Branding card (V2R register row 24, CTO 085): shown exactly where the brand route would
 * take the reader's save, filled from `account.branding`, and its help text read from the
 * validator's and the route's own constants.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { JSDOM } from 'jsdom';
import { SettingsScreen } from '../../../components/v2/screens/settings/SettingsScreen';
import {
  PREVIEW_BRAND_LOGO,
  settingsPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/screens';
import { MAX_LOGO_BYTES, MAX_LOGO_DIMENSION, validateLogo } from '../../logo-validation';
import { BRAND_NAME_RULE } from '../agency/brand-rules';
import { ALL_SHOWN, type Features } from '../features';
import { fixture } from '../fixtures';
import type { SeatRole } from '../account/profile';
import { LOGO_TYPES, settingsView } from './settings';
import { COPY_CHANGES } from '../copy-registry';

const NORTHWIND = 'a0000000-0000-4000-8000-0000000000c9';
const KESTREL = 'a0000000-0000-4000-8000-0000000000ca';
const BAD = 'a0000000-0000-4000-8000-000000000001';
const HIDDEN: Features = { ...ALL_SHOWN, agency_white_label: false };

const challenged = fixture('challenged-site');
const agencyView = (
  role: SeatRole,
  features: Features = ALL_SHOWN,
  accountId: string = NORTHWIND,
) => settingsView(challenged, { accountId, now: challenged.as_of }, { role, features });

const text = (html: string) => new JSDOM(html).window.document.body.textContent ?? '';

describe('when the Branding card shows', () => {
  it('shows for an Agency account’s owner and account manager with agency_white_label shown', () => {
    expect(agencyView('owner').branding).not.toBeNull();
    expect(agencyView('account_manager').branding).not.toBeNull();
  });

  it('is hidden for a developer seat, which the route refuses with 403', () => {
    expect(agencyView('developer').branding).toBeNull();
  });

  it('is hidden while the Goal 1 switch hides agency_white_label, for the owner too', () => {
    expect(agencyView('owner', HIDDEN).branding).toBeNull();
    expect(agencyView('account_manager', HIDDEN).branding).toBeNull();
  });

  it('is hidden on Pro, for the owner, with the switch shown', () => {
    const bad = fixture('bad-site');
    const pro = settingsView(bad, { accountId: BAD, now: bad.as_of }, { role: 'owner' });
    expect(pro.branding).toBeNull();
  });

  it('is hidden on Free', () => {
    expect(settingsPreview('clean').branding).toBeNull();
  });

  it('is not drawn on the page where the view has none', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsScreen, { data: agencyView('owner', HIDDEN) }),
    );
    expect(html).not.toContain('Branding');
    expect(html).not.toContain('/api/agency/brand');
  });
});

describe('what the card holds', () => {
  it('posts to the brand route with the account in its query string', () => {
    expect(agencyView('owner').branding!.href).toBe(`/api/agency/brand?account=${NORTHWIND}`);
  });

  it('shows the current brand name and logo', () => {
    const card = settingsPreview('withheld').branding!;
    expect(card.name.value).toBe('Northwind Digital');
    expect(card.logo.current).toEqual({ src: PREVIEW_BRAND_LOGO, alt: 'Northwind Digital logo' });
    const html = renderToStaticMarkup(
      createElement(SettingsScreen, { data: settingsPreview('withheld') }),
    );
    const img = new JSDOM(html).window.document.querySelector('img[alt="Northwind Digital logo"]');
    expect(img?.getAttribute('src')).toBe(PREVIEW_BRAND_LOGO);
    expect(text(html)).not.toContain('No logo yet');
  });

  it('says "No logo yet" for an account with no logo', () => {
    const card = agencyView('owner', ALL_SHOWN, KESTREL).branding!;
    expect(card.name.value).toBe('Kestrel Creative');
    expect(card.logo.current).toBeNull();
    const html = renderToStaticMarkup(
      createElement(SettingsScreen, { data: agencyView('owner', ALL_SHOWN, KESTREL) }),
    );
    expect(text(html)).toContain('No logo yet');
    expect(html).not.toContain('<img');
  });

  it('labels each input and ties its hint to it', () => {
    const doc = new JSDOM(
      renderToStaticMarkup(createElement(SettingsScreen, { data: settingsPreview('withheld') })),
    ).window.document;
    for (const [id, field] of [
      ['brand-name', 'agencyName'],
      ['brand-logo', 'logo'],
    ] as const) {
      const input = doc.getElementById(id)!;
      expect(input.getAttribute('name')).toBe(field);
      expect(doc.querySelector(`label[for="${id}"]`)).not.toBeNull();
      expect(input.getAttribute('aria-describedby')).toBe(`${id}-hint`);
      expect(doc.getElementById(`${id}-hint`)).not.toBeNull();
    }
  });
});

describe('the card’s rules, read from the code that enforces them', () => {
  const card = agencyView('owner').branding!;

  it('shows the route’s name rule, written out here as the route’s test writes it', () => {
    expect(card.name.hint).toBe(BRAND_NAME_RULE);
    expect(card.name.hint).toBe(
      'Use 1 to 60 characters, with no @, colon or slash, no dot followed by another character, and no number of 7 digits or more.',
    );
  });

  it('states the logo limits as validateLogo’s constants', () => {
    expect(card.logo.hint).toContain(`up to ${MAX_LOGO_BYTES / 1024} KB`);
    expect(card.logo.hint).toContain(`${MAX_LOGO_DIMENSION.toLocaleString('en-US')} pixels a side`);
    expect(card.logo.hint).toBe(
      'PNG, JPEG or WebP, up to 200 KB and 4,096 pixels a side. Leave it empty to keep the current logo.',
    );
  });

  // A minimal valid image of each format, so the card's list is checked against the validator.
  const SAMPLES: Record<keyof typeof LOGO_TYPES, Uint8Array> = {
    png: Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
      16, 0, 0, 0, 16,
    ]),
    jpeg: Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0]),
    webp: Uint8Array.from([
      0x52,
      0x49,
      0x46,
      0x46,
      0,
      0,
      0,
      0,
      0x57,
      0x45,
      0x42,
      0x50,
      0x56,
      0x50,
      0x38,
      0x58,
      ...Array(8).fill(0),
      15,
      0,
      0,
      15,
      0,
      0,
    ]),
  };

  it.each(Object.keys(LOGO_TYPES) as (keyof typeof LOGO_TYPES)[])(
    'accepts %s, the content type validateLogo stores it as',
    (format) => {
      const v = validateLogo(SAMPLES[format]);
      expect(v.ok && v.format).toBe(format);
      expect(v.ok && v.contentType).toBe(LOGO_TYPES[format].contentType);
      expect(card.logo.accept.split(',')).toContain(LOGO_TYPES[format].contentType);
    },
  );

  it('names exactly the formats it accepts, no SVG among them', () => {
    expect(card.logo.accept).toBe('image/png,image/jpeg,image/webp');
    expect(card.logo.accept).not.toMatch(/svg/);
  });

  it('says the size and dimension refusals with the same constants', () => {
    expect(card.messages.logo.too_large).toBe(
      `That logo is over ${MAX_LOGO_BYTES / 1024} KB. Choose a smaller file.`,
    );
    expect(card.messages.logo.bad_dimensions).toBe(
      `That logo must be between 1 and ${MAX_LOGO_DIMENSION.toLocaleString('en-US')} pixels on each side.`,
    );
    expect(card.messages.rateLimited).toBe(
      'Branding can be saved five times an hour. Try again in an hour.',
    );
  });
});

describe('a zero-size image', () => {
  it('is refused as bad_dimensions, and the card’s sentence is true of it', () => {
    // A PNG header 0 pixels wide and 16 high.
    const zeroWide = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
      0, 0, 0, 0, 16,
    ]);
    const v = validateLogo(zeroWide);
    expect(v.ok ? null : v.reason).toBe('bad_dimensions');
    const card = agencyView('owner').branding!;
    expect(card.messages.logo.bad_dimensions).toBe(
      'That logo must be between 1 and 4,096 pixels on each side.',
    );
    expect(card.messages.logo.bad_dimensions).not.toMatch(/\bover\b/);
  });
});

describe('the account name’s hint (V2R register row 24)', () => {
  const hint = (v: ReturnType<typeof settingsView>) => v.account.name.hint;
  const bad = fixture('bad-site');
  const pro = (features: Features) =>
    settingsView(bad, { accountId: BAD, now: bad.as_of }, { features });

  it('on Pro, names sign-in links and, on Agency, client-report mail', () => {
    expect(hint(settingsPreview('home'))).toBe(
      'Shown on sign-in links and, on Agency, in client-report mail.',
    );
  });

  it('on Agency, names sign-in links and client-report mail, with a brand set or not', () => {
    expect(hint(agencyView('owner'))).toBe('Shown on sign-in links and in client-report mail.');
    expect(hint(agencyView('owner', ALL_SHOWN, KESTREL))).toBe(
      'Shown on sign-in links and in client-report mail.',
    );
  });

  it('with agency_white_label hidden, names sign-in links only', () => {
    expect(hint(agencyView('owner', HIDDEN))).toBe('Shown on sign-in links.');
    expect(hint(pro(HIDDEN))).toBe('Shown on sign-in links.');
  });

  it('never says a client report shows the brand name, which no report reads yet', () => {
    for (const v of [agencyView('owner'), agencyView('owner', HIDDEN), pro(ALL_SHOWN), pro(HIDDEN)])
      expect(hint(v)).not.toMatch(/brand name|on client reports/);
    expect(agencyView('owner').branding!.sub).toBe('The name and logo for your client reports.');
  });

  it('registers every reading that differs from the locked hint, as a V2R ruling', () => {
    const readings = new Set(
      [agencyView('owner'), agencyView('owner', HIDDEN), pro(ALL_SHOWN), pro(HIDDEN)].map(hint),
    );
    const registered = COPY_CHANGES.filter(
      (c) => c.locked === 'Shown on sign-in links and, on Agency, on client reports.',
    );
    expect(new Set(registered.map((c) => c.rendered))).toEqual(readings);
    for (const c of registered) {
      expect(c.kind).toBe('ruling');
      expect(c.source).toMatch(/^V2R register, row 24 \(CTO 085\)/);
    }
    // Only the reading the locked fixture renders (Pro, switch shown) is applied to the lock.
    expect(registered.filter((c) => !c.otherReading).map((c) => c.rendered)).toEqual([
      'Shown on sign-in links and, on Agency, in client-report mail.',
    ]);
  });
});
