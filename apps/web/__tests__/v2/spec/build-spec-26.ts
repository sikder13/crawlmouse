/**
 * docs/specs/v2/26-dashboard-site.md, built from the code it describes: the account screens' view
 * models, the previews and who reads them, the reconciliation as each fixture measures it, every
 * difference from the locked HTML, and the routes CC-26b wires.
 */
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { WEB_ROOT } from '../_lib/tokens-css';
import { ADDITIONS, COPY_CHANGES } from '../../../lib/v2/copy-registry';
import { ACCOUNT_ACTIONS, type ActionKey } from '../../../lib/v2/view/account-actions';
import { NOT_ROLLED_BACK } from '../../../lib/v2/view/account';
import { PREVIEWS } from '../../../app/(v2-preview)/v2-preview/_preview/registry';
import {
  ACCOUNT_PREVIEWS,
  ACCOUNT_VIEWERS,
  DATASET,
  STAND_IN_FREE_ACCOUNT,
  dashboardPreview,
  shellPreview,
  sitePreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { code, readInterfaces, table } from './build-spec-22';

export const SPEC_26_PATH = join(
  WEB_ROOT,
  '..',
  '..',
  'docs',
  'specs',
  'v2',
  '26-dashboard-site.md',
);

/** The registry's screens for this spec: 'dashboard-day0', 'dashboard' and 'site'. */
const ours = (screen: string) => screen.startsWith('dashboard') || screen === 'site';

function previewSection(): string {
  const rows = Object.entries(ACCOUNT_PREVIEWS).map(([path, p]) => {
    const viewer = ACCOUNT_VIEWERS[p.viewer]();
    const entry = PREVIEWS.find((e) => e.path === path);
    if (!entry) throw new Error(`${path} is not in the registry`);
    return [
      code(path),
      entry.name,
      code(DATASET[p.viewer]),
      viewer.account ? 'stand-in (below)' : code(viewer.accountId),
      code(viewer.now),
      String(entry.orange ?? 1),
    ];
  });
  const a = STAND_IN_FREE_ACCOUNT;
  return [
    '## Preview pages and who reads them',
    '',
    'From `apps/web/app/(v2-preview)/v2-preview/_preview/accounts.ts`. Every screen renders from a contract fixture read by a viewer: an account and a moment (D1). Nothing reads a database or a cookie.',
    '',
    table(['Path', 'Name', 'Fixture', 'Account', 'Now', 'Orange elements'], rows),
    '',
    `clean-site holds no account: its one site is an unkept audit. Its previews read it as a stand-in account defined in the preview registry, not in the fixture (owner ruling Q2): id ${code(a.id)}, state ${code(a.state)}, history ${a.state_history.map((h) => code(`${h.state} since ${h.since}`)).join(', ')}, zone ${code(a.timezone)}, limits ${code(JSON.stringify(a.limits))}. It adopts the site (${code('Viewer.adopt')}), and as a Free account that never had a trial it shows the one-time offer of 14 days of Pro (H5).`,
  ].join('\n');
}

function viewModelSection(): string {
  const view = (f: string) => join(WEB_ROOT, 'lib', 'v2', 'view', f);
  const parts: [string, string, string[]][] = [
    ['The viewer', view('account.ts'), ['Viewer', 'AccountView', 'InFlight']],
    ['The account frame', view('account-shell.ts'), ['ShellView', 'NavItemView', 'TrialCardView']],
    ['An action', view('account-actions.ts'), ['ActionView', 'RouteSpec']],
    [
      'The dashboard',
      view('dashboard.ts'),
      [
        'DashboardView',
        'HeaderView',
        'StripView',
        'HealthView',
        'CountView',
        'ChangeRowView',
        'HistoryView',
        'HistoryPointView',
        'CrawlerByCheckView',
        'CrawlerNowView',
        'SitesView',
        'SiteRowView',
        'SinceCellView',
        'TopFixesView',
        'TopFixRowView',
        'SetupView',
        'SetupItemView',
      ],
    ],
    [
      'The site page',
      view('site.ts'),
      ['SiteView', 'GradeCardView', 'CrawlerGridRowView', 'FixRowView'],
    ],
    ['A grade in a table', view('checks.ts'), ['GradeCell']],
  ];
  const sections = parts.map(([title, file, names]) => {
    const read = readInterfaces(file, names);
    return [
      `### ${title}`,
      '',
      ...names.flatMap((name) => [
        `#### ${code(name)}`,
        '',
        table(
          ['Field', 'Type', 'Note'],
          read.get(name)!.map((f) => [code(f.path), code(f.type), f.doc]),
        ),
        '',
      ]),
    ].join('\n');
  });
  return [
    '## View models',
    '',
    'From `apps/web/lib/v2/view`, read through the TypeScript compiler. The screens receive these and nothing else from a fixture.',
    '',
    sections.join('\n'),
  ].join('\n');
}

function rulesSection(): string {
  return [
    '## How the views read the data',
    '',
    'Each rule names the function that keeps it and the test that pins it.',
    '',
    table(
      ['Rule', 'Where', 'Pinned by'],
      [
        [
          'A viewer sees its own account’s records and none recorded after its moment. Sites by `created_at`, checks that ended by then (one still running is listed in `inFlight`, not in the history), changes by `detected_at`, fix events by `at`, fixes first seen at a check that ended by then, each with the status its last event up to then gives it. An account read before its first state is an error; read during a trial it has since left, it carries that trial’s end.',
          '`viewAt` (`lib/v2/view/account.ts`)',
          '`account.test.ts` (the fixture given back at its own `as_of`; one case per fix event kind; a past trial); `account.property.test.ts` (every record timestamp and a millisecond either side, re-parsed with the contract schema; the datasets are the fixtures’ own, only the moment varies)',
        ],
        [
          'Day 0 is the moment the account can first be read: its first state, or the end of its first audit if that is later (owner ruling Q9).',
          '`firstRunNow`',
          '`account.test.ts`',
        ],
        [
          'The primary site is the oldest site that is not another site’s staging copy, the one Free keeps (ARCH-2 §3.2). Staging copies hold no site slot (ARCH-2 §2.5, owner ruling Q10).',
          '`primarySite`, `primarySites`',
          '`account.test.ts`, `account-shell.test.ts`',
        ],
        [
          'A site’s changes since its previous check are the ones found at its latest result that compare with an earlier check; a first audit’s findings are not changes (owner ruling Q5).',
          '`siteWindow` (`lib/v2/view/account-shell.ts`)',
          '`dashboard.test.ts`, `account.property.test.ts`',
        ],
        [
          'Headline = rows = cells: the strip’s Opened and Resolved counts sum to the rows of "What changed, by site", which equal the sites table’s cells and the rail’s "N new" (D5).',
          '`dashboardView`, `newChanges`',
          '`dashboard.test.ts` (each fixture), `account.property.test.ts` (every moment)',
        ],
        [
          'Health is the mean of both grades over the sites whose latest result carries both, rounded. The move is the same mean over the sites graded at both moments, at the primary site’s previous result, leaving out a site on a first baseline: one with no result then, or a `baseline` change since. Those are counted beside the move, “1 new” (owner ruling 2026-11-08). Sites left out of the mean are counted by reason, AI readability withheld first (D5).',
          '`health`, `healthAt`, `moveOver`, `firstBaselines` (`lib/v2/view/dashboard.ts`)',
          '`dashboard.test.ts` (743 / 10 = 74; the move over four sites, 606 / 8 → 76 and 591 / 8 → 74, redbirdaviation.com “1 new”; a copy where counting it would make −2 into +3; challenged-site (91 + 89) / 2 = 90; bad-site at 26 Oct 19:02Z: 73, “no change since Sat”, nahltech.com “1 new”), `account.property.test.ts` (the value, the move and the new count against the raw records at every moment)',
        ],
        [
          'Dates and times are the account’s zone; days left are calendar days in it; the reminder is three calendar days before the trial ends, at the same clock time (D4, A8, owner ruling Q4). “Since” names the earlier check by its weekday, or by its date where a weekday could mean another check.',
          '`lib/v2/format.ts`: `dayDate`, `calendarDays`, `nextWeekly`, `daysBefore`; `sinceName` (`dashboard.ts`)',
          '`format.test.ts` (vectors worked across the 1 Nov change of offset); `dashboard.test.ts` (Wed 4 Nov; “Since the check of Fri 23 Oct” on the withheld dashboard)',
        ],
        [
          '"Blocked" is said only beside `disallowed_by_robots` or `blocked_by_ua_rule`, in what is seen and what is heard (FACTS I2). With no blocking verdict the site page leaves the blocked count out.',
          '`allBlocked`, `blockedOf`, `verdictCell`',
          '`verdict-copy-guard.test.tsx`, its account-screen property',
        ],
        [
          'A phone keeps only secondary text out of sight (the trial card’s note, a fix’s note), and only out of sight: it stays in the accessibility tree. Data shows at every width, the first-run fixes’ effort included, where the locked page hides it on a phone (owner ruling 2026-11-08).',
          '`PHONE_SECONDARY_FIELDS`, `phoneSecondaryTexts` (`lib/v2/view/phone-secondary.ts`); `.phoneSecondary`, TrialCard’s `.note`',
          '`phone-secondary.test.tsx` (each hidden text is one the views list as secondary; the efforts are shown), `tests/visual/layout.spec.ts` “text on a phone, at 390px” (nothing else hidden, the hidden text in the accessibility snapshot, the effort laid out)',
        ],
      ],
    ),
    '',
    `Fields \`viewAt\` keeps as the fixture’s \`as_of\` has them, because the contract records no date for a change to them. The list is written by hand from reading the contract, not derived from it (\`NOT_ROLLED_BACK\`, \`lib/v2/view/account.ts\`): ${NOT_ROLLED_BACK.map(code).join(', ')}. Day 0 shows these as they stand at \`as_of\`.`,
    '',
    'The rail’s counts are left out of the lock comparisons with the rest of the rail’s links (`nav[aria-label="Primary"]`, as on every v2 screen); `dashboard.test.tsx` checks the links’ order against the artboards and the counts against the view model. On Final-Dashboard the artboard reads “Changes 2 new”, the build “3 new”: the window holds two opened changes and one resolved.',
  ].join('\n');
}

function measuredSection(): string {
  const names = ['day0', 'home', 'clean', 'withheld'] as const;
  const rows = names.map((n) => {
    const v = dashboardPreview(n);
    const cells = v.sites.rows.reduce((s, r) => s + r.since.opened + r.since.resolved, 0);
    return [
      n,
      v.strip?.health.value ?? '—',
      v.strip?.health.delta ?? '—',
      v.strip?.health.fresh ?? '—',
      v.strip?.health.excluded ?? '—',
      String(v.strip?.opened.count ?? 0),
      String(v.strip?.resolved.count ?? 0),
      String(v.strip?.other.count ?? 0),
      String(v.changed.length),
      String(cells),
      shellPreview(n).nav.find((x) => x.label === 'Changes')!.count ?? '—',
    ];
  });
  return [
    '## The reconciliation, as the fixtures measure it',
    '',
    'Rendered from the view models at build time.',
    '',
    table(
      [
        'Dashboard',
        'Health',
        'Move',
        'New',
        'Left out',
        'Opened',
        'Resolved',
        'Other',
        'Rows',
        'Cells',
        'Rail',
      ],
      rows,
    ),
  ].join('\n');
}

function copySection(): string {
  return [
    '## Where a screen differs from its locked HTML',
    '',
    'From `apps/web/lib/v2/copy/dashboard.ts` and `copy/site.ts`, listed in `copy-registry.ts`. The lock comparisons (`__tests__/v2/dashboard.test.tsx`, `site.test.tsx`, `tests/visual/copy.spec.ts`) apply each change to the locked text and then require equality; an entry that matches nothing fails. Kind `ruling` is the owner’s ruling or this step’s brief.',
    '',
    table(
      ['Screen', 'Kind', 'Locked', 'Now', 'Why'],
      COPY_CHANGES.filter((c) => ours(c.screen)).map((c) => [
        c.screen,
        c.kind,
        c.locked,
        c.rendered || '(not rendered)',
        `${c.source}${c.hiddenOnPhone ? ' (not read at phone width, where the locked page hides it)' : ''}`,
      ]),
    ),
    '',
    'What the brief adds that no locked screen has, marked `data-v2-addition` where it renders:',
    '',
    table(
      ['Screen', 'Addition', 'Source'],
      ADDITIONS.filter((a) => ours(a.screen)).map((a) => [a.screen, a.what, a.source]),
    ),
  ].join('\n');
}

/** Every action a preview shows, by the route it targets, with the previews that show it. */
function usedOn(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const walk = (x: unknown, where: string) => {
    if (!x || typeof x !== 'object') return;
    if ('route' in x && 'href' in x && 'method' in x) {
      const route = String((x as { route: string }).route);
      if (!used.has(route)) used.set(route, new Set());
      used.get(route)!.add(where);
    }
    for (const v of Object.values(x)) walk(v, where);
  };
  for (const [path, p] of Object.entries(ACCOUNT_PREVIEWS)) {
    const where = path.replace('/v2-preview/screens/', '');
    walk(shellPreview(p.viewer), where);
    if (p.screen === 'dashboard') walk(dashboardPreview(p.viewer), where);
    else walk(sitePreview(p.viewer as 'home' | 'clean' | 'withheld'), where);
  }
  return used;
}

function wiringSection(): string {
  const used = usedOn();
  const rows = (Object.keys(ACCOUNT_ACTIONS) as ActionKey[]).map((k) => {
    const a = ACCOUNT_ACTIONS[k];
    const where = [...(used.get(a.route) ?? [])];
    return [
      code(k),
      a.verb,
      code(a.route),
      a.owner,
      a.guard,
      where.length ? where.join(', ') : 'none in these previews',
    ];
  });
  return [
    '## The routes CC-26b wires',
    '',
    'From `ACCOUNT_ACTIONS` (`apps/web/lib/v2/view/account-actions.ts`, re-exported by `dashboard.ts`; D8). A preview links a read and posts every other action; a form for a verb HTML forms lack carries it in `_method`. ARCH-2 §5 lets account forms be server actions: CC-26b chooses, on these paths. "Used on" is read from the previews’ view models.',
    '',
    table(['Action', 'Verb', 'Route', 'Built by', 'Guard', 'Used on'], rows),
  ].join('\n');
}

/** What this step leaves open, each in a sentence. */
export const KNOWN_GAPS_26 = [
  'Visual baselines for the new pages are drawn on CI’s Linux runner (the visual job uploads them when a baseline is missing) and committed from that artifact; none is drawn on a workstation.',
  'A change’s title is the change record’s own summary. The verdict guard’s account-screen property replaces verdicts at random, so it keeps the crawler changes with a neutral summary (“<crawler> changed on <host>”) rather than ones that describe the old verdicts; the titles as written are checked on the fixtures as given.',
  'The SVG chart’s own labels are hidden from assistive technology and not read by the verdict guard; its table, which is read, carries the same values.',
  'There is no perturbation sweep (CC-22’s `INVENTORY`) for these screens: their fields are pinned by values worked out by hand from the fixtures and by the lock comparisons.',
  'The site settings table stacks its rows on a phone with CSS grid on `tr`. Whether every screen reader keeps the table’s header and cell semantics through that is not verified in VoiceOver or NVDA; axe cannot tell.',
  'The fixes table writes one row’s effect as “+4 SEO” and the grouped row’s as “+7 Technical SEO together”: the grouped wording is the segment pages’ (`groupPoints`), kept so one rule words a group.',
  'Two states no fixture holds a moment of have previews built from bad-site in `_preview/accounts.ts`: an account with no site (`noSitePreview`, its site records taken out) reads day 0, and a site whose first check has not ended (`firstCheckPreview`, nahltech.com halfway through its first check) reads that check through `sitePage`. A running check with progress, and a failed or never-run first check, are reached only by `lib/v2/view/live-states.test.ts`.',
  'The property tests vary the moment over the fixtures’ own records. A refused Technical SEO score, and a site added between two checks of the primary site, are in no fixture and are not reached; the rules for them are read from the code.',
  'The clean previews read Schedule “not scheduled” for a Free account’s only site, where GATES.free.schedule and FACTS l.31 say monthly. The stand-in Free account adopts an audit no account kept, which has no schedule, and `viewAt` keeps a site’s schedule as the fixture has it (`NOT_ROLLED_BACK`). The live pages read each site’s schedule from its record (`lib/v2/account/dataset.ts`); a Free site stored with its monthly schedule reads “monthly” there (`lib/v2/account/dataset.test.ts`).',
  'The withheld site page’s one orange action is long: “Open the OAI-SearchBot, ChatGPT-User, PerplexityBot and Claude-SearchBot packet · AI not yet estimated”, about 100 characters, wrapping in a phone header. It is computed from the fix and true; shortening it (“Open fix 1’s packet”) is left to the owner (design review, round 2).',
  'Accessibility review, round 3: “On the dashboard, the crawler-by-check row and the history chart’s caption say when access changed by check number (‘allowed, thin at checks 1 to 5, then blocked by robots.txt at check 6’). The chart’s own table labels its rows by date. A screen-reader user has to count rows to match ‘check 6’ to Fri 30 Oct. The site page’s grid already reads dates; the dashboard should do the same.”',
  "Accessibility review, round 3: “Forced-colours support for the theme control’s pressed state and the alert switch is checked by reading the CSS, not in a browser. No test renders them with `forcedColors: 'active'` and confirms the switch’s track, knob and on state, or the pressed theme, can be told apart from the canvas. The existing browser test in `a11y.spec.ts` covers other screens and could be extended to the site page and the theme-control preview.”",
  'Correctness review, round 3: “On the site page, a fix that was marked done and that its re-check could not verify shows status ‘could not verify’ with no note. The note column explains only marked-done and reopened fixes, so the reader is not told when it was marked or which check failed to verify it.”',
  'Correctness review, round 3: “When `viewAt` reads an account during a trial it has since left, it takes the trial’s end as its start plus TRIAL_DAYS × 24 h, not as the start of the next state in the account’s history. The two agree on every fixture. They would differ if the change out of the trial were recorded later than 14 days after it began.”',
  'Correctness review, round 3: nothing ties `health()` to `moveOver`. Keeping `moveOver` for the sites and the later mean but computing the earlier mean inline over every site graded then stays green, because no vector runs `health()` at a moment where a site graded at the previous check is not graded now, and no fixture has such a moment. The reviewer’s fix: a copy of bad-site with nahltech.com’s latest check made AI-withheld, asserting the health delta, or a raw recomputation of the delta in the property.',
  'Correctness review, round 3: the action-context sweep (`__tests__/v2/dashboard.test.tsx`) checks that the page text contains each context string, and a change row’s Diff and Copy fix carry the identical context, so a renderer that dropped Copy fix’s hidden context would pass while Diff’s copy remains. The reviewer’s fix: count occurrences, or check each context inside its own control’s markup.',
  'Correctness and design reviews, round 3: in `lib/v2/view/dashboard.ts` the doc comment that describes `sinceName` now sits above `weekdayAmbiguous`, stacked on that function’s own comment, so an editor shows the wrong comment for both.',
  'Design review, round 3: the layout test “a header row read but not drawn takes no height” filters for heights above 0.5px only, so it passes on a page with no `thead[data-v2-hidden-head]`, or if the attribute were renamed. The by-check test beside it does assert a non-empty set.',
];

function gapsSection(): string {
  return ['## Known gaps', '', ...KNOWN_GAPS_26.map((g) => `- ${g}`)].join('\n');
}

export async function buildSpec26(): Promise<string> {
  const md = [
    '# SPEC 26 — dashboard and site page',
    '',
    '> Generated by `pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts`. Do not edit it by hand: `apps/web/__tests__/v2/spec.test.ts` fails when this file differs from what the generator writes.',
    '',
    'The first-run dashboard (day 0), the dashboard home and the site page, rebuilt from `Final-Dashboard-Day0`, `Final-Dashboard` and `Final-Site` on the CC-11 contract fixtures, as development previews. The live pages (`/dashboard` behind `V2_CHECKS_PUBLIC`, and `/sites/[id]`) render the same screens from an account’s records, read by `lib/v2/account/dataset.ts`. Every section below is read from the code it describes.',
    '',
    previewSection(),
    '',
    viewModelSection(),
    '',
    rulesSection(),
    '',
    measuredSection(),
    '',
    copySection(),
    '',
    wiringSection(),
    '',
    gapsSection(),
    '',
  ].join('\n');
  const config = (await resolveConfig(SPEC_26_PATH)) ?? {};
  return format(md, { ...config, parser: 'markdown' });
}
