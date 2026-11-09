import { describe, expect, it } from 'vitest';
import {
  checkFromRow,
  diffInputsFromRow,
  fixEventFromRow,
  instantFromDb,
  pageResultFromRow,
  siteFromRow,
} from './rows';

/**
 * Rows as PostgREST (or `to_jsonb`) serialises them, written out here, to contract records. The whole
 * set of converters is exercised on rows the database wrote in round-trip.test.ts.
 */

const CHECK = 'b0000000-0000-4000-8000-0000000000c1';
const SITE = 'b0000000-0000-4000-8000-0000000000a1';

describe('instantFromDb', () => {
  it.each([
    ['2026-11-05T02:30:00+00:00', '2026-11-05T02:30:00Z'],
    ['2026-11-05 02:30:00+00', '2026-11-05T02:30:00Z'],
    ['2026-11-05T02:30:00.123456+00:00', '2026-11-05T02:30:00.123456Z'],
    ['2026-11-05T02:30:00.5+00:00', '2026-11-05T02:30:00.5Z'],
    ['2026-11-05T08:00:00.000001+05:30', '2026-11-05T02:30:00.000001Z'],
    ['2026-11-04T21:30:00-05', '2026-11-05T02:30:00Z'],
    ['2026-11-05T02:30:00Z', '2026-11-05T02:30:00Z'],
  ])('%s is %s, to the digit', (db, contract) => {
    expect(instantFromDb(db)).toBe(contract);
  });

  it.each([['2026-11-05'], ['yesterday'], [''], [1_700_000_000], [null]])('refuses %j', (value) => {
    expect(() => instantFromDb(value)).toThrow(/not a timestamp/);
  });
});

/** A finished check row as `select to_jsonb(c)` returns it, database-only columns included. */
function checkRow(): Record<string, unknown> {
  return {
    id: CHECK,
    site_id: SITE,
    previous_check_id: null,
    status: 'failed',
    trigger: 'manual',
    grade_version: '2.0.0',
    queued_at: '2026-11-05T02:29:58.123456+00:00',
    started_at: '2026-11-05T02:30:00+00:00',
    finished_at: '2026-11-05T02:31:00+00:00',
    tested_at: null,
    expires_at: null,
    deferred_until: null,
    failure_reason: 'stalled',
    result_email: null,
    coverage: null,
    technical_seo: null,
    ai_readability: null,
    structure: null,
    without_js: null,
    content: null,
    signals: [],
    crawlers: [],
    stack: null,
    competitors: [],
    progress: null,
    // Database only.
    lineage_id: null,
    check_month: '2026-11-01',
    technical_seo_status: 'not_measurable',
    ai_readability_status: 'not_measurable',
    inngest_run_id: 'run-1',
    heartbeat_at: '2026-11-05T02:30:30+00:00',
    diff_inputs: null,
    map_path: null,
  };
}

describe('checkFromRow', () => {
  it('keeps the contract fields, writes instants with a Z to the digit, and drops the rest', () => {
    expect(checkFromRow(checkRow())).toEqual({
      ...Object.fromEntries(
        Object.entries(checkRow()).filter(
          ([k]) =>
            ![
              'lineage_id',
              'check_month',
              'technical_seo_status',
              'ai_readability_status',
              'inngest_run_id',
              'heartbeat_at',
              'diff_inputs',
              'map_path',
            ].includes(k),
        ),
      ),
      queued_at: '2026-11-05T02:29:58.123456Z',
      started_at: '2026-11-05T02:30:00Z',
      finished_at: '2026-11-05T02:31:00Z',
    });
  });

  it('throws on a row the contract refuses, and on a row missing a contract column', () => {
    expect(() => checkFromRow({ ...checkRow(), failure_reason: null })).toThrow();
    const missing = checkRow();
    delete missing.signals;
    expect(() => checkFromRow(missing)).toThrow();
  });
});

function siteRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SITE,
    account_id: '0a000000-0000-4000-8000-000000000001',
    host: 'shop.example',
    staging_of_site_id: null,
    client_name: 'Acme',
    client_contact_name: null,
    client_contact_email: null,
    schedule_cadence: 'weekly',
    schedule_iso_weekday: 1,
    schedule_hour_local: 6,
    paused_reason: null,
    paused: false,
    competitor_hosts: [],
    slack_channel: null,
    owner_seat_id: null,
    created_at: '2026-11-01T00:00:00+00:00',
    updated_at: '2026-11-02T00:00:00+00:00',
    removed_at: null,
    next_check_at: null,
    schedule_offset_min: 17,
    ...extra,
  };
}
const SCHEDULE = {
  site_id: SITE,
  account_id: '0a000000-0000-4000-8000-000000000001',
  cadence: 'monthly',
  iso_weekday: 1,
  time_local: '08:00',
  timezone: 'Europe/London',
  send_when_unchanged: false,
  open_tracking: true,
  page_slug: 'acme',
  paused_by_recipient_at: null,
  next_run_at: null,
  last_run_at: null,
  created_at: '2026-11-01T00:00:00+00:00',
  updated_at: '2026-11-01T00:00:00+00:00',
};
const CLIENT_REPORT = {
  cadence: 'monthly',
  iso_weekday: 1,
  time_local: '08:00',
  timezone: 'Europe/London',
  send_when_unchanged: false,
  open_tracking: true,
  page_slug: 'acme',
  paused_by_recipient_at: null,
};

describe('siteFromRow', () => {
  it('rebuilds the flattened schedule and the relocated client report', () => {
    expect(siteFromRow(siteRow({ report_schedules: SCHEDULE }))).toEqual({
      id: SITE,
      account_id: '0a000000-0000-4000-8000-000000000001',
      host: 'shop.example',
      staging_of_site_id: null,
      client_name: 'Acme',
      client_contact_name: null,
      client_contact_email: null,
      schedule: { cadence: 'weekly', iso_weekday: 1, hour_local: 6 },
      paused: false,
      competitor_hosts: [],
      slack_channel: null,
      owner_seat_id: null,
      client_report: CLIENT_REPORT,
      created_at: '2026-11-01T00:00:00Z',
    });
  });

  it.each([
    ['an embedded array of one', [SCHEDULE], CLIENT_REPORT],
    ['an embedded empty array', [], null],
    ['null', null, null],
  ])('reads report_schedules given as %s', (_label, schedules, want) => {
    expect(siteFromRow(siteRow({ report_schedules: schedules })).client_report).toEqual(want);
  });

  it('a site with no schedule has schedule null', () => {
    const row = siteRow({
      schedule_cadence: null,
      schedule_iso_weekday: null,
      schedule_hour_local: null,
      report_schedules: null,
    });
    expect(siteFromRow(row).schedule).toBeNull();
  });

  it('throws when the row was read without its report_schedules, rather than report none', () => {
    expect(() => siteFromRow(siteRow())).toThrow(/report_schedules/);
  });

  it('throws on two report schedules for one site', () => {
    expect(() => siteFromRow(siteRow({ report_schedules: [SCHEDULE, SCHEDULE] }))).toThrow(
      /report_schedules/,
    );
  });
});

describe('fixEventFromRow', () => {
  const base = {
    id: 'e0000000-0000-4000-8000-000000000001',
    fix_id: 'f0000000-0000-4000-8000-000000000001',
    at: '2026-11-05T02:41:00+00:00',
  };
  it('a marked_done event carries who, a measured one its check', () => {
    expect(
      fixEventFromRow({ ...base, kind: 'marked_done', by_seat_id: null, check_id: null }),
    ).toEqual({ ...base, at: '2026-11-05T02:41:00Z', kind: 'marked_done', by_seat_id: null });
    expect(
      fixEventFromRow({ ...base, kind: 'verified', by_seat_id: null, check_id: CHECK }),
    ).toEqual({ ...base, at: '2026-11-05T02:41:00Z', kind: 'verified', check_id: CHECK });
  });
});

describe('pageResultFromRow', () => {
  it('drops the hash, partition, lineage and vantage columns', () => {
    const page = {
      check_id: CHECK,
      url: 'https://shop.example/',
      template_key: '/',
      kind: 'content',
      status_code: 200,
      depth: 0,
      links_in: 0,
      links_out: 3,
      pagerank_share: 0.25,
      is_orphan: false,
      js_only: false,
      found_via: 'link',
      sitemap_lastmod: '2026-10-01',
      suggested_parent_url: null,
      sampled: true,
      without_js: null,
      crawlers_reached: null,
      crawlers_reading_text: null,
      content_failures: null,
      final_url: 'https://shop.example/',
      redirect: null,
      canonical_declared: null,
      hreflang: null,
      content_simhash: null,
      is_html: true,
      links_read: true,
      robots_search: [],
      title: { text: 'Shop', chars: 4, cut: false },
      meta_description: null,
    };
    expect(
      pageResultFromRow({
        ...page,
        url_hash: 'ab'.repeat(32),
        check_month: '2026-11-01',
        lineage_id: 'b0000000-0000-4000-8000-0000000000d1',
        identity_sent: 'Mozilla/5.0 (compatible; Crawlmouse/2.0)',
        source_ip_class: 'fly_egress',
        request_headers: [],
        headers: [],
      }),
    ).toEqual(page);
  });
});

describe('diffInputsFromRow', () => {
  const inputs = {
    page_cap: 500,
    robots_txt: 'User-agent: *\nAllow: /\n',
    detectors: ['orphan_pages', 'deep_pages'],
    indeterminate: ['4270b4cad382f3c6'],
  };
  it('is the stored diff inputs, or null when the check stored none', () => {
    expect(diffInputsFromRow({ diff_inputs: inputs })).toEqual(inputs);
    expect(diffInputsFromRow({ diff_inputs: null })).toBeNull();
  });
  it.each([
    ['an unknown detector', { ...inputs, detectors: ['nope'] }],
    ['a fingerprint of another shape', { ...inputs, indeterminate: ['XYZ'] }],
    ['no page cap', { ...inputs, page_cap: 0 }],
    ['an extra key', { ...inputs, extra: 1 }],
  ])('refuses %s', (_label, value) => {
    expect(() => diffInputsFromRow({ diff_inputs: value })).toThrow();
  });
});
