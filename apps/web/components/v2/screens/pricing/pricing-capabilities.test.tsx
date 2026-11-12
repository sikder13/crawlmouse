/**
 * Pricing names only capabilities it can account for (SEO review 1–3, Q27): every capability phrase
 * on the rendered page is tagged with For agencies' `CAPABILITIES`, every coming one carries the
 * "coming" mark, and the meta description, which a search result shows with no mark, names none.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FREE_START } from '../../../../lib/billing/state-machine';
import { PRICING_COPY } from '../../../../lib/v2/copy/pricing';
import { pricingView, type PricingViewer } from '../../../../lib/v2/view/pricing';
import { capabilitySweep, comingNamedIn } from '../../../../__tests__/helpers/capability-sweep';
import { PricingScreen } from './PricingScreen';

const NOW = new Date('2026-11-12T12:00:00Z');
const FLAGS = { accountDoor: true, checksPublic: true };
const VIEWERS: [string, PricingViewer][] = [
  ['signed out', { kind: 'signed_out' }],
  [
    'signed in, free',
    {
      kind: 'signed_in',
      account: {
        id: 'a0000000-0000-4000-8000-00000000000a',
        owner: true,
        tier: 'free',
        snapshot: FREE_START,
        customer: null,
      },
      agency: { held: false, used: null },
    },
  ],
];

const pages = VIEWERS.flatMap(([name, viewer]) =>
  (['month', 'year'] as const).flatMap((interval) =>
    (['idle', 'sent'] as const).map(
      (contact) =>
        [
          `${name}, ${interval}, contact ${contact}`,
          renderToStaticMarkup(
            <PricingScreen view={pricingView(viewer, interval, NOW, FLAGS)} contact={contact} />,
          ),
        ] as const,
    ),
  ),
);

describe('Pricing names only capabilities it can account for', () => {
  it.each(pages)('%s', (_name, html) => {
    const r = capabilitySweep(html);
    expect(r.tagged).toBeGreaterThan(20);
    expect(r.seen).toBeGreaterThan(10);
    expect(r.unknown).toEqual([]);
    expect(r.unmarked).toEqual([]);
    expect(r.overMarked).toEqual([]);
    expect(r.loose).toEqual([]);
  });

  it('the meta description and the h1 name no coming capability', () => {
    expect(comingNamedIn(PRICING_COPY.description())).toEqual([]);
    expect(comingNamedIn(PRICING_COPY.title)).toEqual([]);
  });

  it('the Agency Plus answer says only that the request is recorded', () => {
    expect(PRICING_COPY.agencyPlus.sent).toBe('Sent. Your request is recorded.');
    const [, sent] = pages.find(([n]) => n.endsWith('contact sent'))!;
    expect(sent).toContain('Sent. Your request is recorded.');
  });

  it('the emails question names the renewal reminders, as FACTS does', () => {
    const emails = PRICING_COPY.faq.items(true).find((i) => i.q === 'Which emails will I get?')!;
    expect(emails.a.text).toMatch(/Three kinds and no others/);
    expect(emails.a.text).toMatch(/renewal reminders 45 and 20 days before/);
  });
});
