/**
 * The agency screens (CC-31 D5). The client matrix against Final-Ag-Matrix and the client page
 * against Final-Ag-Client: the visible text equals the locked HTML with the registered changes
 * applied (lib/v2/copy/agency.ts) and nothing else. Then each state of `/agency` as its preview
 * renders it: the orange element the registry says it has, the routes its forms post to, and what
 * a reader of that state is and is not offered.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/registry';
import { AGENCY_MONTHLY } from '../../lib/billing/prices';
import { GATES } from '../../lib/entitlement-v2';
import { ACCOUNT_ACTIONS } from '../../lib/v2/view/account-actions';
import { CC31_ELEMENTS } from './_lib/screens';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const render = (path: string) => renderToStaticMarkup(CC31_ELEMENTS[path]!());
const main = (html: string) => html.slice(html.indexOf('<main'));
const primaries = (html: string) => html.match(/data-v2-primary=""/g) ?? [];
const MATRIX = '/v2-preview/screens/agency';
const CLIENT = '/v2-preview/screens/agency/client';
const state = (name: string) => `${MATRIX}/${name}`;

const ROUTES = Object.values(ACCOUNT_ACTIONS).map(
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
    expect(hrefs.filter((h) => h === '/agency/reports')).toHaveLength(2);
    expect(hrefs).toContain('/seats');
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
  const ours = PREVIEWS.filter((p) => p.path.startsWith(MATRIX));

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
