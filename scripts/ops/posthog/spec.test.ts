import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENT_REGISTRY } from '../../../apps/web/lib/analytics-registry';
import { FUNNEL_EVENTS } from '../../../apps/web/lib/analytics-events';
import { checkSpec } from './apply';
import {
  FEEDBACK_SELECTOR,
  PERSON_KEYS,
  PREFIX,
  SPEC,
  questionId,
  type BehavioralFilter,
  type PropertyFilter,
  type Series,
} from './spec';

const surveys = SPEC.surveys;
const byName = (name: string) => surveys.find((s) => s.name === `${PREFIX}${name}`)!;
const insights = SPEC.dashboards.flatMap((d) => d.insights);

/** Every filter in the spec, wherever it is. */
function allFilters(): (PropertyFilter | BehavioralFilter)[] {
  const fromSeries = (s: Series) => ('filters' in s ? (s.filters ?? []) : []);
  return [
    ...SPEC.testAccountFilters,
    ...SPEC.actions.flatMap((a) => a.steps.flatMap((s) => s.filters ?? [])),
    ...SPEC.cohorts.flatMap((c) => c.groups.flat()),
    ...SPEC.flags.flatMap((f) => f.conditions),
    ...surveys.flatMap((s) => s.targeting),
    ...insights.flatMap((i) =>
      i.kind === 'trend'
        ? i.series.flatMap(fromSeries)
        : i.kind === 'funnel'
          ? i.steps.flatMap(fromSeries)
          : i.kind === 'retention'
            ? [...fromSeries(i.start), ...fromSeries(i.returning)]
            : [],
    ),
  ];
}

/** Every event an action, cohort or insight counts (not a survey's trigger). */
function countedEvents(): string[] {
  const ev = (s: Series) => ('event' in s ? [s.event] : []);
  return [
    ...SPEC.actions.flatMap((a) => a.steps.map((s) => s.event)),
    ...SPEC.cohorts.flatMap((c) =>
      c.groups.flat().flatMap((f) => (f.type === 'behavioral' ? [f.event] : [])),
    ),
    ...insights.flatMap((i) =>
      i.kind === 'trend'
        ? i.series.flatMap(ev)
        : i.kind === 'funnel'
          ? i.steps.flatMap(ev)
          : i.kind === 'retention'
            ? [...ev(i.start), ...ev(i.returning)]
            : [i.event],
    ),
  ];
}

describe('the PostHog spec', () => {
  it('passes the apply’s own check: every name prefixed, none twice in a kind', () => {
    expect(() => checkSpec(SPEC)).not.toThrow();
  });

  it('filters people only on the properties the identify sets', () => {
    const keys = new Set<string>(PERSON_KEYS);
    const personal = allFilters().filter((f) => f.type === 'person');
    expect(personal.length).toBeGreaterThan(0);
    for (const f of personal) expect(keys, f.key).toContain(f.key);
    for (const i of insights) {
      if ((i.kind === 'trend' || i.kind === 'funnel') && i.breakdown?.type === 'person') {
        expect(keys, i.name).toContain(i.breakdown.key);
      }
    }
  });

  it('names only funnel events and the events posthog-js sends itself', () => {
    const allowed = new Set<string>([
      ...FUNNEL_EVENTS,
      '$pageview',
      '$identify',
      'survey sent',
      'survey shown',
    ]);
    const triggers = surveys.flatMap((s) => (s.trigger ? [s.trigger] : []));
    for (const e of [...countedEvents(), ...triggers]) expect(allowed, e).toContain(e);
  });

  it('triggers each popover survey on a browser event the registry marks as a survey trigger', () => {
    const triggers = surveys.flatMap((s) => (s.trigger ? [s.trigger] : []));
    const marked = Object.entries(EVENT_REGISTRY)
      .filter(([, e]) => e.surveyTrigger)
      .map(([n]) => n);
    expect([...triggers].sort()).toEqual([...marked].sort());
    for (const t of triggers) {
      const entry = EVENT_REGISTRY[t as keyof typeof EVENT_REGISTRY];
      expect(
        entry.senders.some((s) => s.side === 'browser'),
        t,
      ).toBe(true);
    }
  });

  it('counts no event the registry keeps for surveys only (ruling Q11)', () => {
    const onlyTriggers = Object.entries(EVENT_REGISTRY)
      .filter(([, e]) => e.surveyTrigger === 'only')
      .map(([n]) => n);
    expect(onlyTriggers).toContain('fix_done_confirmed');
    const counted = new Set(countedEvents());
    for (const e of onlyTriggers) expect(counted.has(e), e).toBe(false);
  });

  it('puts every survey behind the flag, and the flag admits identified non-internal people only', () => {
    const flag = SPEC.flags.find((f) => f.name === `${PREFIX}survey-eligible`)!;
    expect(flag.conditions).toEqual([
      { type: 'person', key: 'internal', operator: 'exact', value: ['false'] },
    ]);
    for (const s of surveys) expect(s.linkedFlag, s.name).toBe(flag.name);
  });

  it('asks the addendum’s questions, with its choices', () => {
    const q = (name: string) => byName(name).questions;
    expect(q('First result')[0]).toEqual({
      type: 'single_choice',
      question: "Did this show you something you didn't know about your site?",
      choices: ['Yes', 'Partly', 'No'],
      optional: false,
    });
    expect(q('First result')[1]).toMatchObject({
      type: 'open',
      question: 'What were you hoping to find?',
      optional: true,
    });
    expect(q('Fix clarity')[0]).toMatchObject({
      question: 'Was the fix clear enough to apply?',
      choices: ['Yes', 'Needed help', 'No'],
    });
    expect(q('Fix clarity')[1]).toMatchObject({ type: 'open', optional: true });
    expect(q('PMF').map((x) => x.question)).toEqual([
      'How would you feel if you could no longer use Crawlmouse?',
      'What is the main benefit you get?',
      'Who do you think would benefit most?',
    ]);
    expect(q('PMF')[0]).toMatchObject({
      choices: ['Very disappointed', 'Somewhat', 'Not disappointed'],
    });
    expect(q('Upgrade blocker')).toEqual([
      {
        type: 'open',
        question: 'What, if anything, is stopping you from choosing a plan?',
        optional: false,
      },
    ]);
    expect(q('Feedback')[0]).toMatchObject({ type: 'open' });
    expect(q('Feedback')[1]).toMatchObject({
      type: 'single_choice',
      choices: ['Bug', 'Missing', 'Confusing', 'Idea'],
      optional: true,
    });
  });

  it('targets the PMF and upgrade-blocker surveys as the addendum says', () => {
    expect(byName('PMF').targeting).toEqual([
      { type: 'person', key: 'checks_finished', operator: 'gte', value: 3 },
      { type: 'person', key: 'account_age_days', operator: 'gte', value: 14 },
    ]);
    expect(byName('Upgrade blocker').targeting).toEqual([
      { type: 'person', key: 'plan', operator: 'exact', value: ['pro_trial', 'agency_trial'] },
      { type: 'person', key: 'trial_day', operator: 'gte', value: 10 },
      { type: 'person', key: 'trial_day', operator: 'lte', value: 14 },
    ]);
    expect(byName('First result').trigger).toBe('result_viewed');
    expect(byName('Fix clarity').trigger).toBe('fix_done_confirmed');
  });

  it('opens the feedback survey on the attribute the account rail’s button carries', () => {
    const feedback = byName('Feedback');
    expect(feedback).toMatchObject({ type: 'widget', widgetSelector: FEEDBACK_SELECTOR });
    const button = readFileSync(
      new URL('../../../apps/web/components/v2/FeedbackButton.tsx', import.meta.url),
      'utf8',
    );
    const attribute = /FEEDBACK_ATTRIBUTE = '([^']+)'/.exec(button)?.[1];
    expect(`[${attribute}]`).toBe(FEEDBACK_SELECTOR);
  });

  it('gives each question a distinct, stable id', () => {
    const all = surveys.flatMap((s) => s.questions.map((_, i) => questionId(s.name, i)));
    expect(new Set(all).size).toBe(all.length);
    expect(questionId(`${PREFIX}PMF`, 0)).toBe(questionId(`${PREFIX}PMF`, 0));
    for (const id of all)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('lists the dashboards the brief and addendum name', () => {
    expect(SPEC.dashboards.map((d) => d.name)).toEqual(
      [
        'Acquisition',
        'Activation',
        'Revenue',
        'Retention',
        'Agency',
        'Product health',
        'Voice of customer',
      ].map((n) => `${PREFIX}${n}`),
    );
  });

  it('excludes internal people, internal events, preview hosts and local hosts from test accounts', () => {
    expect(SPEC.testAccountFilters).toEqual([
      { type: 'person', key: 'internal', operator: 'is_not', value: ['true'] },
      { type: 'event', key: 'internal', operator: 'is_not', value: ['true'] },
      { type: 'event', key: '$host', operator: 'not_regex', value: '\\.vercel\\.app$' },
      { type: 'event', key: '$host', operator: 'is_not', value: ['localhost', '127.0.0.1'] },
    ]);
  });
});

describe('[cm] Paid counts one paying subscription once, on each path', () => {
  type Sent = { event: string; properties: Record<string, unknown> };
  const paid = SPEC.actions.find((a) => a.name === '[cm] Paid')!;
  /** A step matches an event of its name whose properties pass every `exact` filter, as strings. */
  const matches = (e: Sent) =>
    paid.steps.some(
      (step) =>
        step.event === e.event &&
        (step.filters ?? []).every(
          (f) =>
            f.type === 'event' &&
            f.operator === 'exact' &&
            Array.isArray(f.value) &&
            f.value.map(String).includes(String(e.properties[f.key])),
        ),
    );
  // What lib/billing/payment-events.ts sends on each path, as payment-events.test.ts pins it.
  it.each<[string, Sent[]]>([
    [
      "a no-card trial's paying checkout",
      [
        { event: 'subscription_started', properties: { plan: 'pro', trial: false } },
        { event: 'trial_converted', properties: { plan: 'pro', via: 'checkout' } },
      ],
    ],
    [
      "a card trial's subscription turning active",
      [{ event: 'trial_converted', properties: { plan: 'agency', via: 'subscription' } }],
    ],
    [
      'a direct purchase',
      [{ event: 'subscription_started', properties: { plan: 'pro', trial: false } }],
    ],
    [
      'a card trial starting',
      [{ event: 'subscription_started', properties: { plan: 'agency', trial: true } }],
    ],
  ])('%s', (label, sent) => {
    expect(sent.filter(matches).length, label).toBe(label === 'a card trial starting' ? 0 : 1);
  });
});
