/**
 * The agency screens (CC-31 D5, D8). The client matrix against Final-Ag-Matrix, the client page
 * against Final-Ag-Client and client reports against Final-Ag-Reports: the visible text equals the
 * locked HTML with the registered changes applied (lib/v2/copy/agency.ts,
 * lib/v2/copy/client-reports.ts) and nothing else. Then each state of `/agency` and of
 * `/agency/reports` as its preview renders it: the orange element the registry says it has, the
 * routes its forms post to, and what a reader of that state is and is not offered.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  clientPreview,
  GRANITEPEAK_SITE,
  KESTREL_ACCOUNT_ID,
} from '../../app/(v2-preview)/v2-preview/_preview/agency';
import { PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/registry';
import { AGENCY_MONTHLY } from '../../lib/billing/prices';
import { GATES } from '../../lib/entitlement-v2';
import { gateMessage } from '../../lib/v2/agency/gates';
import { parseClientBody, parseScheduleBody } from '../../lib/v2/agency/schedules';
import { ClientReportsScreen } from '../../components/v2/screens/agency/ReportsScreen';
import { fixture } from '../../lib/v2/fixtures';
import { ACCOUNT_ACTIONS } from '../../lib/v2/view/account-actions';
import { agencyReportsView, CLIENT_REPORT_ROUTES } from '../../lib/v2/view/agency-reports';
import { CC31_ELEMENTS } from './_lib/screens';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const render = (path: string) => renderToStaticMarkup(CC31_ELEMENTS[path]!());
const main = (html: string) => html.slice(html.indexOf('<main'));
const primaries = (html: string) => html.match(/data-v2-primary=""/g) ?? [];
const MATRIX = '/v2-preview/screens/agency';
const CLIENT = '/v2-preview/screens/agency/client';
const state = (name: string) => `${MATRIX}/${name}`;

const REPORTS = '/v2-preview/screens/agency/reports';
const reports = (name: string) => `${REPORTS}/${name}`;

const ROUTES = [...Object.values(ACCOUNT_ACTIONS), ...Object.values(CLIENT_REPORT_ROUTES)].map(
  (a) => new RegExp(`^${a.route.replace(/\[\w+\]/g, '[^/]+')}$`),
);

/** Each form in the page: its method, where it posts and its hidden fields. */
const forms = (html: string) =>
  [...main(html).matchAll(/<form [^>]*>[\s\S]*?<\/form>/g)].map(([form]) => ({
    method: form.match(/ method="([^"]+)"/)?.[1],
    action: form.match(/ action="([^"]+)"/)?.[1],
    fields: Object.fromEntries(
      [...form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [
        m[1],
        m[2],
      ]),
    ),
  }));

describe('the client matrix against Final-Ag-Matrix', () => {
  const html = render(MATRIX);

  it('reads as the locked HTML outside the rail’s links, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Ag-Matrix.dc.html')).rest, 'agency-matrix'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('marks Clients in the agency rail, which has no Branding', () => {
    const rail = html.slice(html.indexOf('aria-label="Primary"'), html.indexOf('</nav>'));
    expect(
      [...rail.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([A-Za-z]+)/g)].map((m) => [m[2], m[1]]),
    ).toEqual([
      ['Clients', '/agency'],
      ['Changes', '/changes'],
      ['Alerts', '/alerts'],
      ['Reports', '/reports'],
      ['Seats', '/seats'],
      ['Settings', '/settings'],
    ]);
    expect(rail).toMatch(/aria-current="page"[^>]*>Clients /);
  });

  it('has one orange element: Add a client site', () => {
    expect(primaries(html)).toHaveLength(1);
    expect(html).toMatch(/data-v2-primary=""[^>]*>Add a client site · 2 of 25</);
  });

  it('links each row to its client’s page and posts its one form to the add-site route', () => {
    expect(
      [...main(html).matchAll(/<a href="(\/agency\/clients\/[^"]+)"/g)].map((m) => m[1]),
    ).toEqual([
      '/agency/clients/50000000-0000-4000-8000-0000000000c9',
      '/agency/clients/50000000-0000-4000-8000-0000000000ca',
    ]);
    expect(forms(html)).toEqual([{ method: 'post', action: '/api/sites', fields: {} }]);
  });

  it('says a withheld grade is withheld, as the dashboard does', () => {
    expect(main(html)).toMatch(/granitepeak\.example[\s\S]*?>withheld</);
  });

  it('has no price or limit of the artboard’s that the data does not hold', () => {
    expect(html).not.toContain('$69');
    expect(html).toContain(`$${AGENCY_MONTHLY} a month`);
    expect(html).toContain(`of ${GATES.agency.sites}`);
  });
});

describe('the client page against Final-Ag-Client', () => {
  const html = render(CLIENT);

  it('heads each row of Open fixes by the fix, not by its rank', () => {
    const table = new JSDOM(main(html)).window.document.querySelector(
      'table[aria-label="Open fixes"]',
    )!;
    const page = clientPreview(CLIENT);
    if (page?.kind !== 'client') throw new Error(`expected the client page, got ${page?.kind}`);
    const fixes = page.fixes.rows;
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    /** A row's header cells as text, without the "new" pill a title may carry. */
    const heads = (tr: Element) =>
      [...tr.querySelectorAll('th[scope="row"]')].map((th) => {
        const cell = th.cloneNode(true) as Element;
        for (const pill of cell.querySelectorAll('[data-v2-pill]')) pill.remove();
        return cell.textContent!.trim();
      });
    expect(rows.map(heads)).toEqual(fixes.map((f) => [f.title]));
    // The rank stays the row's first cell, as the locked screen draws it, and is not the header.
    expect(
      rows.map((tr) => [tr.firstElementChild!.tagName, tr.firstElementChild!.textContent]),
    ).toEqual(fixes.map((f) => ['TD', String(f.number)]));
    // Each row has the control its header is read with: the link to the fix's packet.
    for (const tr of rows) expect(tr.querySelector('td a, td button')).not.toBeNull();
  });

  it('draws no line under the last row’s header cell, on either of its tables', () => {
    // Table removes the last row's line from `td`; the account screens' rule does it for a row
    // header, on the tables that carry its class.
    const css = readFileSync(
      resolve(__dirname, '../../components/v2/screens/account/AccountScreen.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.rowHeaded tbody tr:last-child th \{\s*border-bottom: 0;\s*\}/);
    const doc = new JSDOM(main(html)).window.document;
    const tables = [...doc.querySelectorAll('table')];
    expect(tables.map((t) => t.getAttribute('aria-label'))).toEqual([
      'Open fixes',
      'Client settings',
    ]);
    for (const table of tables) {
      expect(table.querySelector('tbody th[scope="row"]')).not.toBeNull();
      expect(
        table.closest('[class*="rowHeaded"]'),
        table.getAttribute('aria-label')!,
      ).not.toBeNull();
    }
  });

  it('reads as the locked HTML outside the rail’s links, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Ag-Client.dc.html')).rest, 'agency-client'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('sits under Clients in the rail and has one orange element, the site page’s own', () => {
    expect(html).toMatch(/aria-current="location"[^>]*>Clients /);
    expect(primaries(html)).toHaveLength(1);
    expect(html).toMatch(/data-v2-primary=""[^>]*>Open the [^<]* packet/);
  });

  it('links the client’s settings to where they are changed, and the grades to the site page', () => {
    const hrefs = [...main(html).matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(
      hrefs.filter(
        (h) => h === '/agency/reports?client=50000000-0000-4000-8000-0000000000c9#change',
      ),
    ).toHaveLength(3);
    expect(hrefs).not.toContain('/seats');
    expect(hrefs).toContain('/sites/50000000-0000-4000-8000-0000000000c9');
  });

  it('a client with nothing open says so and lists no fix', () => {
    const clean = render(`${CLIENT}/clean`);
    expect(clean).toContain('Open fixes · 0 to raise');
    expect(clean).toContain('Nothing is open to raise with this client.');
    expect(clean).not.toMatch(/aria-label="Open fixes"/);
  });
});

describe('each agency preview', () => {
  // The matrix's own page and the pages under it: `/screens/agency-trial` (CC-29) is another screen.
  const ours = PREVIEWS.filter((p) => p.path === MATRIX || p.path.startsWith(`${MATRIX}/`));

  it('is in the registry, and the registry lists no other', () => {
    expect(ours.map((p) => p.path).sort()).toEqual(Object.keys(CC31_ELEMENTS).sort());
  });

  it.each(ours.map((p) => [p.path, p.orange ?? 1] as const))(
    '%s shows %i orange element',
    (path, orange) => {
      expect(primaries(render(path))).toHaveLength(orange);
    },
  );

  it.each(Object.keys(CC31_ELEMENTS))('%s posts each form to a known route', (path) => {
    for (const f of forms(render(path))) {
      expect(f.method).toBe('post');
      expect(
        ROUTES.some((r) => r.test(f.action!)),
        f.action,
      ).toBe(true);
    }
  });
});

describe('/agency, first run: one next step at a time', () => {
  const step = (html: string) => html.match(/data-v2-next-step="(\w+)"/)?.[1] ?? null;
  const orange = (html: string) => html.match(/data-v2-primary=""[^>]*>([^<]+)</)?.[1];

  it('no client: the header asks for the first one and its form is the orange element', () => {
    const html = render(state('no-client'));
    expect(main(html)).toContain('>Add your first client<');
    expect(orange(html)).toBe('Add a client site · 0 of 25');
    expect(step(html)).toBeNull();
    expect(main(html)).not.toContain('<table');
  });

  it('a client not checked yet: its row says so, and starting its first check is the step', () => {
    const html = render(state('not-checked'));
    expect(step(html)).toBe('check');
    expect(main(html)).toContain('>Not checked yet<');
    expect(orange(html)).toBe('Run it now');
    // The step's button and the row's: both post to the site's checks route, and no other form
    // on the page starts anything.
    expect(forms(html).filter((f) => f.action !== '/api/sites')).toEqual([
      {
        method: 'post',
        action: '/api/sites/50000000-0000-4000-8000-0000000000cb/checks',
        fields: {},
      },
      {
        method: 'post',
        action: '/api/sites/50000000-0000-4000-8000-0000000000cb/checks',
        fields: {},
      },
    ]);
  });

  it('a first check under way: the row links to it, and no step is offered', () => {
    const html = render(state('first-check'));
    expect(step(html)).toBeNull();
    expect(main(html)).toContain('>First check queued<');
    expect(main(html)).toContain('href="/audit/c0000000-0000-4000-8000-0000000000dd"');
    expect(orange(html)).toBe('Add a client site · 1 of 25');
  });

  it('a first check done and one seat: invite a colleague, on Seats', () => {
    const html = render(state('invite'));
    expect(step(html)).toBe('invite');
    expect(html).toMatch(
      /<a [^>]*href="\/seats"[^>]*data-v2-primary=""|data-v2-primary=""[^>]*href="\/seats"/,
    );
    expect(orange(html)).toBe('Open Seats');
  });

  it('seats and no report sent: send the first report', () => {
    const html = render(state('report'));
    expect(step(html)).toBe('report');
    expect(orange(html)).toBe('Open client reports');
    expect(main(html)).toContain('href="/agency/reports"');
  });

  it('with setup done there is no step', () => {
    expect(step(render(MATRIX))).toBeNull();
  });
});

describe('/agency for a reader who is not offered the matrix', () => {
  it('a seat that covers one client: that client alone, and no form to add one', () => {
    const html = render(state('scoped'));
    expect(main(html)).toContain('granitepeak.example');
    expect(main(html)).not.toContain('harborlight.example');
    expect(forms(html)).toEqual([]);
    expect(main(html)).toContain('1 client site in your seat');
    expect(main(html)).not.toContain('unused');
  });

  it('an account below Agency: the gate, with Agency’s terms from GATES and prices.ts', () => {
    const html = render(state('gate'));
    expect(html).toContain('data-v2-agency-state="gate"');
    expect(main(html)).toContain(
      `which keeps ${GATES.agency.sites} sites and ${GATES.agency.seats} seats: Agency is $${AGENCY_MONTHLY} a month.`,
    );
    expect(main(html)).toMatch(/href="\/pricing"[^>]*>Compare plans|>Compare plans</);
    expect(main(html)).not.toContain('<table');
    // The rail is the account's own, not the agency rail.
    expect(html).toMatch(/href="\/dashboard"[^>]*>Sites /);
  });

  it('acting in another account with a seat on an agency: one button, Open <agency>, which is the switch', () => {
    const html = render(state('open'));
    expect(html).toContain('data-v2-agency-state="open"');
    expect(forms(html)).toEqual([
      {
        method: 'post',
        action: '/api/seats/switch',
        fields: { accountId: 'a0000000-0000-4000-8000-0000000000c9' },
      },
    ]);
    expect(main(html)).toMatch(/data-v2-primary=""[^>]*>Open Northwind Digital</);
  });
});

describe('client reports against Final-Ag-Reports', () => {
  const html = render(REPORTS);

  it('reads as the locked HTML outside the rail’s links, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Ag-Reports.dc.html')).rest, 'agency-reports'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('sits under Reports in the agency rail, and asks nothing while each client is scheduled', () => {
    expect(html).toMatch(/aria-current="location"[^>]*>Reports/);
    expect(primaries(html)).toHaveLength(0);
  });

  it('links each client to its page, and offers its Change on this page', () => {
    const hrefs = [...main(html).matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      '/agency/clients/50000000-0000-4000-8000-0000000000c9',
      `${REPORTS}?client=50000000-0000-4000-8000-0000000000c9#change`,
      '/agency/clients/50000000-0000-4000-8000-0000000000ca',
      `${REPORTS}?client=50000000-0000-4000-8000-0000000000ca#change`,
    ]);
    // Nothing is open, so the page has no form: both contacts have confirmed.
    expect(forms(html)).toEqual([]);
  });

  it('draws nothing the step has no route for', () => {
    const text = renderedText(main(html));
    for (const gone of [
      'Hold',
      'headline',
      'Preview',
      'Opened',
      'markeddoneafter',
      'reports@',
      'trackingpixel',
    ]) {
      expect(text, gone).not.toContain(gone);
    }
    expect(html).not.toContain('$69');
  });
});

describe('client reports, a client in each state', () => {
  const html = render(reports('states'));
  const doc = new JSDOM(main(html)).window.document;
  const rowOf = (host: string) =>
    [...doc.querySelectorAll('tbody tr')].find((tr) => tr.textContent!.includes(host))!;

  it('says where each contact stands in words and as a status: colour and shape', () => {
    const state = (host: string) => {
      const row = rowOf(host);
      return [
        row.querySelector('[data-v2-contact]')?.getAttribute('data-v2-contact') ?? null,
        row.querySelector('[data-v2-pill]')?.getAttribute('data-v2-pill') ?? null,
      ];
    };
    expect(state('granitepeak.example')).toEqual(['confirmed', 'ok']);
    expect(state('harborlight.example')).toEqual(['asked', 'unverified']);
    expect(state('redbird.example')).toEqual(['not_asked', 'unverified']);
    expect(state('cedarpoint.example')).toEqual(['paused', 'warn']);
    // No contact is not a status: it is said in words alone.
    expect(state('northfield.example')).toEqual([null, null]);
    expect(rowOf('northfield.example').textContent).toContain('no contact');
    // A status pill draws its shape.
    for (const pill of doc.querySelectorAll('tbody [data-v2-pill]')) {
      expect(pill.querySelector('svg[data-v2-glyph]')).not.toBeNull();
    }
  });

  it('counts the clients by schedule in the header, from the rows under it', () => {
    const scheduled = [
      ...doc.querySelectorAll('table[aria-label="Client report schedules"] tbody tr'),
    ];
    const cells = scheduled.map((tr) => tr.children[2]!.textContent!);
    const n = (start: string) => cells.filter((c) => c.startsWith(start)).length;
    expect(cells).toHaveLength(6);
    expect(main(html)).toContain(
      `>${n('weekly')} weekly, ${n('monthly')} monthly, ${n('not scheduled')} not scheduled<`,
    );
  });

  it('has one orange element, in the header: the first client with no schedule', () => {
    expect(primaries(html)).toHaveLength(1);
    const orange = doc.querySelector('[data-v2-primary]')!;
    expect(orange.textContent).toBe('Schedule a report for maplerow.example');
    expect(orange.getAttribute('href')).toBe(
      `${reports('states')}?client=50000000-0000-4000-8000-0000000000f2#change`,
    );
    expect(orange.closest('header')).not.toBeNull();
    for (const table of main(html).match(/<table[\s\S]*?<\/table>/g)!) {
      expect(table).not.toContain('data-v2-primary');
    }
  });

  it('posts the ask and the resume of a row to that client’s routes', () => {
    const site = (n: string) =>
      `/api/report-files/schedules/site/50000000-0000-4000-8000-0000000000${n}`;
    expect(forms(html)).toEqual([
      { method: 'post', action: `${site('f1')}/resume`, fields: {} },
      { method: 'post', action: `${site('ca')}/confirm`, fields: {} },
      { method: 'post', action: `${site('f4')}/confirm`, fields: {} },
    ]);
    expect(rowOf('cedarpoint.example').textContent).toContain('Ask to confirm again');
    expect(rowOf('harborlight.example').textContent).toContain('Ask again');
    expect(rowOf('redbird.example').textContent).toContain('Ask to confirm');
  });

  it('opens a sent report that is a document at its page', () => {
    expect(main(html)).toContain('href="/reports/60000000-0000-4000-8000-0000000000c9"');
  });

  it('gives each row of Sent reports a header, its first cell', () => {
    const table = /<table[^>]*aria-label="Sent reports"[\s\S]*?<\/table>/.exec(main(html))![0];
    const rows = table.slice(table.indexOf('<tbody')).match(/<tr/g)!;
    expect(rows.length).toBeGreaterThan(0);
    expect(table.match(/<th scope="row"/g)).toHaveLength(rows.length);
  });
});

describe('client reports, one client’s forms open', () => {
  const html = render(reports('change'));
  const doc = new JSDOM(main(html)).window.document;
  const card = doc.querySelector('[data-v2-client-change]')!;
  const api = `/api/report-files/schedules/site/${GRANITEPEAK_SITE}`;
  /** A form's fields as a browser posts them, without the verb. */
  const posted = (form: Element) => {
    const fields: Record<string, string> = {};
    for (const el of form.querySelectorAll('input, select')) {
      const input = el as HTMLInputElement;
      if (input.name === '_method') continue;
      if (input.type === 'checkbox') {
        if (input.checked) fields[input.name] = 'on';
      } else fields[input.name] = input.value;
    }
    return fields;
  };
  const formAt = (action: string, verb: string) =>
    [...card.querySelectorAll('form')].find(
      (f) =>
        f.getAttribute('action') === action &&
        f.querySelector('input[name="_method"]')?.getAttribute('value') === verb,
    )!;

  it('is one card for the chosen client, with its three forms and the verb each route takes', () => {
    expect(card.querySelector('h2')!.textContent).toBe('Change Granite Peak Supply');
    expect(
      [...card.querySelectorAll('form')].map((f) => [
        f.getAttribute('method'),
        f.getAttribute('action'),
        f.querySelector('input[name="_method"]')?.getAttribute('value'),
      ]),
    ).toEqual([
      ['post', api, 'DELETE'],
      ['post', `${api}/client`, 'PATCH'],
      ['post', api, 'PUT'],
    ]);
  });

  it('posts a client the client route reads, holding what the client holds', () => {
    const fields = posted(formAt(`${api}/client`, 'PATCH'));
    expect(fields).toEqual({
      clientName: 'Granite Peak Supply',
      contactEmail: 'ops@granitepeak.example',
      ownerSeatId: 'e0000000-0000-4000-8000-0000000000ca',
    });
    expect(parseClientBody({ kind: 'form', fields })).toEqual(fields);
  });

  it('posts a schedule the schedule route reads, holding the schedule the client has', () => {
    const fields = posted(formAt(api, 'PUT'));
    expect(fields).toEqual({
      cadence: 'weekly',
      isoWeekday: '1',
      timeLocal: '08:00',
      timezone: 'America/Denver',
      sendWhenUnchanged: 'on',
    });
    expect(parseScheduleBody({ kind: 'form', fields })).toEqual({
      cadence: 'weekly',
      isoWeekday: 1,
      timeLocal: '08:00',
      timezone: 'America/Denver',
      sendWhenUnchanged: true,
    });
  });

  it('gives each field a label of its own', () => {
    const controls = [...card.querySelectorAll('input:not([type="hidden"]), select')];
    expect(controls).toHaveLength(8);
    const names = controls.map((el) => {
      const label = el.id
        ? card.querySelector(`label[for="${el.id}"]`)
        : (el.closest('label') ?? null);
      return label?.textContent?.trim() ?? '';
    });
    expect(names).toEqual([
      'Client name',
      'Contact address',
      'Owning seat',
      'How often',
      'Weekday',
      'Time',
      'Time zone',
      'Send a report when nothing changed',
    ]);
  });

  it('has one orange element, the schedule’s submit, outside any table', () => {
    expect(primaries(html)).toHaveLength(1);
    expect(card.querySelector('[data-v2-primary]')!.textContent).toBe('Save the schedule');
    expect(card.querySelector('table')).toBeNull();
    // The header's own action steps aside while a client's forms are open.
    expect(main(html)).not.toContain('Schedule a report for');
  });
});

describe('client reports for a reader who is not offered the forms', () => {
  it('a developer: the rows, with no form, no Change and no column for one', () => {
    const html = render(reports('developer'));
    expect(main(html)).toContain('granitepeak.example');
    expect(main(html)).toContain('harborlight.example');
    expect(forms(html)).toEqual([]);
    expect(main(html)).not.toContain('<form');
    expect(main(html)).not.toContain('?client=');
    expect(main(html)).not.toContain('>Change');
    expect(main(html)).not.toContain('data-v2-client-change');
    const head = main(html).match(/<thead[\s\S]*?<\/thead>/)![0];
    expect(head).not.toContain('Actions');
    expect(primaries(html)).toHaveLength(0);
  });

  it('in the Agency trial, a scheduled contact that is not the owner’s is drawn with its state and no ask', () => {
    // Kestrel Creative's one client, given a schedule and an outside contact (the fixture's has
    // neither): what the screen draws for the row the trial keeps mail from.
    const d = fixture('challenged-site');
    const weekly = d.sites.find((s) => s.id === GRANITEPEAK_SITE)!.client_report!;
    const held = {
      ...d,
      sites: d.sites.map((s) =>
        s.account_id === KESTREL_ACCOUNT_ID
          ? { ...s, client_contact_email: 'client@pinecrest.example', client_report: weekly }
          : s,
      ),
    };
    const html = renderToStaticMarkup(
      <ClientReportsScreen
        data={agencyReportsView(
          held,
          { accountId: KESTREL_ACCOUNT_ID, now: d.as_of },
          {},
          '/agency/reports',
        )}
      />,
    );
    const row = new JSDOM(main(html)).window.document.querySelector('[data-v2-contact="trial"]')!;
    expect(row.textContent).toContain('client@pinecrest.example');
    expect(row.textContent).toContain('asked to confirm once the trial has become the plan');
    // Its pill has a shape as well as a colour, as each contact state's has.
    expect(row.querySelector('[data-v2-pill] svg[data-v2-glyph]')).not.toBeNull();
    expect(forms(html).map((f) => f.action)).toEqual([]);
    expect(main(html)).not.toContain('Ask to confirm');
  });

  it('a contact that answered “Don’t ask me again” is drawn declined, by words and a shape, with no ask and no next run', () => {
    const d = fixture('challenged-site');
    const html = renderToStaticMarkup(
      <ClientReportsScreen
        data={agencyReportsView(
          d,
          // Northwind: the account that holds the Granite Peak client.
          {
            accountId: d.sites.find((s) => s.id === GRANITEPEAK_SITE)!.account_id!,
            now: d.as_of,
          },
          {},
          '/agency/reports',
          { refusals: new Map([[GRANITEPEAK_SITE, { refused: 'declined' as const }]]) },
        )}
      />,
    );
    const row = new JSDOM(main(html)).window.document.querySelector(
      '[data-v2-contact="declined"]',
    )!;
    expect(row.textContent).toContain('declined: answered “Don’t ask me again”');
    // Not the confirmed state's pill: the state is told by its words and its glyph.
    const pill = row.querySelector('[data-v2-pill]')!;
    expect(pill.getAttribute('data-v2-pill')).toBe('unverified');
    expect(pill.querySelector('svg[data-v2-glyph]')).not.toBeNull();
    const tr = row.closest('tr')!;
    expect(tr.textContent).toContain('none: the contact declined');
    expect(tr.textContent).not.toMatch(/Ask to confirm|Ask again/);
  });

  it('each table that heads its rows carries the class that takes the line off the last row’s header', () => {
    for (const file of [
      'agency/MatrixScreen.tsx',
      'agency/ClientScreen.tsx',
      'agency/ReportsScreen.tsx',
      'seats/SeatsScreen.tsx',
    ]) {
      const source = readFileSync(resolve(__dirname, '../../components/v2/screens', file), 'utf8');
      const headed = source.match(/\n\s+rowHeader(?:=\{[^}]*\})?\n/g) ?? [];
      const classed = source.match(/\n\s+className=\{shared\.rowHeaded\}\n/g) ?? [];
      expect([file, headed.length > 0, classed.length]).toEqual([file, true, headed.length]);
    }
  });

  it('an account in its Agency trial is told once where a report is sent meanwhile', () => {
    const html = render(reports('trial'));
    expect(html.match(/data-v2-trial-note=""/g)).toHaveLength(1);
    expect(main(html)).toContain('While the trial runs, a report is sent where');
    expect(render(REPORTS)).not.toContain('data-v2-trial-note');
  });

  it('an account below Agency: the gate for client reports, with Agency’s price from prices.ts', () => {
    const html = render(reports('gate'));
    expect(html).toContain('data-v2-agency-state="gate"');
    expect(main(html)).toContain('>Client reports<');
    expect(main(html)).toContain(gateMessage('clientReports', 'pro')!);
    expect(main(html)).toContain(`Agency is $${AGENCY_MONTHLY} a month.`);
    expect(main(html)).not.toContain('<table');
    expect(forms(html)).toEqual([]);
    // The rail is the account's own, not the agency rail.
    expect(html).toMatch(/href="\/dashboard"[^>]*>Sites /);
  });
});
