import type { FixtureDataset } from '@crawlmouse/types/v2';
import { siteOf } from '../../../lib/v2/fixtures';
import type { PerturbTable } from './types';

/** The first change the bad site's weekly check found: Claude-SearchBot blocked in robots.txt. */
const robots = (d: FixtureDataset) => d.changes.find((c) => c.ua === 'Claude-SearchBot')!;
const grade = (d: FixtureDataset) => d.changes.find((c) => c.subject === 'grade')!;

export const CHANGES_PERTURB: PerturbTable = {
  'changes-history': {
    'checks[].trigger': [
      { change: (c) => (c.trigger = 'manual'), expect: { changes: ['Re-run · Technical SEO B'] } },
    ],
    'checks[].finished_at': [
      {
        change: (c) => (c.finished_at = '2026-10-25T02:36:00Z'),
        expect: { changes: ['25 Oct 2026, 02:36 UTC'] },
      },
    ],
    'checks[].technical_seo.score': [
      {
        change: (c) => (c.technical_seo!.score = 78),
        expect: { changes: ['Technical SEO B · 78'] },
      },
    ],
    'checks[].ai_readability.total': [
      {
        change: (c) => {
          const ai = c.ai_readability!;
          if (ai.withheld) throw new Error('bad-site is graded');
          ai.total = 43;
        },
        expect: { changes: ['AI readability D · 43'] },
      },
    ],
  },
  'changes-schedule': {
    'sites[].schedule': [
      {
        fixture: 'challenged-site',
        change: (c, d) =>
          (siteOf(d, c).schedule = { cadence: 'monthly', iso_weekday: 1, hour_local: 8 }),
        expect: { changes: ['monthly, Mon around 08:00'] },
      },
    ],
  },
  'changes-rows': {
    'changes[].summary': [
      {
        history: 'history',
        change: (_, d) => (robots(d).summary = 'Claude-SearchBot is now disallowed'),
        expect: { changes: ['Claude-SearchBot is now disallowed'] },
      },
    ],
    'changes[].kind': [
      {
        history: 'history',
        change: (_, d) => (grade(d).kind = 'resolved'),
        expect: { changes: ['resolved'] },
      },
    ],
    'changes[].subject': [
      {
        history: 'history',
        change: (_, d) => (grade(d).subject = 'orphans'),
        expect: { changes: ['· orphan pages'] },
      },
    ],
    'changes[].where': [
      {
        history: 'history',
        change: (_, d) => (robots(d).where = '/robots.txt?v=2'),
        expect: { changes: ['/robots.txt?v=2'] },
      },
    ],
    'changes[].pages_affected': [
      {
        history: 'history',
        change: (_, d) => (robots(d).pages_affected = 199),
        expect: { changes: ['199 pages'] },
      },
    ],
    'changes[].grade_deltas': [
      {
        history: 'history',
        change: (_, d) => (grade(d).grade_deltas[0]!.to_score = 25),
        expect: { changes: ['AI readability 41 → 25'] },
      },
    ],
    'changes[].detected_at': [
      {
        history: 'history',
        change: (_, d) => (robots(d).detected_at = '2026-10-30T11:15:00Z'),
        expect: { changes: ['Fri 07:15'] },
      },
    ],
    'changes[].cause.text': [
      {
        history: 'history',
        change: (_, d) =>
          (robots(d).cause!.text = 'robots.txt changed Thu 17:05: a Disallow was added'),
        expect: {
          changes: ['First observed after robots.txt changed Thu 17:05: a Disallow was added.'],
        },
      },
    ],
    'changes[].cause.changed_at': [
      {
        history: 'history',
        change: (_, d) => (robots(d).cause!.changed_at = null),
        expect: { changes: ['First observed at this check. What we found: robots.txt changed'] },
      },
    ],
    'changes[].cause.diff': [
      {
        history: 'history',
        change: (_, d) => robots(d).cause!.diff!.removed.push('Allow: /'),
        expect: { changes: ['− Allow: /'] },
      },
    ],
    'changes[].notified': [
      {
        history: 'history',
        change: (_, d) => (robots(d).notified!.slack_channel = '#alerts'),
        expect: { changes: ['email and Slack #alerts'] },
      },
    ],
  },
  'changes-clock': {
    'accounts[].timezone': [
      {
        history: 'history',
        change: (_, d) => (d.accounts[0]!.timezone = 'Europe/London'),
        expect: { changes: ['Fri 10:02'] },
      },
    ],
  },
};
