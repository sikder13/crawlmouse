import { createHash } from 'node:crypto';
import type { FunnelEvent } from '../../../apps/web/lib/analytics-events';
import { FIRST_TOUCH_FIELDS } from '../../../apps/web/lib/analytics/first-touch';
import { PERSON_SET_KEYS } from '../../../apps/web/lib/analytics/person';

/**
 * Crawlmouse's PostHog setup as data (CC-41 D6, D8a, D8b): the project's test-account filter, the
 * actions, cohorts, feature flag, surveys and dashboards. apply.ts makes the project match it;
 * render.ts writes docs/analytics/posthog.md from it. Every object's name starts with PREFIX, which is
 * how apply.ts tells its objects from anyone else's.
 */
export const PREFIX = '[cm] ';

/** The events a definition may name: ours, and the ones posthog-js sends itself. */
export type EventName = FunnelEvent | '$pageview' | '$identify' | 'survey sent' | 'survey shown';

/** The person properties the browser's identify sets (lib/analytics/person.ts, first-touch.ts). */
export const PERSON_KEYS = [
  ...PERSON_SET_KEYS,
  ...FIRST_TOUCH_FIELDS.map((f) => `ft_${f}` as const),
] as const;
export type PersonKey = (typeof PERSON_KEYS)[number];

export type Operator = 'exact' | 'is_not' | 'regex' | 'not_regex' | 'gte' | 'lte' | 'is_not_set';
export type Value = string | number | readonly string[];

export type PropertyFilter =
  | { type: 'person'; key: PersonKey; operator: Operator; value?: Value }
  | { type: 'event'; key: string; operator: Operator; value?: Value };

/** The person sent `event` at least once in the last `withinDays` days. */
export interface BehavioralFilter {
  type: 'behavioral';
  event: EventName;
  withinDays: number;
}

const person = (key: PersonKey, operator: Operator, value?: Value): PropertyFilter => ({
  type: 'person',
  key,
  operator,
  ...(value === undefined ? {} : { value }),
});
const prop = (key: string, operator: Operator, value?: Value): PropertyFilter => ({
  type: 'event',
  key,
  operator,
  ...(value === undefined ? {} : { value }),
});

export interface ActionSpec {
  name: string;
  description: string;
  /** Any one step matches. */
  steps: readonly { event: EventName; filters?: readonly PropertyFilter[] }[];
}

export interface CohortSpec {
  name: string;
  description: string;
  /** A person is in the cohort when every filter of any one group holds. */
  groups: readonly (readonly (PropertyFilter | BehavioralFilter)[])[];
}

export interface FlagSpec {
  name: string;
  key: string;
  description: string;
  /** Every condition holds, for 100% of the people it matches. */
  conditions: readonly PropertyFilter[];
}

export type Question =
  | { type: 'single_choice'; question: string; choices: readonly string[]; optional: boolean }
  | { type: 'open'; question: string; optional: boolean };

export interface SurveySpec {
  name: string;
  description: string;
  type: 'popover' | 'widget';
  /** The browser event that shows it (popover). */
  trigger?: EventName;
  /** The element whose click opens it (widget). */
  widgetSelector?: string;
  /** `once`: shown to a person until they answer or dismiss it. `always`: on every opening. */
  schedule: 'once' | 'always';
  /** The flag every survey is behind. */
  linkedFlag: string;
  /** Conditions beyond the flag's. */
  targeting: readonly PropertyFilter[];
  questions: readonly Question[];
}

export type Series =
  | {
      event: EventName;
      label?: string;
      filters?: readonly PropertyFilter[];
      math?: Math;
      mathProperty?: string;
    }
  | { action: string; label?: string; math?: Math };

export type Math = 'total' | 'dau' | 'first_time_for_user' | 'sum' | 'median';

export interface Breakdown {
  type: 'event' | 'person';
  key: string;
}

interface InsightBase {
  name: string;
  description: string;
}

export type InsightSpec =
  | (InsightBase & {
      kind: 'trend';
      series: readonly Series[];
      interval: 'day' | 'week' | 'month';
      breakdown?: Breakdown;
      /** Over the series, lettered A, B, … in order. */
      formula?: string;
    })
  | (InsightBase & {
      kind: 'funnel';
      steps: readonly Series[];
      windowDays: number;
      breakdown?: Breakdown;
      /** A HogQL expression to count by, instead of the person. */
      aggregateBy?: string;
    })
  | (InsightBase & {
      kind: 'retention';
      start: Series;
      returning: Series;
      weeks: number;
    })
  | (InsightBase & {
      kind: 'table';
      event: EventName;
      columns: readonly { label: string; expr: string }[];
      where: readonly string[];
      limit: number;
    });

export interface DashboardSpec {
  name: string;
  description: string;
  insights: readonly InsightSpec[];
}

export interface PostHogSpec {
  /** Events that pass every one are counted when an insight filters out test accounts. */
  testAccountFilters: readonly PropertyFilter[];
  actions: readonly ActionSpec[];
  cohorts: readonly CohortSpec[];
  flags: readonly FlagSpec[];
  surveys: readonly SurveySpec[];
  dashboards: readonly DashboardSpec[];
}

/** How many days an insight looks back. */
export const DATE_FROM_DAYS = 90;

// ---- Surveys: their questions carry ids of our own, so an insight can name an answer's property.

/** A question's id: a UUID derived from its survey's name and its position. */
export function questionId(survey: string, index: number): string {
  const h = createHash('sha256').update(`${survey}#${index}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** The `survey sent` property that holds the answer to question `index` of `survey`. */
export const responseKey = (survey: string, index: number) =>
  `$survey_response_${questionId(survey, index)}`;

const SURVEY_ELIGIBLE = `${PREFIX}survey-eligible`;
const FIRST_RESULT = `${PREFIX}First result`;
const FIX_CLARITY = `${PREFIX}Fix clarity`;
const PMF = `${PREFIX}PMF`;
const UPGRADE_BLOCKER = `${PREFIX}Upgrade blocker`;
const FEEDBACK = `${PREFIX}Feedback`;

const FIRST_RESULT_CHOICES = ['Yes', 'Partly', 'No'] as const;
const FIX_CLARITY_CHOICES = ['Yes', 'Needed help', 'No'] as const;
const PMF_VERY = 'Very disappointed';

/** The element the account rail's Feedback button carries (components/v2/FeedbackButton.tsx). */
export const FEEDBACK_SELECTOR = '[data-cm-feedback]';

const surveys: readonly SurveySpec[] = [
  {
    name: FIRST_RESULT,
    description: "After a person's first result page.",
    type: 'popover',
    trigger: 'result_viewed',
    schedule: 'once',
    linkedFlag: SURVEY_ELIGIBLE,
    targeting: [],
    questions: [
      {
        type: 'single_choice',
        question: "Did this show you something you didn't know about your site?",
        choices: FIRST_RESULT_CHOICES,
        optional: false,
      },
      { type: 'open', question: 'What were you hoping to find?', optional: true },
    ],
  },
  {
    name: FIX_CLARITY,
    description: 'After Mark done is confirmed (fix_done_confirmed).',
    type: 'popover',
    trigger: 'fix_done_confirmed',
    schedule: 'once',
    linkedFlag: SURVEY_ELIGIBLE,
    targeting: [],
    questions: [
      {
        type: 'single_choice',
        question: 'Was the fix clear enough to apply?',
        choices: FIX_CLARITY_CHOICES,
        optional: false,
      },
      { type: 'open', question: 'What would have made it clearer?', optional: true },
    ],
  },
  {
    name: PMF,
    description: "Sean Ellis's question, to people with some use of the product.",
    type: 'popover',
    schedule: 'once',
    linkedFlag: SURVEY_ELIGIBLE,
    targeting: [person('checks_finished', 'gte', 3), person('account_age_days', 'gte', 14)],
    questions: [
      {
        type: 'single_choice',
        question: 'How would you feel if you could no longer use Crawlmouse?',
        choices: [PMF_VERY, 'Somewhat', 'Not disappointed'],
        optional: false,
      },
      { type: 'open', question: 'What is the main benefit you get?', optional: true },
      { type: 'open', question: 'Who do you think would benefit most?', optional: true },
    ],
  },
  {
    name: UPGRADE_BLOCKER,
    description: "Late in a trial that has not paid: the account's state is still a trial.",
    type: 'popover',
    schedule: 'once',
    linkedFlag: SURVEY_ELIGIBLE,
    targeting: [
      person('plan', 'exact', ['pro_trial', 'agency_trial']),
      person('trial_day', 'gte', 10),
      person('trial_day', 'lte', 14),
    ],
    questions: [
      {
        type: 'open',
        question: 'What, if anything, is stopping you from choosing a plan?',
        optional: false,
      },
    ],
  },
  {
    name: FEEDBACK,
    description: "Opened by the account rail's Feedback button.",
    type: 'widget',
    widgetSelector: FEEDBACK_SELECTOR,
    schedule: 'always',
    linkedFlag: SURVEY_ELIGIBLE,
    targeting: [],
    questions: [
      { type: 'open', question: 'What would you like to tell us?', optional: false },
      {
        type: 'single_choice',
        question: 'What kind of feedback is it?',
        choices: ['Bug', 'Missing', 'Confusing', 'Idea'],
        optional: true,
      },
    ],
  },
];

// ---- Actions and cohorts.

const SIGN_UP = `${PREFIX}Sign-up`;
const ACTIVATION = `${PREFIX}Activation`;
const TRIAL_START = `${PREFIX}Trial start`;
const PAID = `${PREFIX}Paid`;

/** The public check path's `check_finished`; the pipeline's copy carries `source: pipeline`. */
const PUBLIC_CHECK = [prop('source', 'is_not_set')] as const;

const actions: readonly ActionSpec[] = [
  {
    name: ACTIVATION,
    description:
      "A check finished on the public check path (the home page's form and its copies), not the pipeline's copy of the event.",
    steps: [{ event: 'check_finished', filters: PUBLIC_CHECK }],
  },
  {
    name: SIGN_UP,
    description:
      'An account created: the first login that confirmed the email (account_created, sent by the Continue page).',
    steps: [{ event: 'account_created' }],
  },
  {
    name: TRIAL_START,
    description: "The no-card Pro trial started, or a card trial's subscription started.",
    steps: [
      { event: 'trial_started', filters: [prop('kind', 'exact', ['pro'])] },
      { event: 'subscription_started', filters: [prop('trial', 'exact', ['true'])] },
    ],
  },
  {
    name: PAID,
    description: 'A first paying subscription, or a trial that converted.',
    steps: [
      { event: 'subscription_started', filters: [prop('trial', 'exact', ['false'])] },
      { event: 'trial_converted' },
    ],
  },
];

/** Referrer hosts counted as social. */
export const SOCIAL_REFERRER_HOSTS = [
  'linkedin.com',
  'www.linkedin.com',
  'lnkd.in',
  'x.com',
  'twitter.com',
  't.co',
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'l.facebook.com',
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'news.ycombinator.com',
  'www.producthunt.com',
  'producthunt.com',
  'bsky.app',
  'www.threads.net',
  'threads.net',
  'www.youtube.com',
  'youtube.com',
] as const;

const cohorts: readonly CohortSpec[] = [
  {
    name: `${PREFIX}Trialists`,
    description: 'People whose account is in a trial.',
    groups: [[person('plan', 'exact', ['pro_trial', 'agency_trial'])]],
  },
  {
    name: `${PREFIX}Paying Pro`,
    description: 'People whose account is on paid Pro.',
    groups: [[person('plan', 'exact', ['pro'])]],
  },
  {
    name: `${PREFIX}Paying Agency`,
    description: 'People whose account is on paid Agency.',
    groups: [[person('plan', 'exact', ['agency'])]],
  },
  {
    name: `${PREFIX}Came from blog`,
    description: 'People whose first landing was on the blog.',
    groups: [[person('ft_landing_path', 'regex', '^/blog(/|$)')]],
  },
  {
    name: `${PREFIX}Came from social`,
    description: 'People whose first touch was tagged social, or referred by a social host.',
    groups: [
      [person('ft_utm_medium', 'exact', ['social'])],
      [person('ft_referrer_host', 'exact', SOCIAL_REFERRER_HOSTS)],
    ],
  },
  {
    name: `${PREFIX}Agencies with a client`,
    description: 'People on an Agency account who added its first client.',
    groups: [
      [
        person('plan', 'exact', ['agency_trial', 'agency']),
        { type: 'behavioral', event: 'first_client_added', withinDays: 365 },
      ],
    ],
  },
];

const flags: readonly FlagSpec[] = [
  {
    name: SURVEY_ELIGIBLE,
    key: 'cm-survey-eligible',
    description:
      'Identified people who are not internal: a person the browser never identified has no `internal` property, so does not match.',
    conditions: [person('internal', 'exact', ['false'])],
  },
];

// ---- Dashboards.

const SOURCE: Breakdown = { type: 'person', key: 'ft_utm_source' };
const REFERRER: Breakdown = { type: 'person', key: 'ft_referrer_host' };
const PLAN: Breakdown = { type: 'person', key: 'plan' };

const sent = (survey: string, ...filters: PropertyFilter[]): Series => ({
  event: 'survey sent',
  filters: [prop('$survey_name', 'exact', [survey]), ...filters],
});
const answered = (survey: string, index: number, choice: string): Series => ({
  ...sent(survey, prop(responseKey(survey, index), 'exact', [choice])),
  label: choice,
});

const pmfShare = (name: string, description: string, breakdown?: Breakdown): InsightSpec => ({
  kind: 'trend',
  name,
  description,
  series: [answered(PMF, 0, PMF_VERY), sent(PMF)],
  formula: 'A / B',
  interval: 'month',
  ...(breakdown ? { breakdown } : {}),
});

/** Every open question of every survey, for the free-text table. */
const openAnswers = surveys.flatMap((s) =>
  s.questions.flatMap((q, i) => (q.type === 'open' ? [responseKey(s.name, i)] : [])),
);
const FREE_TEXT = `coalesce(${openAnswers.map((k) => `properties['${k}']`).join(', ')})`;

const dashboards: readonly DashboardSpec[] = [
  {
    name: `${PREFIX}Acquisition`,
    description: 'Where visitors, checks and sign-ups come from.',
    insights: [
      {
        kind: 'trend',
        name: `${PREFIX}Visitors by referring domain`,
        description:
          "Unique visitors. A visitor not yet identified has no ft_ properties, so this reads the page view's own referrer.",
        series: [{ event: '$pageview', math: 'dau' }],
        interval: 'week',
        breakdown: { type: 'event', key: '$referring_domain' },
      },
      {
        kind: 'trend',
        name: `${PREFIX}Visitors by UTM source`,
        description: "Unique visitors, by the page view's own utm_source.",
        series: [{ event: '$pageview', math: 'dau' }],
        interval: 'week',
        breakdown: { type: 'event', key: 'utm_source' },
      },
      {
        kind: 'trend',
        name: `${PREFIX}Checks by first-touch source`,
        description: 'Checks started, by the person’s first-touch utm_source.',
        series: [{ event: 'check_started' }],
        interval: 'week',
        breakdown: SOURCE,
      },
      {
        kind: 'trend',
        name: `${PREFIX}Checks by first-touch referrer`,
        description: 'Checks started, by the person’s first-touch referrer host.',
        series: [{ event: 'check_started' }],
        interval: 'week',
        breakdown: REFERRER,
      },
      {
        kind: 'trend',
        name: `${PREFIX}Sign-ups by first-touch source`,
        description: 'People signing up for the first time, by first-touch utm_source.',
        series: [{ action: SIGN_UP, math: 'first_time_for_user' }],
        interval: 'week',
        breakdown: SOURCE,
      },
      {
        kind: 'trend',
        name: `${PREFIX}Sign-ups by first-touch referrer`,
        description: 'People signing up for the first time, by first-touch referrer host.',
        series: [{ action: SIGN_UP, math: 'first_time_for_user' }],
        interval: 'week',
        breakdown: REFERRER,
      },
      {
        kind: 'funnel',
        name: `${PREFIX}Blog post to sign-up`,
        description: 'From a blog page view to a sign-up, by the blog page.',
        steps: [
          { event: '$pageview', filters: [prop('$pathname', 'regex', '^/blog/')] },
          { action: SIGN_UP },
        ],
        windowDays: 30,
        breakdown: { type: 'event', key: '$pathname' },
      },
    ],
  },
  {
    name: `${PREFIX}Activation`,
    description: 'From the home page to a sign-up.',
    insights: [
      {
        kind: 'funnel',
        name: `${PREFIX}Home to sign-up`,
        description: 'Home, check started, check finished, result viewed, Keep clicked, sign-up.',
        steps: [
          { event: 'home_viewed' },
          { event: 'check_started' },
          { action: ACTIVATION },
          { event: 'result_viewed' },
          { event: 'keep_clicked' },
          { action: SIGN_UP },
        ],
        windowDays: 14,
      },
    ],
  },
  {
    name: `${PREFIX}Revenue`,
    description: 'Trials, payments, cancellations and failures.',
    insights: [
      {
        kind: 'funnel',
        name: `${PREFIX}Trial to paid`,
        description: 'A trial start, then a payment.',
        steps: [{ action: TRIAL_START }, { action: PAID }],
        windowDays: 21,
      },
      {
        kind: 'trend',
        name: `${PREFIX}New paid subscriptions`,
        description: 'First payments and trial conversions, by plan.',
        series: [{ action: PAID }],
        interval: 'week',
        breakdown: { type: 'event', key: 'plan' },
      },
      {
        kind: 'trend',
        name: `${PREFIX}New subscription amount`,
        description: "The sum of a paying checkout's amount_cents, by currency.",
        series: [
          {
            event: 'subscription_started',
            filters: [prop('trial', 'exact', ['false'])],
            math: 'sum',
            mathProperty: 'amount_cents',
          },
        ],
        interval: 'week',
        breakdown: { type: 'event', key: 'currency' },
      },
      {
        kind: 'trend',
        name: `${PREFIX}Cancellations`,
        description: 'Cancellations scheduled and subscriptions ended, by plan.',
        series: [{ event: 'subscription_canceled' }, { event: 'subscription_ended' }],
        interval: 'week',
        breakdown: { type: 'event', key: 'plan' },
      },
      {
        kind: 'trend',
        name: `${PREFIX}Failed payments`,
        description: 'Failed invoice payments, by plan.',
        series: [{ event: 'payment_failed' }],
        interval: 'week',
        breakdown: { type: 'event', key: 'plan' },
      },
    ],
  },
  {
    name: `${PREFIX}Retention`,
    description: 'Whether signed-up people come back and keep checking.',
    insights: [
      {
        kind: 'retention',
        name: `${PREFIX}Weekly return of signed-up people`,
        description: 'People who signed up, returning to any page, by week.',
        start: { action: SIGN_UP },
        returning: { event: '$pageview' },
        weeks: 8,
      },
      {
        kind: 'trend',
        name: `${PREFIX}Re-checks`,
        description: 'Checks a person started on a kept site, by trigger.',
        series: [
          {
            event: 'check_started',
            filters: [prop('trigger', 'exact', ['manual', 'fix_recheck'])],
          },
        ],
        interval: 'week',
        breakdown: { type: 'event', key: 'trigger' },
      },
      {
        kind: 'funnel',
        name: `${PREFIX}Alerts acted on`,
        description:
          'An alert sent, then a fix marked done within 7 days, counted by account: alert_sent is keyed to the account, not a person.',
        steps: [{ event: 'alert_sent' }, { event: 'fix_marked_done' }],
        windowDays: 7,
        aggregateBy: 'properties.account_id',
      },
    ],
  },
  {
    name: `${PREFIX}Agency`,
    description: 'Clients, reports and seats.',
    insights: [
      {
        kind: 'trend',
        name: `${PREFIX}Clients added`,
        description: 'First clients and sites added on Agency accounts.',
        series: [
          { event: 'first_client_added' },
          { event: 'site_added', filters: [person('plan', 'exact', ['agency_trial', 'agency'])] },
        ],
        interval: 'week',
      },
      {
        kind: 'trend',
        name: `${PREFIX}Reports generated and shared`,
        description: 'Reports generated, shared, and share links opened.',
        series: [
          { event: 'report_generated' },
          { event: 'report_shared' },
          { event: 'share_link_opened' },
        ],
        interval: 'week',
      },
      {
        kind: 'trend',
        name: `${PREFIX}Seats`,
        description: 'Seats invited, accepted and bought.',
        series: [
          { event: 'seat_invited' },
          { event: 'seat_accepted' },
          { event: 'seats_bought', math: 'sum', mathProperty: 'seats', label: 'seats bought' },
        ],
        interval: 'week',
      },
    ],
  },
  {
    name: `${PREFIX}Product health`,
    description: 'How checks end and how long they take.',
    insights: [
      {
        kind: 'trend',
        name: `${PREFIX}Check outcomes`,
        description:
          'Public-path checks by status. The event carries no failure reason; reasons are in Postgres (analytics.checks).',
        series: [{ event: 'check_finished', filters: PUBLIC_CHECK }],
        interval: 'day',
        breakdown: { type: 'event', key: 'status' },
      },
      {
        kind: 'trend',
        name: `${PREFIX}Check duration`,
        description: 'The median durationMs of public-path checks.',
        series: [
          {
            event: 'check_finished',
            filters: PUBLIC_CHECK,
            math: 'median',
            mathProperty: 'durationMs',
          },
        ],
        interval: 'day',
      },
      {
        kind: 'trend',
        name: `${PREFIX}Withheld results`,
        description: 'The share of public-path checks whose AI readability was withheld.',
        series: [
          {
            event: 'check_finished',
            filters: [...PUBLIC_CHECK, prop('withheld', 'exact', ['true'])],
          },
          { event: 'check_finished', filters: PUBLIC_CHECK },
        ],
        formula: 'A / B',
        interval: 'week',
      },
    ],
  },
  {
    name: `${PREFIX}Voice of customer`,
    description: 'What people answer, next to who they are.',
    insights: [
      {
        kind: 'trend',
        name: `${PREFIX}Survey response rate`,
        description: 'Surveys sent over surveys shown, per survey.',
        series: [
          { event: 'survey sent', filters: [prop('$survey_name', 'regex', '^\\[cm\\] ')] },
          { event: 'survey shown', filters: [prop('$survey_name', 'regex', '^\\[cm\\] ')] },
        ],
        formula: 'A / B',
        interval: 'week',
        breakdown: { type: 'event', key: '$survey_name' },
      },
      pmfShare(
        `${PREFIX}PMF very disappointed`,
        `The share of PMF answers that are "${PMF_VERY}".`,
      ),
      pmfShare(
        `${PREFIX}PMF very disappointed by plan`,
        `The share of PMF answers that are "${PMF_VERY}", by the person's plan.`,
        PLAN,
      ),
      pmfShare(
        `${PREFIX}PMF very disappointed by source`,
        `The share of PMF answers that are "${PMF_VERY}", by first-touch utm_source.`,
        SOURCE,
      ),
      {
        kind: 'trend',
        name: `${PREFIX}First result answers by source`,
        description: 'First-result answers, one series per choice, by first-touch utm_source.',
        series: FIRST_RESULT_CHOICES.map((c) => answered(FIRST_RESULT, 0, c)),
        interval: 'month',
        breakdown: SOURCE,
      },
      {
        kind: 'trend',
        name: `${PREFIX}Fix clarity answers`,
        description:
          "Fix-clarity answers, one series per choice. Not by fix type: `survey sent` does not carry the trigger's `type`.",
        series: FIX_CLARITY_CHOICES.map((c) => answered(FIX_CLARITY, 0, c)),
        interval: 'month',
      },
      {
        kind: 'table',
        name: `${PREFIX}Latest free-text answers`,
        description: 'The latest free-text answers, with the person’s plan and source.',
        event: 'survey sent',
        columns: [
          { label: 'time', expr: 'timestamp' },
          { label: 'survey', expr: 'properties.$survey_name' },
          { label: 'answer', expr: FREE_TEXT },
          { label: 'feedback kind', expr: `properties['${responseKey(FEEDBACK, 1)}']` },
          { label: 'plan', expr: 'person.properties.plan' },
          { label: 'source', expr: 'person.properties.ft_utm_source' },
        ],
        where: [`${FREE_TEXT} is not null`, "properties.$survey_name like '[cm] %'"],
        limit: 50,
      },
    ],
  },
];

export const SPEC: PostHogSpec = {
  testAccountFilters: [
    person('internal', 'is_not', ['true']),
    prop('internal', 'is_not', ['true']),
    prop('$host', 'not_regex', '\\.vercel\\.app$'),
    prop('$host', 'is_not', ['localhost', '127.0.0.1']),
  ],
  actions,
  cohorts,
  flags,
  surveys,
  dashboards,
};
