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
import { INVITE_LINK_DAYS } from '../../lib/v2/agency/seats';
import { ROLE_ROWS } from '../../lib/v2/copy/seats';
import { inviteView, seatsView } from '../../lib/v2/view/seats';
import { numberWord } from '../../lib/v2/words';
import { CC31_SEAT_ELEMENTS } from './_lib/screens';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const OWNER = '/v2-preview/screens/seats';
const PRO_FULL = '/v2-preview/screens/seats/pro-full';
const FREE = '/v2-preview/screens/seats/free';
const MEMBER = '/v2-preview/screens/seats/member';
const PAID = '/v2-preview/screens/seats/paid';

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
    const paid = seatsPreview(PAID).people.foot;
    expect(paid).toBe(`One seat free. Beyond five, ${usd(EXTRA_SEAT)} a seat a month.`);
    expect(paid).toBe('One seat free. Beyond five, $12 a seat a month.');
    expect(seatsPreview(PAID).buy!.line).toBe(
      `${usd(EXTRA_SEAT)} a month for each seat beyond five, ${usd(EXTRA_SITE)} a month for each site beyond ${GATES.agency.sites}, up to ${GATES.agency.maxSites} sites.`,
    );
  });

  it('draws the buy form while the plan is paid, and not for the same account past due, which the route would refuse', () => {
    const state = (path: typeof OWNER | typeof PAID) => {
      const p = SEATS_PREVIEWS[path];
      const at = Date.parse(p.viewer().now);
      const account = p.data().accounts.find((a) => a.id === p.viewer().accountId)!;
      return account.state_history.filter((h) => Date.parse(h.since) <= at).at(-1)!.state;
    };
    expect([state(PAID), seatsPreview(PAID).buy === null]).toEqual(['agency', false]);
    expect([state(OWNER), seatsPreview(OWNER).buy === null]).toEqual(['past_due', true]);
    // Past due, the owner still invites and reads the same people; the foot says what the price of
    // a seat waits for, which is why no form is drawn.
    expect(seatsPreview(OWNER).invite).not.toBeNull();
    expect(seatsPreview(OWNER).people.rows).toEqual(seatsPreview(PAID).people.rows);
    expect(seatsPreview(OWNER).people.foot).toBe(
      'One seat free. Beyond five, $12 a seat a month, once the plan’s last payment has gone through.',
    );
  });

  it('says what an invitation is: one email with a link, for as many days as the link works', () => {
    expect(v.people.mailNote).toBe(
      `An invitation is one email with a link to accept it. The link works for ${numberWord(INVITE_LINK_DAYS)} days.`,
    );
    expect(v.people.mailNote).toBe(
      'An invitation is one email with a link to accept it. The link works for seven days.',
    );
    expect(v.people.mailNote).not.toContain('sign-in email');
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
    expect(seatsPreview(PAID).buy).toMatchObject({
      action: '/api/billing/seats',
      seats: { value: 0 },
      sites: { value: 0, max: GATES.agency.maxSites - GATES.agency.sites },
    });
  });

  it('in its Agency trial an account is offered no buy form, and the foot says when extras can be bought', () => {
    const p = SEATS_PREVIEWS[OWNER];
    const d = p.data();
    const viewer = p.viewer();
    const trial = {
      ...d,
      accounts: d.accounts.map((a) =>
        a.id === viewer.accountId
          ? {
              ...a,
              state: 'agency_trial' as const,
              trial_ends_at: '2026-11-20T00:00:00Z',
              // The view reads the state the history holds at the viewer's moment.
              state_history: [{ state: 'agency_trial' as const, since: a.state_history[0]!.since }],
            }
          : a,
      ),
    };
    const v = seatsView(trial, viewer, { seatLimit: 5, billing: true });
    expect(v.buy).toBeNull();
    expect(v.people.foot).toBe(
      `One seat free. Beyond five, ${usd(EXTRA_SEAT)} a seat a month, once the trial has become the plan.`,
    );
    // The same account on the plan, paid, is offered the form.
    expect(
      seatsView(d, SEATS_PREVIEWS[PAID].viewer(), { seatLimit: 5, billing: true }).buy,
    ).not.toBeNull();
  });

  it('a seat whose only client was removed covers none, and says so; the others count the clients still there', () => {
    const p = SEATS_PREVIEWS[OWNER];
    const d = p.data();
    const base = seatsView(d, p.viewer(), { seatLimit: 5, billing: false });
    expect(base.people.rows.map((r) => r.clients)).toEqual([
      'all 2',
      '1 · granitepeak.example',
      '1 · harborlight.example',
      'all 2',
    ]);
    // The account's live sites without granitepeak: its seat_sites rows stay, as a removal leaves them.
    const removed = { ...d, sites: d.sites.filter((x) => x.host !== 'granitepeak.example') };
    expect(
      seatsView(removed, p.viewer(), { seatLimit: 5, billing: false }).people.rows.map(
        (r) => r.clients,
      ),
    ).toEqual(['all 1', 'none', '1 · harborlight.example', 'all 1']);
  });

  it('takes the seat limit it is given over the account’s own', () => {
    const p = SEATS_PREVIEWS[PAID];
    const full = seatsView(p.data(), p.viewer(), { seatLimit: 4 });
    expect(full.header.line).toMatch(/^4 of 4 used/);
    expect(full.people.foot).toBe('No seat free. Beyond five, $12 a seat a month.');
    expect(full.header.invite).toBeNull();
    expect(full.invite).toBeNull();
  });
});

describe('seatsView: who is offered the buy form, on an account where seats and sites are sold', () => {
  // Northwind while its plan is paid: the state the purchase route changes. At the fixture's as_of
  // the account is past due and no reader is offered the form, so the role and the switch are read
  // here, where they are what decides.
  const p = SEATS_PREVIEWS[PAID];
  const d = p.data();
  const seat = (name: string) => d.seats.find((s) => s.name === name)!;
  const buyFor = (
    seatId: string | undefined,
    data: typeof d = d,
    options: { billing?: boolean } = {},
  ) => seatsView(data, { ...p.viewer(), ...(seatId ? { seatId } : {}) }, options).buy;

  it('the owner is, by their own seat and as a preview reads', () => {
    expect(seat('Alex').role).toBe('owner');
    expect(buyFor(seat('Alex').id)).toMatchObject({ id: 'buy', action: '/api/billing/seats' });
    expect(buyFor(undefined)).toEqual(buyFor(seat('Alex').id));
  });

  it('a developer and an account manager are not, whether the seat covers every client or some', () => {
    expect([seat('Lee').role, seat('Lee').client_scope]).toEqual(['developer', 'all']);
    expect(buyFor(seat('Lee').id)).toBeNull();
    expect(seat('Priya').role).toBe('account_manager');
    expect(seat('Priya').client_scope).not.toBe('all');
    expect(buyFor(seat('Priya').id)).toBeNull();
    // The same manager with every client: the scope is not what refuses them.
    const everyClient = {
      ...d,
      seats: d.seats.map((s) =>
        s.id === seat('Priya').id ? { ...s, client_scope: 'all' as const } : s,
      ),
    };
    expect(buyFor(seat('Priya').id, everyClient)).toBeNull();
    expect(buyFor(seat('Alex').id, everyClient)).not.toBeNull();
  });

  it('nobody is with billing switched off (V2_BILLING), the owner included', () => {
    expect(buyFor(seat('Alex').id, d, { billing: false })).toBeNull();
    expect(buyFor(undefined, d, { billing: false })).toBeNull();
    expect(buyFor(seat('Alex').id, d, { billing: true })).not.toBeNull();
  });

  it('nobody is on a plan the records do not say renews: one set to end, or with no subscription', () => {
    // `accountFromRow` writes `renews_at: null` for both, and the purchase route refuses both (409
    // `subscription_ending`, `no_subscription`). The state stays `agency`.
    const account = d.accounts.find((a) => a.id === p.viewer().accountId)!;
    expect(account.renews_at).not.toBeNull();
    const ending = {
      ...d,
      accounts: d.accounts.map((a) => (a.id === account.id ? { ...a, renews_at: null } : a)),
    };
    expect(buyFor(seat('Alex').id, ending)).toBeNull();
    expect(buyFor(undefined, ending)).toBeNull();
    // The owner still invites: an invitation changes no subscription.
    expect(seatsView(ending, p.viewer()).invite).not.toBeNull();
    // The foot counts the free seats and prices none: the records do not say which of the two it
    // is, so it names no cause.
    expect(seatsView(ending, p.viewer()).people.foot).toBe('One seat free.');
    expect(seatsView(d, p.viewer()).people.foot).toBe(
      'One seat free. Beyond five, $12 a seat a month.',
    );
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
    // One seat is "seat": the title's noun follows the limit.
    expect(v.people.title).toBe('People · 1 of 1 seat');
    expect(seatsPreview(PRO_FULL).people.title).toBe('People · 2 of 2 seats');
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

describe('seatsView: a reader whose seat covers some clients', () => {
  it('is shown their own seat and the owner’s, and no count of seats they cannot read', () => {
    const p = SEATS_PREVIEWS[OWNER];
    const d = p.data();
    const priya = d.seats.find((s) => s.name === 'Priya')!;
    expect(priya.client_scope).not.toBe('all');
    const v = seatsView(d, { ...p.viewer(), seatId: priya.id });
    expect(v.people.rows.map((r) => r.person)).toEqual(['Alex', 'You, Priya']);
    expect(v.header.line).toBe(
      'Your seat and the owner’s. A seat that covers some clients is not shown the others.',
    );
    expect(v.people.title).toBe('People');
    expect(v.people.foot).toBeNull();
    expect(`${v.header.line} ${v.people.title}`).not.toMatch(/\d/);
    expect([v.header.invite, v.invite, v.buy]).toEqual([null, null, null]);
  });

  it('is told the owner covers all clients, with no count: the reader’s records hold their own clients alone', () => {
    const p = SEATS_PREVIEWS[OWNER];
    const d = p.data();
    const sam = d.seats.find((s) => s.name === 'Sam')!;
    expect(sam.client_scope).toHaveLength(1);
    // What Sam's session reads of Northwind's two clients (spec 31 §4): the one his seat covers.
    const read = { ...d, sites: d.sites.filter((s) => sam.client_scope.includes(s.id)) };
    expect(d.sites.filter((s) => s.account_id === sam.account_id)).toHaveLength(2);
    const cells = (v: ReturnType<typeof seatsView>) =>
      v.people.rows.map((r) => [r.person, r.clients]);
    expect(cells(seatsView(read, { ...p.viewer(), seatId: sam.id }))).toEqual([
      ['Alex', 'all clients'],
      ['You, Sam', '1 · harborlight.example'],
    ]);
    // A reader whose seat covers every client reads every client, and is given the count.
    expect(cells(seatsView(d, p.viewer()))[0]).toEqual(['You, Alex', 'all 2']);
    expect(cells(seatsPreview(MEMBER))[0]).toEqual(['Alex', 'all 2']);
  });
});

describe('the screens, as their previews render them', () => {
  const entries = PREVIEWS.filter((p) => /\/screens\/(seats|invite)(\/|$)/.test(p.path));

  it('has an element for each preview the registry lists', () => {
    expect(Object.keys(CC31_SEAT_ELEMENTS).sort()).toEqual(entries.map((p) => p.path).sort());
    expect(entries).toHaveLength(9);
  });

  it.each(entries.map((p) => [p.path, p.orange ?? 1] as const))(
    '%s has %i orange element',
    (path, orange) => {
      expect(primaries(renderToStaticMarkup(CC31_SEAT_ELEMENTS[path]!()))).toHaveLength(orange);
    },
  );

  it('Seats: the orange element is the link to the invite form, and each form posts to a seat route', () => {
    const html = renderToStaticMarkup(CC31_SEAT_ELEMENTS[PAID]!());
    expect(primaries(html)).toEqual([expect.stringMatching(/href="#invite"[^>]*>Invite someone$/)]);
    expect(html).toMatch(/<section[^>]* id="invite"/);
    expect(forms(html.slice(html.indexOf('<main')))).toEqual([
      ['post', '/api/seats'],
      ['post', '/api/billing/seats'],
    ]);
    // Past due, the same account is drawn the invite form and no buy form.
    const pastDue = renderToStaticMarkup(CC31_SEAT_ELEMENTS[OWNER]!());
    expect(forms(pastDue.slice(pastDue.indexOf('<main')))).toEqual([['post', '/api/seats']]);
    expect(pastDue).not.toMatch(/<section[^>]* id="buy"/);
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
    const owner = live(PAID);
    expect(forms(owner.slice(owner.indexOf('<main')))).toHaveLength(3 * 2 + 2);
  });

  it('Seats, live: each seat’s Save, new invitation and removal name the seat after the label', () => {
    const buttons = (path: keyof typeof SEATS_PREVIEWS) => {
      const html = renderToStaticMarkup(
        <LiveActions>
          <SeatsScreen data={seatsPreview(path)} />
        </LiveActions>,
      ).replace(/^[\s\S]*<main/, '<main');
      return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({
        // What a screen reader reads, and what is drawn: the name is in a visually hidden span.
        name: m[1]!.replace(/<[^>]+>/g, ''),
        seen: m[1]!.replace(/<span[^>]*data-v2-sr-only[^>]*>[\s\S]*?<\/span>/g, ''),
      }));
    };
    const paid = buttons(PAID).filter((b) => /^(Save|Remove)/.test(b.seen));
    expect(paid.map((b) => b.name)).toEqual([
      'Save Priya',
      'Remove from the account Priya',
      'Save Sam',
      'Remove from the account Sam',
      'Save Lee',
      'Remove from the account Lee',
    ]);
    expect(new Set(paid.map((b) => b.seen))).toEqual(new Set(['Save', 'Remove from the account']));
    // An invitation: the seat is named by its address, on the new invitation too.
    expect(
      buttons(PRO_FULL)
        .filter((b) => /^(Save|Send a new|Remove)/.test(b.seen))
        .map((b) => b.name),
    ).toEqual([
      'Save dev@company.com',
      'Send a new invitation dev@company.com',
      'Remove from the account dev@company.com',
    ]);
  });

  it('Seats, a member who is not the owner: no form, past due and while the plan is paid', () => {
    const paid = SEATS_PREVIEWS[PAID];
    const lee = SEATS_PREVIEWS[MEMBER].viewer().seatId!;
    for (const data of [
      seatsPreview(MEMBER),
      // Where the owner is drawn the buy form: the developer is drawn none.
      seatsView(paid.data(), { ...paid.viewer(), seatId: lee }),
    ]) {
      const html = renderToStaticMarkup(
        <LiveActions>
          <SeatsScreen data={data} />
        </LiveActions>,
      );
      expect(forms(html.slice(html.indexOf('<main')))).toEqual([]);
      expect(html).not.toMatch(/<section[^>]* id="buy"/);
      expect(html).toContain('What each role can do');
    }
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
      lines: [
        'It was accepted, replaced by a newer one, removed, or it has expired. The account’s owner can send another.',
      ],
      notice: 'gone',
    });
  });

  it('a page that holds no link names none of those causes: it says to open the mailed link again', () => {
    expect(inviteView('no_link', false)).toEqual({
      state: 'no_link',
      title: 'This page holds no invitation',
      lines: [
        'A page keeps an invitation for a short while after its link is opened, in the browser that opened it. Open the link in the invitation email again.',
      ],
      notice: null,
    });
  });
});

describe('Seats against Final-Ag-Seats', () => {
  it('reads as the locked HTML outside the rail’s links, with each registered change and nothing else', () => {
    const html = renderToStaticMarkup(CC31_SEAT_ELEMENTS[OWNER]!());
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Ag-Seats.dc.html')).rest, 'agency-seats'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });
});
