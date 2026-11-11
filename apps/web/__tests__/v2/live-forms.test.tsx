/**
 * Every live form, as the view renders it, against the route's own reader of its body (CC-26b
 * round 1, item 3). `submitted()` builds what a browser sends for an action: its hidden fields, then
 * each input as the page opens with it (a select's chosen value, a text field's value or a typed
 * sample, a required checkbox ticked). A field the view
 * names differently from the route turns the form's test red.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThemeControl } from '../../components/v2/ThemeControl';
import {
  dashboardPreview,
  noSitePreview,
  shellPreview,
  sitePreview,
} from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { EmailBody } from '../../lib/v2/account/fixes';
import { trialAccountId } from '../../lib/v2/account/pro-trial';
import { meantMethod } from '../../lib/v2/account/route';
import { isRemoveConfirmed, parseAddBody, parseEditBody } from '../../lib/v2/account/sites';
import { ThemeBody } from '../../lib/v2/account/theme';
import type { ActionView } from '../../lib/v2/view/account-actions';

const TYPED: Record<string, string> = { url: 'example.com', email: 'dev@example.com' };

function submitted(a: ActionView, choose: Record<string, string> = {}): Record<string, string> {
  const fields: Record<string, string> = { ...a.fields };
  for (const i of a.inputs ?? []) {
    if (i.kind === 'select') fields[i.name] = choose[i.name] ?? i.value;
    else if (i.kind === 'text') fields[i.name] = choose[i.name] ?? i.value ?? TYPED[i.name] ?? '';
    else fields[i.name] = i.value;
  }
  return fields;
}

/** What the route reads after `meantMethod`: the verb a form names and the fields without it. */
function asRoute(a: ActionView, fields: Record<string, string>) {
  return meantMethod(new Request(`https://crawlmouse.com${a.href}`, { method: 'POST' }), {
    kind: 'form',
    fields,
  });
}

const site = sitePreview('home');
const row = (label: string) => site.settings.rows.find((r) => r.label === label)!.action!;

describe('each live form posts what its route reads', () => {
  it('add a site (day 0 and the home): {url}', () => {
    for (const add of [
      noSitePreview().header.actions[0]!,
      dashboardPreview('home').header.actions[0]!,
    ]) {
      expect(add.route).toBe('/api/sites');
      expect(parseAddBody(asRoute(add, submitted(add)).fields)).toEqual({ url: 'example.com' });
    }
  });

  it('a site’s schedule: weekly or monthly with its day and hour, none, its day and hour dropped', () => {
    const a = row('Schedule');
    for (const schedule of ['weekly', 'monthly']) {
      const m = asRoute(a, submitted(a, { schedule }));
      expect(m.method).toBe('PATCH');
      expect(parseEditBody(m.fields)).toMatchObject({ schedule });
    }
    // Without script the form sends its day and hour with none too; the parser drops them.
    const none = asRoute(a, submitted(a, { schedule: 'none' }));
    expect(Object.keys(none.fields).sort()).toEqual(['dow', 'hour', 'schedule']);
    expect(parseEditBody(none.fields)).toEqual({ schedule: 'none' });
  });

  it('a site’s competitors and staging URL', () => {
    for (const label of ['Competitor', 'Staging']) {
      const a = row(label);
      const m = asRoute(a, submitted(a));
      expect(m.method).toBe('PATCH');
      expect(parseEditBody(m.fields)).not.toBeNull();
    }
  });

  it('remove a site: DELETE with the confirmation ticked, and nothing else', () => {
    const a = row('Remove this site');
    const m = asRoute(a, submitted(a));
    expect(m.method).toBe('DELETE');
    expect(isRemoveConfirmed(m.fields)).toBe(true);
  });

  it('the theme: what the theme control renders, each of its buttons, PATCH {theme}', () => {
    const shell = shellPreview('home');
    const html = renderToStaticMarkup(
      <ThemeControl initial={shell.theme} action={shell.themeAction.href} />,
    );
    const attrs = (tag: string) =>
      Object.fromEntries([...tag.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const form = attrs(html.match(/<form[^>]*>/)![0]);
    expect(form.action).toBe(shell.themeAction.href);
    const hidden = (html.match(/<input[^>]*>/g) ?? [])
      .map(attrs)
      .filter((a) => a.type === 'hidden');
    const buttons = (html.match(/<button[^>]*>/g) ?? [])
      .map(attrs)
      .filter((a) => a.type === 'submit');
    expect(buttons.length).toBe(3);
    for (const b of buttons) {
      // A pressed submit button sends its own name and value with the form's hidden fields.
      const fields = {
        ...Object.fromEntries(hidden.map((h) => [h.name!, h.value!])),
        [b.name!]: b.value!,
      };
      const m = asRoute(shell.themeAction, fields);
      expect(m.method).toBe('PATCH');
      expect(ThemeBody.safeParse(m.fields).success, JSON.stringify(m.fields)).toBe(true);
    }
  });

  it('start the trial: {accountId}', () => {
    const start = dashboardPreview('clean').startPro!.start;
    expect(trialAccountId(submitted(start))).not.toBeNull();
  });

  it('email to my developer: {email}', () => {
    const email = dashboardPreview('home')
      .changed.flatMap((c) => c.actions)
      .find((a) => a.route === '/api/fixes/[id]/email-developer')!;
    expect(EmailBody.safeParse(submitted(email)).success).toBe(true);
  });

  it('mark done and run a check send no field: their routes read none, and run-check refuses one', () => {
    const mark = site.fixes.rows.find((r) => r.markDone)!.markDone!;
    expect(submitted(mark)).toEqual({});
    const run = site.header.actions.find((a) => a.route === '/api/sites/[id]/checks')!;
    expect(submitted(run)).toEqual({});
  });
});
