/**
 * Seats (Final-Ag-Seats) and the invitation page: the view over the fixtures, typed out by hand
 * where the locked screen says what a cell holds, and the screens as their previews render them.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/registry';
import {
  INVITE_PREVIEWS,
  SEATS_PREVIEWS,
  seatsPreview,
} from '../../app/(v2-preview)/v2-preview/_preview/seats';
import { LiveActions } from '../../components/v2/screens/account/LiveActions';
import { SeatsScreen } from '../../components/v2/screens/seats/SeatsScreen';
import { EXTRA_SEAT, EXTRA_SITE, usd } from '../../lib/billing/prices';
import { GATES } from '../../lib/entitlement-v2';
import { gateMessage } from '../../lib/v2/agency/gates';
import { SEAT_GUARD } from '../../lib/v2/agency/guard';
import { ROLE_ROWS } from '../../lib/v2/copy/seats';
import { inviteView, seatsView } from '../../lib/v2/view/seats';
import { CC31_SEAT_ELEMENTS } from './_lib/screens';

const OWNER = '/v2-preview/screens/seats';
const PRO_FULL = '/v2-preview/screens/seats/pro-full';
const FREE = '/v2-preview/screens/seats/free';
const MEMBER = '/v2-preview/screens/seats/member';

const primaries = (html: string) => html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
const forms = (html: string) =>
  [...html.matchAll(/<form [^>]*>/g)].map(([tag]) => [
    tag.match(/ method="([^"]+)"/)?.[1],
    tag.match(/ action="([^"]+)"/)?.[1],
  ]);

describe('seatsView: an Agency account read by its owner (Northwind)', () => {
  const v = seatsPreview(OWNER);

  it('counts the seats that are not removed against the limit, and names the roles', () => {
    expect(v.header.line).toBe('4 of 5 used · owner, 2 account managers, 1 developer');
    expect(v.people.title).toBe('People · 4 of 5 seats');
  });

  it('lists each person with their role, the clients they cover and where their alerts go', () => {
    expect(
      v.people.rows.map((r) => [r.person, r.email, r.role, r.clients, r.alerts, r.invited]),
    ).toEqual([
      [
        'You, Alex',
        'alex@northwind-digital.example',
        'Owner · billing, branding, seats',
        'all 2',
        'email',
        false,
      ],
      [
        'Priya',
        'priya@northwind-digital.example',
        'Account manager',
        '1 · granitepeak.example',
        'email, Slack',
        false,
      ],
      [
        'Sam',
        'sam@northwind-digital.example',
        'Account manager',
        '1 · harborlight.example',
        'email',
        false,
      ],
      [
        'Lee',
        'lee@northwind-digital.example',
        'Developer · packets only, no client email',
        'all 2',
        'Slack',
        false,
      ],
    ]);
  });

  it('prices a seat beyond the plan from prices.ts, not from the artboard', () => {
    expect(v.people.foot).toBe(`One seat free. Beyond five, ${usd(EXTRA_SEAT)} a seat a month.`);
    expect(v.people.foot).toBe('One seat free. Beyond five, $12 a seat a month.');
    expect(v.buy!.line).toBe(
      `${usd(EXTRA_SEAT)} a month for each seat beyond five, ${usd(EXTRA_SITE)} a month for each site beyond ${GATES.agency.sites}, up to ${GATES.agency.maxSites} sites.`,
    );
  });

  it('says how an invitation arrives, in FACTS’ words', () => {
    expect(v.people.mailNote).toBe(
      'An invitation is the sign-in email with one extra line; nothing else is sent.',
    );
  });

  it('offers the owner the invite form, a change for each seat but their own, and the plan’s extras', () => {
    expect(v.header.invite).toEqual({ label: 'Invite someone', href: '#invite' });
    expect(v.invite).toMatchObject({ id: 'invite', action: '/api/seats' });
    expect(v.invite!.fields.sites.map((s) => s.host)).toEqual([
      'granitepeak.example',
      'harborlight.example',
    ]);
    expect(v.people.rows.map((r) => r.change !== null)).toEqual([false, true, true, true]);
    const priya = v.people.rows[1]!.change!;
    expect(priya.change.action).toBe(`/api/seats/id/${v.people.rows[1]!.key}`);
    expect(priya.change.fields).toMatchObject({ role: 'account_manager', scopeValue: 'some' });
    expect(priya.change.fields.sites.map((s) => s.ticked)).toEqual([true, false]);
    expect(priya.resend).toBeNull();
    expect(v.buy).toMatchObject({
      action: '/api/billing/seats',
      seats: { value: 0 },
      sites: { value: 0, max: GATES.agency.maxSites - GATES.agency.sites },
    });
  });

  it('takes the seat limit it is given over the account’s own, and leaves the buy form out with billing off', () => {
    const p = SEATS_PREVIEWS[OWNER];
    const full = seatsView(p.data(), p.viewer(), { seatLimit: 4, billing: false });
    expect(full.header.line).toMatch(/^4 of 4 used/);
    expect(full.people.foot).toBe('No seat free. Beyond five, $12 a seat a month.');
    expect(full.header.invite).toBeNull();
    expect(full.invite).toBeNull();
    expect(full.buy).toBeNull();
  });
});

describe('seatsView: the role table', () => {
  it('is the locked screen’s, each row answered by SEAT_GUARD', () => {
    const v = seatsPreview(OWNER);
    expect(v.roles.columns).toEqual(['Can', 'Owner', 'Account manager', 'Developer']);
    // Final-Ag-Seats.dc.html, "What each role can do", typed out.
    expect(v.roles.rows.map((r) => [r.can, ...r.cells])).toEqual([
      ['See audits and packets', true, true, true],
      ['Mark fixes done, run checks', true, true, true],
      ['Edit and send client reports', true, true, false],
      ['Add or remove client sites', true, true, false],
      ['Branding, seats, billing', true, false, false],
    ]);
    for (const row of ROLE_ROWS) {
      if (row.action === null) continue;
      expect(
        (['owner', 'account_manager', 'developer'] as const).map((role) =>
          SEAT_GUARD[role].includes(row.action!),
        ),
      ).toEqual(v.roles.rows.find((r) => r.can === row.can)!.cells);
    }
  });
});

describe('seatsView: the other readers', () => {
  it('a Pro account with no seat free: the gate message, an invitation in the table, no invite form', () => {
    const v = seatsPreview(PRO_FULL);
    expect(v.header.line).toBe('2 of 2 used · owner, 1 developer');
    expect(v.people.foot).toBe(gateMessage('seats', 'pro'));
    expect(v.header.invite).toBeNull();
    expect(v.invite).toBeNull();
    expect(v.buy).toBeNull();
    const invitation = v.people.rows[1]!;
    expect([invitation.person, invitation.email, invitation.invited]).toEqual([
      'dev@company.com',
      null,
      true,
    ]);
    expect(invitation.change!.resend).toEqual({
      action: `/api/seats/id/${invitation.key}/resend`,
      label: 'Send a new invitation',
    });
  });

  it('a Free account: the gate message and no form', () => {
    const v = seatsPreview(FREE);
    expect(v.header.line).toBe('1 of 1 used · owner');
    expect(v.people.foot).toBe(gateMessage('seats', 'free'));
    expect([v.header.invite, v.invite, v.buy]).toEqual([null, null, null]);
  });

  it('a member who is not the owner: the people and the role table, and nothing to act on', () => {
    const v = seatsPreview(MEMBER);
    expect(v.people.rows.map((r) => r.person)).toEqual(['Alex', 'Priya', 'Sam', 'You, Lee']);
    expect(v.people.rows.every((r) => r.change === null)).toBe(true);
    expect([v.header.invite, v.invite, v.buy]).toEqual([null, null, null]);
    expect(v.roles.rows).toHaveLength(ROLE_ROWS.length);
  });
});

describe('the screens, as their previews render them', () => {
  const entries = PREVIEWS.filter((p) => /\/screens\/(seats|invite)(\/|$)/.test(p.path));

  it('has an element for each preview the registry lists', () => {
    expect(Object.keys(CC31_SEAT_ELEMENTS).sort()).toEqual(entries.map((p) => p.path).sort());
    expect(entries).toHaveLength(8);
  });

  it.each(entries.map((p) => [p.path, p.orange ?? 1] as const))(
    '%s has %i orange element',
    (path, orange) => {
      expect(primaries(renderToStaticMarkup(CC31_SEAT_ELEMENTS[path]!()))).toHaveLength(orange);
    },
  );

  it('Seats: the orange element is the link to the invite form, and each form posts to a seat route', () => {
    const html = renderToStaticMarkup(CC31_SEAT_ELEMENTS[OWNER]!());
    expect(primaries(html)).toEqual([expect.stringMatching(/href="#invite"[^>]*>Invite someone$/)]);
    expect(html).toMatch(/<section[^>]* id="invite"/);
    expect(forms(html.slice(html.indexOf('<main')))).toEqual([
      ['post', '/api/seats'],
      ['post', '/api/billing/seats'],
    ]);
  });

  it('Seats, live: a change, a removal and, for an invitation, a resend, for each seat but the owner’s', () => {
    const live = (path: keyof typeof SEATS_PREVIEWS) =>
      renderToStaticMarkup(
        <LiveActions>
          <SeatsScreen data={seatsPreview(path)} />
        </LiveActions>,
      );
    const v = seatsPreview(PRO_FULL);
    const id = v.people.rows[1]!.key;
    const html = live(PRO_FULL).replace(/^[\s\S]*<main/, '<main');
    expect(forms(html)).toEqual([
      ['post', `/api/seats/id/${id}`],
      ['post', `/api/seats/id/${id}/resend`],
      ['post', `/api/seats/id/${id}`],
    ]);
    expect(html.match(/name="_method" value="(PATCH|DELETE)"/g)).toEqual([
      'name="_method" value="PATCH"',
      'name="_method" value="DELETE"',
    ]);
    // Three members besides the owner, none of them an invitation: two forms each, and the two below.
    const owner = live(OWNER);
    expect(forms(owner.slice(owner.indexOf('<main')))).toHaveLength(3 * 2 + 2);
  });

  it('Seats, a member who is not the owner: no form', () => {
    const html = renderToStaticMarkup(
      <LiveActions>
        <SeatsScreen data={seatsPreview(MEMBER)} />
      </LiveActions>,
    );
    expect(forms(html.slice(html.indexOf('<main')))).toEqual([]);
    expect(html).toContain('What each role can do');
  });

  it('the invitation: signed in, a form that posts no field; signed out, a link to sign in and come back', () => {
    const signedIn = renderToStaticMarkup(
      CC31_SEAT_ELEMENTS['/v2-preview/screens/invite/signed-in']!(),
    );
    expect(forms(signedIn)).toEqual([['post', '/api/seats/accept']]);
    expect(signedIn).not.toMatch(/<input/);
    const signedOut = renderToStaticMarkup(CC31_SEAT_ELEMENTS['/v2-preview/screens/invite']!());
    expect(forms(signedOut)).toEqual([]);
    expect(signedOut).toContain('href="/login?next=/invite"');
    const gone = renderToStaticMarkup(CC31_SEAT_ELEMENTS['/v2-preview/screens/invite/gone']!());
    expect(forms(gone)).toEqual([]);
    expect(gone).not.toContain('/login');
    expect(gone).toContain('This invitation cannot be used');
  });

  it('the invitation’s card shows no address', () => {
    for (const path of Object.keys(INVITE_PREVIEWS)) {
      // The card alone: the page's footer prints the support address.
      const card = /<section[\s\S]*<\/section>/.exec(
        renderToStaticMarkup(CC31_SEAT_ELEMENTS[path]!()),
      )![0];
      expect(card, path).toContain('nvit');
      expect(card, path).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });
});

describe('inviteView', () => {
  const invitation = {
    accountName: 'Summit Digital',
    role: 'account_manager',
    everyClient: true,
  } as const;

  it('says the account, the role and the scope, and what the reader does next', () => {
    expect(inviteView(invitation, true)).toEqual({
      state: 'invite',
      title: 'You are invited to Summit Digital on Crawlmouse',
      lines: [
        'As an account manager you see audits and packets, run checks, and edit and send client reports.',
        'The seat covers every client of the account.',
      ],
      notice: null,
      act: { kind: 'accept', action: '/api/seats/accept', label: 'Accept the invitation' },
    });
    expect(inviteView({ ...invitation, accountName: null }, false)).toMatchObject({
      title: 'You are invited to an account on Crawlmouse',
      act: { kind: 'sign_in', href: '/login?next=/invite' },
    });
  });

  it('a link that cannot be used offers nothing, and keeps the notice it came back with', () => {
    expect(inviteView(null, true, 'gone')).toEqual({
      state: 'gone',
      title: 'This invitation cannot be used',
      lines: [expect.any(String)],
      notice: 'gone',
    });
  });
});
