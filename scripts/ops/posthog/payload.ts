import {
  DATE_FROM_DAYS,
  questionId,
  type ActionSpec,
  type BehavioralFilter,
  type Breakdown,
  type CohortSpec,
  type DashboardSpec,
  type FlagSpec,
  type InsightSpec,
  type PropertyFilter,
  type Series,
  type SurveySpec,
} from './spec';

/**
 * The spec's objects as PostHog's private API takes them. `Ids` resolves a name the payload refers
 * to (an action in an insight, the flag a survey is behind, an insight's dashboard) to its id.
 */
export interface Ids {
  action(name: string): number | string;
  flag(name: string): number | string;
  dashboard(name: string): number | string;
}

type Json = Record<string, unknown>;

export function propertyFilter(f: PropertyFilter): Json {
  return {
    key: f.key,
    type: f.type,
    operator: f.operator,
    ...('value' in f ? { value: f.value } : {}),
  };
}

function behavioral(f: BehavioralFilter): Json {
  return {
    type: 'behavioral',
    key: f.event,
    value: 'performed_event',
    event_type: 'events',
    time_value: f.withinDays,
    time_interval: 'day',
    negation: false,
  };
}

export function actionPayload(a: ActionSpec): Json {
  return {
    name: a.name,
    description: a.description,
    steps: a.steps.map((s) => ({
      event: s.event,
      properties: (s.filters ?? []).map(propertyFilter),
    })),
  };
}

export function cohortPayload(c: CohortSpec): Json {
  return {
    name: c.name,
    description: c.description,
    is_static: false,
    filters: {
      properties: {
        type: 'OR',
        values: c.groups.map((g) => ({
          type: 'AND',
          values: g.map((f) => (f.type === 'behavioral' ? behavioral(f) : propertyFilter(f))),
        })),
      },
    },
  };
}

const flagFilters = (conditions: readonly PropertyFilter[]) => ({
  groups: [{ properties: conditions.map(propertyFilter), rollout_percentage: 100 }],
});

export function flagPayload(f: FlagSpec): Json {
  return { key: f.key, name: f.name, active: true, filters: flagFilters(f.conditions) };
}

export function surveyPayload(s: SurveySpec, ids: Ids): Json {
  return {
    name: s.name,
    description: s.description,
    type: s.type,
    schedule: s.schedule,
    linked_flag_id: ids.flag(s.linkedFlag),
    targeting_flag_filters: s.targeting.length === 0 ? null : flagFilters(s.targeting),
    questions: s.questions.map((q, i) => ({
      id: questionId(s.name, i),
      type: q.type,
      question: q.question,
      optional: q.optional,
      ...(q.type === 'single_choice' ? { choices: q.choices } : {}),
    })),
    conditions: s.trigger
      ? { events: { values: [{ name: s.trigger }], repeatedActivation: false } }
      : null,
    appearance: s.widgetSelector
      ? { widgetType: 'selector', widgetSelector: s.widgetSelector }
      : null,
  };
}

export function dashboardPayload(d: DashboardSpec): Json {
  return { name: d.name, description: d.description };
}

function seriesNode(s: Series, ids: Ids): Json {
  const label = s.label ? { custom_name: s.label } : {};
  if ('action' in s) {
    return {
      kind: 'ActionsNode',
      id: ids.action(s.action),
      name: s.action,
      math: s.math ?? 'total',
      ...label,
    };
  }
  return {
    kind: 'EventsNode',
    event: s.event,
    name: s.event,
    math: s.math ?? 'total',
    ...(s.mathProperty ? { math_property: s.mathProperty } : {}),
    properties: (s.filters ?? []).map(propertyFilter),
    ...label,
  };
}

function entity(s: Series, ids: Ids): Json {
  return 'action' in s
    ? { id: ids.action(s.action), type: 'actions', name: s.action }
    : {
        id: s.event,
        type: 'events',
        name: s.event,
        properties: (s.filters ?? []).map(propertyFilter),
      };
}

const breakdownFilter = (b?: Breakdown) =>
  b ? { breakdownFilter: { breakdown: b.key, breakdown_type: b.type } } : {};

const common = { dateRange: { date_from: `-${DATE_FROM_DAYS}d` }, filterTestAccounts: true };

export function insightQuery(i: InsightSpec, ids: Ids): Json {
  switch (i.kind) {
    case 'trend':
      return {
        kind: 'InsightVizNode',
        source: {
          kind: 'TrendsQuery',
          series: i.series.map((s) => seriesNode(s, ids)),
          interval: i.interval,
          ...common,
          ...breakdownFilter(i.breakdown),
          ...(i.formula ? { trendsFilter: { formula: i.formula } } : {}),
        },
      };
    case 'funnel':
      return {
        kind: 'InsightVizNode',
        source: {
          kind: 'FunnelsQuery',
          series: i.steps.map((s) => seriesNode(s, ids)),
          ...common,
          ...breakdownFilter(i.breakdown),
          funnelsFilter: {
            funnelOrderType: 'ordered',
            funnelWindowInterval: i.windowDays,
            funnelWindowIntervalUnit: 'day',
            ...(i.aggregateBy ? { funnelAggregateByHogQL: i.aggregateBy } : {}),
          },
        },
      };
    case 'retention':
      return {
        kind: 'InsightVizNode',
        source: {
          kind: 'RetentionQuery',
          ...common,
          retentionFilter: {
            period: 'Week',
            totalIntervals: i.weeks,
            retentionType: 'retention_first_time',
            targetEntity: entity(i.start, ids),
            returningEntity: entity(i.returning, ids),
          },
        },
      };
    case 'table':
      return {
        kind: 'DataTableNode',
        source: {
          kind: 'EventsQuery',
          event: i.event,
          select: i.columns.map((c) => c.expr),
          where: [...i.where],
          orderBy: ['timestamp DESC'],
          limit: i.limit,
          after: `-${DATE_FROM_DAYS}d`,
          filterTestAccounts: true,
        },
      };
  }
}

export function insightPayload(i: InsightSpec, dashboard: string, ids: Ids): Json {
  return {
    name: i.name,
    description: i.description,
    query: insightQuery(i, ids),
    dashboards: [ids.dashboard(dashboard)],
  };
}
