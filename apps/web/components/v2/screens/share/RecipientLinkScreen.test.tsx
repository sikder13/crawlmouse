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
      // The line and the second button that stop the requests for good; the form names this page.
      also: {
        line: 'You can stop these requests for good with one click.',
        action: '/api/report-files/decline',
        label: 'Don’t ask me again',
        from: 'confirm',
      },
    });
  });

  it('“Don’t ask me again”: says what the button does, with or without what the link names, and posts to the decline route', () => {
    const named = recipientLinkView('decline', { kind: 'confirm', ...LINK }, null, true);
    expect(named).toEqual({
      state: 'link',
      title: 'Stop these requests',
      lines: [
        'Summit Digital asked to send reports about client.example to this address.',
        'The button stops the requests for good: you are not asked again about this site, and no report about it is sent to this address.',
      ],
      act: { action: '/api/report-files/decline', label: 'Don’t ask me again' },
      also: null,
    });
    // A confirmation link past its seven days is read as gone, and is still offered the button.
    const old = recipientLinkView('decline', null, null, true);
    expect(old).toMatchObject({ state: 'link', act: named.act });
    expect(old.lines).toEqual([named.lines[1]]);
    // No token in the cookie: nothing to press.
    expect(recipientLinkView('decline', null, null, false)).toMatchObject({
      state: 'gone',
      act: null,
    });
    expect(recipientLinkView('decline', null, 'report_declined', false)).toEqual({
      state: 'done',
      title: 'You will not be asked again',
      lines: [
        'Done. You will not be asked again about these reports, and none is sent to this address.',
      ],
      act: null,
      also: null,
    });
  });

  it('pause: says what stops, and posts to the pause route', () => {
    const v = recipientLinkView('pause', { kind: 'pause', ...LINK }, null);
    expect(v.title).toBe('Stop these reports');
    expect(v.lines[0]).toBe('Summit Digital sends reports about client.example to this address.');
    expect(v.act).toEqual({ action: '/api/report-files/pause', label: 'Stop the reports' });
    expect(v.also).toMatchObject({ action: '/api/report-files/decline', from: 'pause' });
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

  it('shows an account’s name by the mail’s rule: one shaped like a link or an address is not shown', () => {
    for (const accountName of ['evil.example/login', 'pay@evil.example', 'https://evil.example']) {
      for (const kind of ['confirm', 'pause'] as const) {
        const v = recipientLinkView(kind, { kind, host: 'x.example', accountName }, null);
        expect(v.lines[0]).toMatch(/^A Crawlmouse customer /);
        expect(v.lines.join(' ')).not.toContain('evil');
      }
      const declining = recipientLinkView(
        'decline',
        { kind: 'confirm', host: 'x.example', accountName },
        null,
        true,
      );
      expect(declining.lines.join(' ')).not.toContain('evil');
    }
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
      also: null,
    });
    const paused = recipientLinkView('pause', { kind: 'pause', ...LINK }, 'report_paused');
    expect(paused).toMatchObject({ state: 'done', title: 'Stopped', act: null });
  });

  it('a notice that is the other page’s, or a refusal’s, does not say done', () => {
    expect(recipientLinkView('confirm', null, 'report_paused').state).toBe('gone');
    expect(recipientLinkView('pause', null, 'report_confirmed').state).toBe('gone');
    expect(recipientLinkView('confirm', null, 'report_link_gone').state).toBe('gone');
    expect(
      recipientLinkView('confirm', { kind: 'confirm', ...LINK }, 'seat_invited'),
    ).toMatchObject({ state: 'link' });
  });
});

describe('RecipientLinkScreen', () => {
  it('draws the button as a form that posts no field, then the second form that names the page, and no address', () => {
    const html = render('confirm', { kind: 'confirm', ...LINK }, null);
    const forms = html.match(/<form[^>]*>/g)!;
    expect(forms).toHaveLength(2);
    expect(forms[0]).toContain('method="post"');
    expect(forms[0]).toContain('action="/api/report-files/confirm"');
    expect(forms[1]).toContain('action="/api/report-files/decline"');
    // One hidden field in all, the second form's: which page's cookie holds the token.
    expect(html.match(/<input[^>]*>/g)).toEqual([
      '<input type="hidden" name="from" value="confirm"/>',
    ]);
    expect(html.indexOf('<input')).toBeGreaterThan(html.indexOf(forms[1]!));
    expect(html).not.toContain('@');
    // The page's own action is the one primary button; the second is not drawn as one.
    expect(primaries(html)).toHaveLength(1);
  });

  it('“Don’t ask me again”, on its own page, is one form that posts no field', () => {
    const html = render('decline', { kind: 'confirm', ...LINK }, null);
    expect(html.match(/<form[^>]*>/g)).toHaveLength(1);
    expect(html).toContain('action="/api/report-files/decline"');
    expect(html).not.toMatch(/<input/);
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
