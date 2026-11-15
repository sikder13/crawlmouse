import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  CONSENT_GATES,
  DISTINCT_ID_KINDS,
  EVENT_REGISTRY,
  SURVEY_TRIGGERS,
  type EventEntry,
  type Sender,
} from '../../../apps/web/lib/analytics-registry';
import { POSTHOG_HOST, REQUIRED_SCOPES } from './client';
import {
  DATE_FROM_DAYS,
  PREFIX,
  SPEC,
  responseKey,
  type BehavioralFilter,
  type Breakdown,
  type InsightSpec,
  type PostHogSpec,
  type PropertyFilter,
  type Series,
  type SurveySpec,
} from './spec';

/**
 * Writes docs/analytics/posthog.md from the spec and docs/analytics/events.md from the events
 * registry (OPERATING-RULES §10: prose that names data is rendered from it).
 *
 *   pnpm ops:posthog:docs
 *
 * The text is formatted with the repo's Prettier settings, so the files pass CI's Prettier check.
 * render.test.ts fails when either file differs from what this renders.
 */
export const POSTHOG_DOC = fileURLToPath(
  new URL('../../../docs/analytics/posthog.md', import.meta.url),
);
export const EVENTS_DOC = fileURLToPath(
  new URL('../../../docs/analytics/events.md', import.meta.url),
);

const code = (s: string | number) => `\`${s}\``;
const cell = (s: string) => s.replace(/\|/g, '\\|');

const OPERATOR: Record<PropertyFilter['operator'], [one: string, many: string]> = {
  exact: ['=', 'is one of'],
  is_not: ['≠', 'is none of'],
  regex: ['matches', 'matches'],
  not_regex: ['does not match', 'does not match'],
  gte: ['≥', '≥'],
  lte: ['≤', '≤'],
  is_not_set: ['is not set', 'is not set'],
};

export function filterText(f: PropertyFilter | BehavioralFilter): string {
  if (f.type === 'behavioral') return `sent ${code(f.event)} in the last ${f.withinDays} days`;
  const [one, many] = OPERATOR[f.operator];
  const subject = `${f.type} ${code(f.key)}`;
  if (f.value === undefined) return `${subject} ${one}`;
  if (Array.isArray(f.value)) {
    const values = (f.value as readonly string[]).map(code).join(', ');
    return f.value.length === 1 ? `${subject} ${one} ${values}` : `${subject} ${many} ${values}`;
  }
  return `${subject} ${one} ${code(f.value as string | number)}`;
}

const allOf = (filters: readonly (PropertyFilter | BehavioralFilter)[]) =>
  filters.map(filterText).join(' and ');

export function seriesText(s: Series): string {
  const what = 'action' in s ? `action ${s.action}` : code(s.event);
  const where = 'filters' in s && s.filters?.length ? ` where ${allOf(s.filters)}` : '';
  const math =
    s.math === undefined || s.math === 'total'
      ? ''
      : 'mathProperty' in s && s.mathProperty
        ? ` (${s.math} of ${code(s.mathProperty)})`
        : ` (${s.math})`;
  const label = s.label ? ` as "${s.label}"` : '';
  return `${what}${where}${math}${label}`;
}

const breakdownText = (b?: Breakdown) => (b ? `${b.type} ${code(b.key)}` : '—');

function insightWhat(i: InsightSpec): string {
  const letter = (n: number) => String.fromCharCode(65 + n);
  switch (i.kind) {
    case 'trend': {
      const series = i.series.map((s, n) => `${letter(n)}: ${seriesText(s)}`).join('; ');
      return `${series}, by ${i.interval}${i.formula ? `; plotted as ${code(i.formula)}` : ''}`;
    }
    case 'funnel': {
      const steps = i.steps.map((s, n) => `${n + 1}. ${seriesText(s)}`).join(' → ');
      const by = i.aggregateBy ? `; counted by ${code(i.aggregateBy)}` : '';
      return `${steps}; within ${i.windowDays} days${by}`;
    }
    case 'retention':
      return `starts with ${seriesText(i.start)}, returns with ${seriesText(i.returning)}; ${i.weeks} weeks`;
    case 'table':
      return `the latest ${i.limit} ${code(i.event)} events where ${i.where.map(code).join(' and ')}; columns ${i.columns.map((c) => c.label).join(', ')}`;
  }
}

function surveySection(s: SurveySpec): string[] {
  const shown = s.trigger
    ? `a popover, shown after the browser event ${code(s.trigger)}`
    : s.type === 'widget'
      ? `a widget, opened by a click on ${code(s.widgetSelector ?? '')}`
      : 'a popover, shown when the targeting holds';
  const targeting = s.targeting.length ? `, and ${allOf(s.targeting)}` : '';
  return [
    `### ${s.name}`,
    '',
    s.description,
    '',
    `- Type: ${shown}.`,
    `- Schedule: ${code(s.schedule)}.`,
    `- Who: people the flag ${s.linkedFlag} admits${targeting}.`,
    '',
    '| # | Question | Type | Choices | Optional | Answer property |',
    '| - | -------- | ---- | ------- | -------- | --------------- |',
    ...s.questions.map(
      (q, n) =>
        `| ${n + 1} | ${cell(q.question)} | ${code(q.type)} | ${q.type === 'single_choice' ? q.choices.join(' / ') : '—'} | ${q.optional ? 'yes' : 'no'} | ${code(responseKey(s.name, n))} |`,
    ),
    '',
  ];
}

export function renderPostHogDoc(spec: PostHogSpec = SPEC): string {
  return [
    '# PostHog setup',
    '',
    '<!-- Rendered by `pnpm ops:posthog:docs` from scripts/ops/posthog/spec.ts. Do not edit by hand. -->',
    '',
    `Applied by \`pnpm ops:posthog\` (run \`pnpm ops:posthog --dry-run\` first). Objects are matched by name, and each name starts with ${code(PREFIX.trim())}.`,
    '',
    '## API',
    '',
    `- Host: ${POSTHOG_HOST}, \`Authorization: Bearer <POSTHOG_PERSONAL_API_KEY>\`.`,
    '- Project: `POSTHOG_PROJECT_ID`. Both are read from the environment or `scripts/.env.local`.',
    `- Personal API key scopes: ${REQUIRED_SCOPES.map(code).join(', ')}.`,
    '',
    '## Test-account filter',
    '',
    'An insight that filters out test accounts counts an event only when each of these holds:',
    '',
    ...spec.testAccountFilters.map((f) => `- ${filterText(f)}`),
    '',
    '## Actions',
    '',
    '| Action | Matches | Description |',
    '| ------ | ------- | ----------- |',
    ...spec.actions.map(
      (a) =>
        `| ${a.name} | ${cell(a.steps.map((s) => seriesText(s)).join(', or '))} | ${cell(a.description)} |`,
    ),
    '',
    '## Cohorts',
    '',
    '| Cohort | A person is in it when | Description |',
    '| ------ | ---------------------- | ----------- |',
    ...spec.cohorts.map(
      (c) => `| ${c.name} | ${cell(c.groups.map(allOf).join('; or '))} | ${cell(c.description)} |`,
    ),
    '',
    '## Feature flags',
    '',
    '| Flag | Key | Matches | Description |',
    '| ---- | --- | ------- | ----------- |',
    ...spec.flags.map(
      (f) =>
        `| ${f.name} | ${code(f.key)} | ${cell(allOf(f.conditions))} | ${cell(f.description)} |`,
    ),
    '',
    '## Surveys',
    '',
    ...spec.surveys.flatMap(surveySection),
    '## Dashboards',
    '',
    `Each insight looks back ${DATE_FROM_DAYS} days and filters out test accounts.`,
    '',
    ...spec.dashboards.flatMap((d) => [
      `### ${d.name}`,
      '',
      d.description,
      '',
      '| Insight | Kind | What | Breakdown | Description |',
      '| ------- | ---- | ---- | --------- | ----------- |',
      ...d.insights.map(
        (i) =>
          `| ${i.name} | ${i.kind} | ${cell(insightWhat(i))} | ${'breakdown' in i ? breakdownText(i.breakdown) : '—'} | ${cell(i.description)} |`,
      ),
      '',
    ]),
  ].join('\n');
}

function idText(s: Sender): string {
  const d = s.distinctId;
  return 'fallback' in d ? `${d.kind} (${cell(d.fallback)})` : d.kind;
}

function eventRows(name: string, e: EventEntry): string[] {
  const trigger = e.surveyTrigger ?? '—';
  if (e.senders.length === 0) {
    return [`| ${code(name)} | none | — | — | — | — | ${trigger} |`];
  }
  return e.senders.map(
    (s) =>
      `| ${code(name)} | ${s.side} | ${code(s.file)} | ${idText(s)} | ${s.consent} | ${s.properties.length ? s.properties.map(code).join(', ') : '—'} | ${trigger} |`,
  );
}

export function renderEventsDoc(registry: Record<string, EventEntry> = EVENT_REGISTRY): string {
  return [
    '# Funnel events',
    '',
    '<!-- Rendered by `pnpm ops:posthog:docs` from apps/web/lib/analytics-registry.ts. Do not edit by hand. -->',
    '',
    'One row per sender. "Named in" is the file, under `apps/web`, that writes the event name at its send. An event with sender "none" is one no source file names. A server event\'s own properties are listed; `captureServerEvent` (`lib/analytics-server.ts`) adds `account_id`, `internal`, `$process_person_profile` and `$geoip_disable` to what it sends.',
    '',
    '## Distinct ids',
    '',
    ...Object.entries(DISTINCT_ID_KINDS).map(([k, v]) => `- ${code(k)}: ${v}.`),
    '',
    '## Consent gates',
    '',
    ...Object.entries(CONSENT_GATES).map(([k, v]) => `- ${code(k)}: ${v}.`),
    '',
    '## Survey triggers',
    '',
    ...Object.entries(SURVEY_TRIGGERS).map(([k, v]) => `- ${code(k)}: ${v}.`),
    '',
    '## Events',
    '',
    '| Event | Sender | Named in | Distinct id | Consent | Properties | Survey trigger |',
    '| ----- | ------ | -------- | ----------- | ------- | ---------- | -------------- |',
    ...Object.entries(registry).flatMap(([name, e]) => eventRows(name, e)),
    '',
  ].join('\n');
}

/** `text` as Prettier formats the Markdown file at `path`. */
export async function formatted(text: string, path: string): Promise<string> {
  return format(text, { ...(await resolveConfig(path)), filepath: path });
}

/** Each doc's path and its formatted rendering. */
export async function renderDocs(): Promise<[path: string, text: string][]> {
  return [
    [POSTHOG_DOC, await formatted(renderPostHogDoc(), POSTHOG_DOC)],
    [EVENTS_DOC, await formatted(renderEventsDoc(), EVENTS_DOC)],
  ];
}

const readOrNull = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [path, text] of await renderDocs()) {
    const same = readOrNull(path) === text;
    if (!same) writeFileSync(path, text);
    console.log(`${same ? 'unchanged' : 'wrote'} ${path}`);
  }
}
