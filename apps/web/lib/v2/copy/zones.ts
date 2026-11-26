import type { CopyChange } from '../copy-registry';

/**
 * D-17 (QA's production dashboard walk, CTO 091): the account pages named no zone, so a customer
 * read UTC times as their own. Every time on the dashboard, the site page, the changes and the
 * agency matrix and client pages now names its zone ("06:02 EDT"; `hourMinuteZoned`,
 * `weekdayTimeZoned` in lib/v2/format.ts). One entry per time each locked screen shows, applied
 * after every other change, so a sentence another entry rewrites keeps its time zoned too.
 */
const SOURCE =
  'V2R register D-17, QA’s production dashboard walk (24 Nov): every time names its zone';

export const ZONE_CHANGES: CopyChange[] = [
  // Reports (QA's re-walk, 25 Nov: 19 times with no zone): each time it shows, all before the
  // clocks went back on 1 Nov.
  {
    screen: 'reports',
    kind: 'ruling',
    locked: '06:02',
    rendered: '06:02 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'reports',
    kind: 'ruling',
    locked: '06:04',
    rendered: '06:04 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'reports',
    kind: 'ruling',
    locked: '09:40',
    rendered: '09:40 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'reports',
    kind: 'ruling',
    locked: '03:10',
    rendered: '03:10 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'dashboard-day0',
    kind: 'ruling',
    locked: '06:00',
    rendered: '06:00 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'dashboard-day0',
    kind: 'ruling',
    locked: '22:34',
    rendered: '22:34 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: '06:00',
    rendered: '06:00 EST',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: '06:01',
    rendered: '06:01 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: '06:02',
    rendered: '06:02 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: '18:23',
    rendered: '18:23 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'dashboard',
    kind: 'ruling',
    locked: '19:40',
    rendered: '19:40 EDT',
    all: true,
    source: SOURCE,
  },
  // On the site page one hour falls either side of the clocks going back: the scheduled check of
  // Fri 30 Oct ran in EDT, the next one, Fri 6 Nov, runs in EST.
  {
    screen: 'site',
    kind: 'ruling',
    locked: 'Fri 30 Oct around 06:00',
    rendered: 'Fri 30 Oct around 06:00 EDT',
    source: SOURCE,
  },
  {
    screen: 'site',
    kind: 'ruling',
    locked: 'Fri 6 Nov around 06:00',
    rendered: 'Fri 6 Nov around 06:00 EST',
    source: SOURCE,
  },
  {
    screen: 'site',
    kind: 'ruling',
    locked: '06:02',
    rendered: '06:02 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'site',
    kind: 'ruling',
    locked: '06:03',
    rendered: '06:03 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'site',
    kind: 'ruling',
    locked: '19:40',
    rendered: '19:40 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'agency-matrix',
    kind: 'ruling',
    locked: '06:00',
    rendered: '06:00 EST',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'agency-matrix',
    kind: 'ruling',
    locked: '06:01',
    rendered: '06:01 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'agency-matrix',
    kind: 'ruling',
    locked: '15:13',
    rendered: '15:13 EDT',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'agency-client',
    kind: 'ruling',
    locked: '06:00',
    rendered: '06:00 EST',
    all: true,
    source: SOURCE,
  },
  {
    screen: 'agency-client',
    kind: 'ruling',
    locked: '15:13',
    rendered: '15:13 EDT',
    all: true,
    source: SOURCE,
  },
];
