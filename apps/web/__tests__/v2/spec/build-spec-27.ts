/**
 * docs/specs/v2/27-account-screens.md, built from the code it describes: the previews and who reads
 * them, the view models, the rules each screen keeps, what the fixtures measure, every difference
 * from the locked HTML, the changes made to CC-23's and CC-26's code, and the CC-27b wiring.
 */
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { WEB_ROOT } from '../_lib/tokens-css';
import { ADDITIONS, COPY_CHANGES } from '../../../lib/v2/copy-registry';
import { ACCOUNT_ACTIONS } from '../../../lib/v2/view/account-actions';
import { CC27B_REQUIREMENTS, CC27B_ROUTES } from '../../../lib/v2/view/settings';
import { CHANGES_LOG_SINCE } from '../../../lib/v2/view/changes-log';
import { PREVIEWS } from '../../../app/(v2-preview)/v2-preview/_preview/registry';
import {
  CC27_PREVIEWS,
  alertsPreview,
  reportsPreview,
  settingsPreview,
  trialEndPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/screens';
import { code, readInterfaces, table } from './build-spec-22';
import { instant } from '@crawlmouse/types/v2';
import { fixture } from '../../../lib/v2/fixtures';
import { nextWeekly } from '../../../lib/v2/format';
import { viewAt } from '../../../lib/v2/view/account';
import { trialEndViewer } from '../../../lib/v2/view/trial-end';
import { BAD_ACCOUNT_ID } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';

export const SPEC_27_PATH = join(
  WEB_ROOT,
  '..',
  '..',
  'docs',
  'specs',
  'v2',
  '27-account-screens.md',
);

const SCREENS = ['alerts', 'reports', 'settings', 'trial-end'] as const;
const ours = (screen: string) =>
  (SCREENS as readonly string[]).includes(screen) ||
  /changes log|alerts|reports|settings/i.test(screen);

/** The brief's decisions, each with its reason (the brief asks for them in the spec). */
const DECISIONS: [string, string, string][] = [
  [
    'D1',
    'Previews only, from `fixture(name)`, viewed at a `viewer.now` the registry sets, scoped by CC-26’s `viewAt`.',
    'As CC-26 D1/D2: one reading of a fixture for every account screen.',
  ],
  [
    'D2',
    'No fixture edits. A sentence that needs a value no fixture holds renders from what is there and is registered as “not in fixture”.',
    'The fixtures are the contract’s.',
  ],
  [
    'D3',
    'The account Changes log has no artboard. It is CC-23’s change table and row builder, unchanged for the segment page, over every change of the account, newest first, with the site as the first column and three filters (site, kind, since) as links that change the page’s query.',
    'No design to lock against; the locked rows are reused.',
  ],
  [
    'D4',
    'Alerts “Fired” is computed from `changes[].notified`: one row per notified change, grouped into one message per site per check, with the channels and Slack channel the change records. “Where alerts go” and the rules read the account and its `alert_rules`; the footnote is built by iterating the messages.',
    'The contract carries notifications on the change; the fixtures hold no `alert_events`.',
  ],
  [
    'D5',
    'Reports lists the account’s reports newest first; “Covers” from `covers_check_ids`; the share link’s expiry from `share_expires_at`; sizes from `byte_count`; exports gated by `GATES[tier].exports`. The row count of a raw export is not in the fixture and is not shown.',
    'Every count from data.',
  ],
  [
    'D6',
    'Settings renders the address, name, the three kinds of email (senders from CC-25’s constants; `SIGNIN_SENDER` is magic@), the reminder date, the plan card and the danger zone; its forms post to `CC27B_ROUTES` and are stopped in the preview.',
    'As CC-26: forms to the routes the next step builds.',
  ],
  [
    'D7',
    'Trial ending is read at `trial_ends_at` less `TRIAL_REMINDER_DAYS_BEFORE_END` days. What stays and pauses comes from `GATES` and the account’s sites; the free three from CC-22’s `freeFixes`; “What Pro did” from the checks and changes between the trial’s start and `now`, each count iterated.',
    'ARCH-2 §3.2; FACTS A8 (three days); OPERATING-RULES §10.',
  ],
  [
    'D8',
    'Copy corrections carried from earlier steps: “AI readability”; Agency at $99 from `prices.ts`; dates in the account’s zone; the sign-in sender magic@ until CC-28. Each is a copy-registry row.',
    'Consistency with CC-25 and CC-26.',
  ],
  [
    'D9',
    'Record tables scroll inside their wrapper and settings tables stack on a phone (DESIGN-LOCK §7.7). The orange element stays where the artboard puts it: none of these sits in a scrolling table, which is when §7.5 moves it to the header.',
    'Design lock.',
  ],
];

/** The owner's rulings on the CC-27 plan (2026-11-08). */
const RULINGS: [string, string][] = [
  [
    '1',
    'Base: the branch holds `origin/main` through CC-26’s own merge of it (`9b1e5d3c`), reached by a fast-forward because CC-27 had no commit yet; later CC-26 pushes are merged in, never rebased. Generated specs are regenerated after every merge, never hand-merged.',
  ],
  [
    '2',
    '“Trial ending, withheld” is dropped: no account in challenged-site has a trial that overlaps a withheld result (Northwind’s Agency trial ended 1 Oct, before its sites existed; Kestrel’s ends 16 Nov with its first audit still queued). CC-26’s withheld previews cover that state.',
  ],
  [
    '3',
    'Alerts show the notifications’ send time, 06:03, as CC-26’s Site page does: a correction to FACTS H4 (“around 06:00”).',
  ],
  [
    '4',
    'Alerts keep FACTS’ pill labels (“grade moved”, “crawler blocked”, “deploy audited”), from the change’s kind and subject (`ALERT_PILLS`).',
  ],
  [
    '5',
    'Edits outside the allowed paths, additive only: CC-23’s change table exported with an optional site column (segment pages unchanged); the Switch and Select primitives; SPEC 21 regenerated; test plumbing; baselines committed only from a CI run.',
  ],
  [
    '6',
    'Routes ARCH-2 §5 lacks are CC-27b’s contract, recorded here: `PUT /api/alert-rules`, `PATCH /api/account {email_prefs}`, and one `GET /trial-ended` for both states. Previews post to stubs, not endpoints. “Send a test” and “Choose checks” are left out, as CC-27b candidates.',
  ],
  [
    '7',
    'The public audit link stays out of “Reports made”, as the artboard has it (each site page carries it).',
  ],
  [
    '8',
    'An extra preview: Reports on Northwind’s Agency account, whose client reports exercise “Scheduled”.',
  ],
  [
    '9',
    'OPERATING-RULES over the brief on the review gate: only non-blocking findings go under Known gaps; a blocker after round three goes to the owner.',
  ],
];

function decisionsSection(): string {
  return [
    '## Decisions',
    '',
    table(
      ['#', 'Decision', 'Reason'],
      DECISIONS.map(([n, d, r]) => [n, d, r]),
    ),
    '',
    '### Owner rulings on the plan',
    '',
    table(['#', 'Ruling'], RULINGS),
  ].join('\n');
}

function previewSection(): string {
  const rows = Object.entries(CC27_PREVIEWS).map(([path, p]) => {
    const entry = PREVIEWS.find((e) => e.path === path);
    if (!entry) throw new Error(`${path} is not in the registry`);
    const viewer = p.viewer();
    const oranges = entry.moments
      ? entry.moments.map((m) => `${m.name}: ${m.orange}`).join(', ')
      : String(entry.orange ?? 1);
    return [
      code(path),
      entry.name,
      code(p.fixture),
      'account' in viewer && viewer.account
        ? 'CC-26’s stand-in Free account'
        : code(viewer.accountId),
      code(viewer.now),
      oranges,
    ];
  });
  return [
    '## Preview pages and who reads them',
    '',
    'From `CC27_PREVIEWS` in `apps/web/app/(v2-preview)/v2-preview/_preview/screens.ts`, on CC-26’s viewers (`_preview/accounts.ts`). Nothing reads a database or a cookie.',
    '',
    table(['Path', 'Name', 'Fixture', 'Account', 'Now', 'Orange elements'], rows),
    '',
    trialEndMoment(),
  ].join('\n');
}

/**
 * When Trial ending is read, against the fixture's own moment, from the data: how long after the
 * `as_of`, the first weekly check due after it, and what is in flight then.
 */
function trialEndMoment(): string {
  const d = fixture('bad-site');
  const viewer = trialEndViewer(d, BAD_ACCOUNT_ID);
  const v = viewAt(d, viewer);
  const zone = v.account.timezone;
  const weekly = v.d.sites.flatMap((s) =>
    s.schedule?.cadence === 'weekly' ? [nextWeekly(s.schedule, d.as_of, zone)] : [],
  );
  const due = weekly.sort()[0];
  const between = d.checks.filter(
    (c) => instant(c.queued_at) > instant(d.as_of) && instant(c.queued_at) <= instant(viewer.now),
  );
  const host = new Map(v.d.sites.map((s) => [s.id, s.host]));
  const flight = v.inFlight.map((f) => `${host.get(f.siteId)} (${f.status})`);
  const hours = Math.round((instant(viewer.now) - instant(d.as_of)) / 3_600_000);
  return [
    `Trial ending is read ${hours} hours after bad-site’s \`as_of\` (${code(d.as_of)}).`,
    `Checks the fixture queues between the two moments: ${between.length}.`,
    due ? `The first weekly check due after the \`as_of\` is ${code(due)}.` : '',
    `In flight at the reading: ${flight.length ? flight.join(', ') : 'none'}; the screen shows no check in flight.`,
  ]
    .filter(Boolean)
    .join(' ');
}

function viewModelSection(): string {
  const view = (f: string) => join(WEB_ROOT, 'lib', 'v2', 'view', f);
  const parts: [string, string, string[]][] = [
    [
      'The Changes log',
      view('changes-log.ts'),
      ['ChangesLogView', 'ChangesLogQuery', 'FilterLinkView'],
    ],
    [
      'Alerts',
      view('alerts.ts'),
      ['AlertsView', 'FiredRowView', 'MessageView', 'ChannelRowView', 'RuleRowView'],
    ],
    ['Reports and exports', view('reports.ts'), ['ReportsView', 'MadeRowView', 'ScheduledRowView']],
    ['Settings', view('settings.ts'), ['SettingsView', 'FieldView', 'EmailKindRowView']],
    ['Trial ending', view('trial-end.ts'), ['TrialEndView', 'TrialRowView', 'DidRowView']],
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
    'From `apps/web/lib/v2/view`, read through the TypeScript compiler. The screens receive these and nothing else from a fixture; the rail is CC-26’s `ShellView`.',
    '',
    sections.join('\n'),
  ].join('\n');
}

function rulesSection(): string {
  const since = CHANGES_LOG_SINCE.map((s) => `${s.label} (${code(s.key)})`).join(', ');
  return [
    '## Rules the screens keep',
    '',
    `- **Changes log (D3).** Every change \`viewAt\` keeps, newest first by \`detected_at\`, then by id; first-audit and deploy changes included, unlike the rail’s per-site window. Filters: site (the account’s sites, oldest first), kind (the contract’s kinds the account’s changes hold, and the one asked for), since: ${since}. A site the account does not hold, a kind the contract does not name, or an unknown since is ignored. Each row is dated, since a log spans weeks.`,
    '- **A notification sent after `now` is not yet sent.** `viewAt` drops a change found after `now`, not one found before it whose notification went out later; the Changes log and Alerts read `notified` through `asSentBy`, so at 10:02:30Z the morning’s mail has not gone out.',
    '- **Alerts, Fired (D4).** One message per (site, check), newest sent first; sites within a send in the order they were added; rows by id. “N emails” counts the messages that carried email. “Open” names the problem whose fix is open: an opened change whose `fix_id` names a fix not verified resolved.',
    '- **Reports (D5).** Made: status ready or sent, `public_link` left out (ruling 7). Scheduled: status scheduled or held, by `scheduled_for`. A Link appears while `share_expires_at` is ahead of `now`. Making a report needs the exports gate; without it the card offers the plans, which is not the reader’s action and so not orange.',
    '- **Settings (D6).** Sites used are primary sites (staging holds no slot, ruling Q10) against `limits.sites`; the largest site is the most pages any latest result crawled, against `GATES[tier].pagesPerCheck`. The deletion names every site it removes, staging included. The rail’s trial card leaves the plan to the page (`plan: page`), which carries it.',
    '- **Trial ending (D7).** The window is the current trial’s `since` to `now`. Checks run: every check that finished in it. Changes caught: opened and resolved changes detected in it, problems first. Fixes closed: resolved changes in it that name a fix. What stays: the primary site, its free three, its public link, its email alerts. What pauses: the other primary sites, the staging copies (Free has no staging), the fixes beyond the three, and the paid features the account uses.',
  ].join('\n');
}

function measuredSection(): string {
  const a = alertsPreview('home');
  const r = reportsPreview('home');
  const n = reportsPreview('withheld');
  const s = settingsPreview('home');
  const t = trialEndPreview();
  const rows: string[][] = [
    [
      'Alerts',
      'messages (email / Slack only)',
      `${a.fired.messages.length} (${a.fired.messages.filter((m) => m.email).length} / ${a.fired.messages.filter((m) => !m.email).length})`,
    ],
    ['Alerts', 'Fired rows', String(a.fired.rows.length)],
    [
      'Alerts',
      'rules (on / off)',
      `${a.rules.rows.length} (${a.rules.rows.filter((x) => x.on).length} / ${a.rules.rows.filter((x) => !x.on).length})`,
    ],
    ['Reports, bad-site', 'made / scheduled', `${r.made.rows.length} / ${r.scheduled.rows.length}`],
    [
      'Reports, Northwind',
      'made / scheduled',
      `${n.made.rows.length} / ${n.scheduled.rows.length}`,
    ],
    ...s.plan.usage.map(([label, value]) => ['Settings', label, value]),
    ...t.did.rows.map((x) => ['Trial ending', x.label, x.value]),
  ];
  return [
    '## What the fixtures measure',
    '',
    'Read from the previews’ view models when this file is generated, so it cannot name a count the data does not hold.',
    '',
    table(['Screen', 'What', 'Value'], rows),
  ].join('\n');
}

function copySection(): string {
  return [
    '## Where a screen differs from its locked HTML',
    '',
    'From `apps/web/lib/v2/copy/{alerts,reports,settings,trial-end}.ts`, listed in `copy-registry.ts`. The lock comparisons (`__tests__/v2/{alerts,reports,settings,trial-end}.test.tsx`, `tests/visual/copy.spec.ts`) apply each change to the locked text and then require equality; an entry that matches nothing fails. The Changes log has no artboard (D3) and so no entries.',
    '',
    table(
      ['Screen', 'Kind', 'Locked', 'Now', 'Why'],
      COPY_CHANGES.filter((c) => (SCREENS as readonly string[]).includes(c.screen)).map((c) => [
        c.screen,
        c.kind,
        c.locked,
        c.rendered || '(not rendered)',
        `${c.source}${c.hiddenOnPhone ? ' (not read at phone width, where the locked page hides it)' : ''}`,
      ]),
    ),
    '',
    'What this step adds that no locked screen has, marked `data-v2-addition` where it renders:',
    '',
    table(
      ['Screen', 'Addition', 'Source'],
      ADDITIONS.filter((x) => ours(x.screen)).map((x) => [x.screen, x.what, x.source]),
    ),
  ].join('\n');
}

/** The changes this step makes to code earlier steps own (owner rulings 5 and the three requests). */
const OTHER_CODE: [string, string, string][] = [
  [
    'CC-26',
    '`account-shell.ts`, `copy/account.ts`',
    '`accountShellView(v, current, { plan })`: with `plan: page` the trial card keeps its dates and says only what the card on file means, with no Keep; a page that carries the plan (Settings, Trial ending) sets it. `current` may be null, for a page that is no rail entry. The “We’ll email you three days before” sentence is dropped once the reminder is due.',
  ],
  [
    'CC-26',
    '`copy/dashboard.ts`',
    '`ALERTS_FROM` removed; change notes name CC-25’s `ALERTS_SENDER`.',
  ],
  [
    'CC-26',
    '`account-actions.ts`',
    'The six routes CC-27 previews (`changeLog`, `integrations`, `plan`, `emailSettings`, `reports`, `alertRules`) are owned by CC-27b; `RouteSpec.owner` names `CC-27b`.',
  ],
  [
    'CC-23',
    '`segment/ChangesScreen.tsx`, `view/segment/changes.ts`',
    '`ChangeTable` and `rowOf` exported; `ChangeRowView.site` is optional and drawn as a leading column only when a row has it. The segment pages pass their lock tests and keep their visual baselines (`__tests__/v2/changes-log-table.test.tsx` renders the table with and without the column).',
  ],
];

function otherCodeSection(): string {
  return [
    '## Changes to earlier steps’ code',
    '',
    table(['Step', 'Files', 'Change'], OTHER_CODE),
  ].join('\n');
}

function wiringSection(): string {
  const used = new Set<string>();
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    if ('route' in x && 'href' in x && 'method' in x)
      used.add(String((x as { route: string }).route));
    for (const v of Object.values(x)) walk(v);
  };
  for (const p of Object.values(CC27_PREVIEWS)) walk(p.view());
  const route = (key: string, a: { verb: string; route: string; owner: string; guard: string }) => [
    code(key),
    a.verb,
    code(a.route),
    a.owner,
    a.guard,
    used.has(a.route) ? 'yes' : 'no',
  ];
  const cc26 = Object.entries(ACCOUNT_ACTIONS).filter(([, a]) => used.has(a.route));
  return [
    '## The CC-27b wiring',
    '',
    'The routes these previews post to or link to: CC-27b’s own (`CC27B_ROUTES` in `apps/web/lib/v2/view/settings.ts`), then those `ACCOUNT_ACTIONS` already names. “Used” is read from the previews’ view models. A form for a verb HTML forms lack carries it in `_method`.',
    '',
    table(
      ['Action', 'Verb', 'Route', 'Built by', 'Guard', 'Used'],
      [
        ...Object.entries(CC27B_ROUTES).map(([k, a]) => route(k, a)),
        ...cc26.map(([k, a]) => route(k, a)),
      ],
    ),
    '',
    'What CC-27b must hold beyond the routes (`CC27B_REQUIREMENTS`):',
    '',
    table(
      ['What', 'Rule', 'Source'],
      CC27B_REQUIREMENTS.map((x) => [x.what, x.rule, x.source]),
    ),
  ].join('\n');
}

/** What this step leaves open, each in a sentence. */
export const KNOWN_GAPS_27 = [
  '“Trial ending, withheld” is not built (owner ruling 2): no fixture account has a trial that overlaps a withheld result.',
  '`account-control-names.test.tsx` (CC-26) pins `ACCOUNT_ELEMENTS` at seven previews, so CC-27’s previews sit in `CC27_ELEMENTS` and that guard does not run on them in the suite; it was run on them once, from a copy, and passed. Request to CC-26: read the count from the registry and include `CC27_ELEMENTS`.',
  'CC-27b’s action builder (`routeAction` in `settings.ts`) repeats `action()`’s path filling, because `action()` takes only `ACCOUNT_ACTIONS` keys. Folding the two needs an `actionFor(spec, …)` export from CC-26’s `account-actions.ts`.',
  'Alerts’ highlighted first row (the artboard’s `--s2` background on the open block) is not drawn: the Table primitive has no row emphasis, and its Open is drawn as a button instead of quiet.',
  'Whether a no-card Pro trial that adds a card is charged at once or at the trial’s end is not in the fixture or ARCH-2; Trial ending keeps the artboard’s “charged on <end date>”.',
  'The blocking-verdict pair (`disallowed_by_robots`, `blocked_by_ua_rule`) is written in `alerts.ts` as well as in CC-26’s `site.ts`, which does not export it.',
];

function gapsSection(): string {
  return ['## Known gaps', '', ...KNOWN_GAPS_27.map((g) => `- ${g}`)].join('\n');
}

export async function buildSpec27(): Promise<string> {
  const md = [
    '# SPEC 27 — the account screens',
    '',
    '> Generated by `pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts`. Do not edit it by hand: `apps/web/__tests__/v2/spec.test.ts` fails when this file differs from what the generator writes.',
    '',
    'Alerts, the Changes log, Reports and exports, Settings and Trial ending, rebuilt from `Final-Alerts`, `Final-Reports`, `Final-Settings` and `Final-TrialEnd` (the Changes log has no artboard) on the CC-11 contract fixtures and CC-26’s account shell, as development previews. No live route and no API: those are CC-27b. Every section below is read from the code it describes.',
    '',
    decisionsSection(),
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
    otherCodeSection(),
    '',
    wiringSection(),
    '',
    gapsSection(),
    '',
  ].join('\n');
  const config = (await resolveConfig(SPEC_27_PATH)) ?? {};
  return format(md, { ...config, parser: 'markdown' });
}
