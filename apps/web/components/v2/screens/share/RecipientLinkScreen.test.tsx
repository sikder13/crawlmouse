import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PREVIEWS } from '../../../../app/(v2-preview)/v2-preview/_preview/registry';
import { CC31_REPORT_LINK_ELEMENTS } from '../../../../__tests__/v2/_lib/screens';
import { recipientLinkView } from '../../../../lib/v2/agency/schedules-link-view';
import { RecipientLinkScreen } from './RecipientLinkScreen';

// The page a client report's recipient lands on (CC-31 D8), as a view and as its previews.

const LINK = { host: 'client.example', accountName: 'Summit Digital' };
const primaries = (html: string) => html.match(/data-v2-primary=""/g) ?? [];
const card = (html: string) => /<section[\s\S]*<\/section>/.exec(html)![0];
const render = (...args: Parameters<typeof recipientLinkView>) =>
  card(renderToStaticMarkup(<RecipientLinkScreen data={recipientLinkView(...args)} />));

describe('recipientLinkView', () => {
  it('confirm: says who sends what about which site, and offers the one button, which posts to the confirm route', () => {
    const v = recipientLinkView('confirm', { kind: 'confirm', ...LINK }, null);
    expect(v).toEqual({
      state: 'link',
      title: 'Confirm these reports',
      lines: [
        'Summit Digital would like to send reports about client.example to this address.',
        'Nothing is sent until you confirm. Each report carries a link that stops them.',
      ],
      act: { action: '/api/report-files/confirm', label: 'Confirm' },
    });
  });

  it('pause: says what stops, and posts to the pause route', () => {
    const v = recipientLinkView('pause', { kind: 'pause', ...LINK }, null);
    expect(v.title).toBe('Stop these reports');
    expect(v.lines[0]).toBe('Summit Digital sends reports about client.example to this address.');
    expect(v.act).toEqual({ action: '/api/report-files/pause', label: 'Stop the reports' });
  });

  it('names an account that has no name without inventing one', () => {
    const v = recipientLinkView(
      'confirm',
      { kind: 'confirm', host: 'x.example', accountName: null },
      null,
    );
    expect(v.lines[0]).toBe(
      'A Crawlmouse customer would like to send reports about x.example to this address.',
    );
  });

  it('offers nothing for no link, and for a link of the other kind', () => {
    for (const v of [
      recipientLinkView('confirm', null, null),
      recipientLinkView('confirm', { kind: 'pause', ...LINK }, null),
      recipientLinkView('pause', { kind: 'confirm', ...LINK }, null),
    ]) {
      expect(v).toMatchObject({
        state: 'gone',
        title: 'This link can no longer be used',
        act: null,
      });
    }
  });

  it('after the press says what was done, with no button, whatever the cookie still holds', () => {
    const confirmed = recipientLinkView('confirm', null, 'report_confirmed');
    expect(confirmed).toEqual({
      state: 'done',
      title: 'Confirmed',
      lines: ['Confirmed. The reports will be sent to this address.'],
      act: null,
    });
    const paused = recipientLinkView('pause', { kind: 'pause', ...LINK }, 'report_paused');
    expect(paused).toMatchObject({ state: 'done', title: 'Stopped', act: null });
  });

  it('a notice that is the other page’s, or a refusal’s, does not say done', () => {
    expect(recipientLinkView('confirm', null, 'report_paused').state).toBe('gone');
    expect(recipientLinkView('pause', null, 'report_confirmed').state).toBe('gone');
    expect(recipientLinkView('confirm', null, 'report_link_gone').state).toBe('gone');
    expect(recipientLinkView('confirm', { kind: 'confirm', ...LINK }, 'seat_invited').state).toBe(
      'link',
    );
  });
});

describe('RecipientLinkScreen', () => {
  it('draws the button as a form that posts no field, and names no address', () => {
    const html = render('confirm', { kind: 'confirm', ...LINK }, null);
    const form = /<form[^>]*>/.exec(html)![0];
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/api/report-files/confirm"');
    expect(html).not.toMatch(/<input/);
    expect(html).not.toContain('@');
    expect(primaries(html)).toHaveLength(1);
  });

  it('draws no form once done, and for a link that cannot be used', () => {
    expect(render('confirm', null, 'report_confirmed')).not.toMatch(/<form|<button/);
    expect(render('pause', null, null)).not.toMatch(/<form|<button/);
  });
});

describe('the previews', () => {
  const entries = PREVIEWS.filter((p) => /\/screens\/report-link(\/|$)/.test(p.path));

  it('has an element for each preview the registry lists', () => {
    expect(Object.keys(CC31_REPORT_LINK_ELEMENTS).sort()).toEqual(
      entries.map((p) => p.path).sort(),
    );
    expect(entries).toHaveLength(3);
  });

  it.each(entries.map((p) => [p.path, p.orange ?? 1] as const))(
    '%s has %i orange element',
    (path, orange) => {
      expect(primaries(renderToStaticMarkup(CC31_REPORT_LINK_ELEMENTS[path]!()))).toHaveLength(
        orange,
      );
    },
  );
});
