/**
 * Every live form, as the view renders it, against the route's own reader of its body (CC-26b
 * round 1, item 3). `submitted()` builds what a browser sends for an action: its hidden fields, then
 * each input as the page opens with it (a select's chosen value, a text field's value or a typed
 * sample, a required checkbox ticked), leaving out a select its `while` disables. A field the view
 * names differently from the route turns the form's test red.
 */
import { describe, expect, it } from 'vitest';
import {
  dashboardPreview,
  noSitePreview,
  shellPreview,
  sitePreview,
} from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { EmailBody } from '../../lib/v2/account/fixes';
import { trialAccountId } from '../../lib/v2/account/pro-trial';
import { meantMethod } from '../../lib/v2/account/route';
import { parseAddBody, parseEditBody } from '../../lib/v2/account/sites';
import { ThemeBody } from '../../lib/v2/account/theme';
import type { ActionView } from '../../lib/v2/view/account-actions';

const TYPED: Record<string, string> = { url: 'example.com', email: 'dev@example.com' };

function submitted(a: ActionView, choose: Record<string, string> = {}): Record<string, string> {
  const fields: Record<string, string> = { ...a.fields };
  const selected: Record<string, string> = {};
  for (const i of a.inputs ?? [])
    if (i.kind === 'select') selected[i.name] = choose[i.name] ?? i.value;
  for (const i of a.inputs ?? []) {
    if (i.kind === 'select') {
      if (i.while && !i.while.values.includes(selected[i.while.name]!)) continue;
      fields[i.name] = selected[i.name]!;
    } else if (i.kind === 'text') {
      fields[i.name] = choose[i.name] ?? i.value ?? TYPED[i.name] ?? '';
    } else fields[i.name] = i.value;
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

  it('a site’s schedule: weekly or monthly with its day and hour, or none with neither', () => {
    const a = row('Schedule');
    for (const schedule of ['weekly', 'monthly']) {
      const m = asRoute(a, submitted(a, { schedule }));
      expect(m.method).toBe('PATCH');
      expect(parseEditBody(m.fields)).toMatchObject({ schedule });
    }
    const none = asRoute(a, submitted(a, { schedule: 'none' }));
    expect(none.fields).toEqual({ schedule: 'none' });
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
    expect(asRoute(a, submitted(a))).toEqual({ method: 'DELETE', fields: { confirm: 'remove' } });
  });

  it('the theme: PATCH {theme}, as the theme control posts it', () => {
    const shell = shellPreview('home');
    // ThemeControl sends `_method=PATCH` and the pressed button's `theme`.
    const m = asRoute(shell.themeAction, { _method: 'PATCH', theme: 'dark' });
    expect(m.method).toBe('PATCH');
    expect(ThemeBody.safeParse(m.fields).success).toBe(true);
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
