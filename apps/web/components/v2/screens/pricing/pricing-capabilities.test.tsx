/**
 * Pricing names only capabilities it can account for (SEO review 1–3, Q27): every capability phrase
 * on the rendered page is tagged with For agencies' `CAPABILITIES`, every coming one carries the
 * "coming" mark, and the meta description, which a search result shows with no mark, names none.
 */
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FREE_START } from '../../../../lib/billing/state-machine';
import { PRICING_COPY } from '../../../../lib/v2/copy/pricing';
import { CAPABILITIES } from '../../../../lib/v2/view/agencies';
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

  it('the meta description names no coming capability', () => {
    expect(comingNamedIn(PRICING_COPY.description())).toEqual([]);
  });

  // SEO R2-N2 (Q33): the artboard's h1 promises monitoring, and the footer's line on every page that
  // the change is told; each carries what it names and is marked while that is coming. With CC-28
  // merged both are built, so neither is marked (rulings-2).
  it('the h1 and the footer line carry the monitoring they name, marked while it is coming', () => {
    expect(PRICING_COPY.title.text).toBe('Every audit is free. Pay when you want it watched.');
    expect(PRICING_COPY.title.capabilities).toEqual(['weekly_checks', 'change_emails']);
    expect(CAPABILITIES.weekly_checks.status).toBe('built');
    expect(CAPABILITIES.change_emails.status).toBe('built');
    for (const [, html] of pages) {
      const doc = new JSDOM(html).window.document;
      const h1 = doc.querySelector('h1')!;
      expect(h1.querySelector('[data-capability~="weekly_checks"]')).not.toBeNull();
      expect(h1.querySelector('[data-v2-coming]') !== null).toBe(
        CAPABILITIES.weekly_checks.status === 'coming',
      );
      const line = [...doc.querySelectorAll('footer p')].find((p) =>
        p.textContent!.includes('tells you when that changes'),
      )!;
      expect(line.getAttribute('data-capability')).toBe('weekly_checks change_emails');
      expect(line.querySelector('[data-v2-coming]') !== null).toBe(
        CAPABILITIES.weekly_checks.status === 'coming' ||
          CAPABILITIES.change_emails.status === 'coming',
      );
    }
  });

  // Rulings-3 Q38: with the agency_plus_contact template, the answer says the request goes to the
  // team, and nothing of when it is answered.
  it('the Agency Plus answer says the request goes to the team, and no reply time', () => {
    expect(CAPABILITIES.agency_plus_reply.status).toBe('built');
    expect(PRICING_COPY.agencyPlus.sent).toBe('Sent. Your request goes to our team.');
    const [, sent] = pages.find(([n]) => n.endsWith('contact sent'))!;
    expect(sent).toContain('Sent. Your request goes to our team.');
    const said = `${PRICING_COPY.agencyPlus.sent} ${PRICING_COPY.agencyPlus.reply.text}`;
    expect(said).not.toMatch(/\b(?:hours?|days?|minutes?|soon|shortly|within|business)\b/i);
  });

  it('the emails question names the renewal reminders, as FACTS does', () => {
    const emails = PRICING_COPY.faq.items(true).find((i) => i.q === 'Which emails will I get?')!;
    expect(emails.a.text).toMatch(/Three kinds and no others/);
    expect(emails.a.text).toMatch(/renewal reminders 45 and 20 days before/);
  });
});
