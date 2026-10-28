/**
 * Which screens read each entity, and which fields were added beyond the CC-11 brief.
 *
 * `readBy[].evidence` is a phrase the contract test finds in that screen's visible text, so "this
 * screen reads this entity" is checked against the locked screen, not asserted.
 *
 * `addedFor` maps a field path (as `nodes()` prints it, without union markers) to what required it: a
 * screen, `FACTS` (FACTS-proposed.md), or `brief` (needed to express something the brief names, such as
 * the `deferred` check status, or carried over from existing code the brief says to reuse). Fields the
 * brief names, and ids and foreign keys, are not listed.
 */
import type { z } from 'zod';
import { AccessTestSchema } from './access-test.js';
import { AccountSchema } from './account.js';
import { AlertRuleSchema } from './alert-rule.js';
import { ChangeSchema } from './change.js';
import { CheckSchema } from './check.js';
import { CrawlerRegistryEntrySchema } from './crawler-registry.js';
import { FixEventSchema } from './fix-event.js';
import { FixSchema } from './fix.js';
import type { FixtureDataset } from './fixture.js';
import { LinkEdgeSchema } from './link-edge.js';
import { PageResultSchema } from './page-result.js';
import { ReportSchema } from './report.js';
import { SeatSchema } from './seat.js';
import { SiteSchema } from './site.js';

export interface EntityDoc {
  name: string;
  /** The fixture collection that holds it; null for registry seed data. */
  collection: Exclude<
    keyof FixtureDataset,
    'provenance' | 'as_of' | 'description' | 'engine_derived' | 'withheld'
  > | null;
  schema: z.core.$ZodType;
  readBy: { screen: string; evidence: string }[];
  addedFor: Record<string, string>;
}

export const ENTITIES: readonly EntityDoc[] = [
  {
    name: 'Account',
    collection: 'accounts',
    schema: AccountSchema,
    readBy: [
      { screen: 'Final-Settings', evidence: 'Sign-in links and alerts go here' },
      { screen: 'Final-Dashboard', evidence: '9 days left' },
      { screen: 'Final-Dashboard-Day0', evidence: 'No card on file' },
      { screen: 'Final-TrialEnd', evidence: 'Pro ends Sun 8 Nov' },
      { screen: 'Final-Alerts', evidence: 'Keep Pro, $19 a month' },
      { screen: 'Final-Reports', evidence: '9 days of Pro left' },
      { screen: 'Final-Ag-Matrix', evidence: 'Card ending 4242' },
      { screen: 'Final-Ag-Branding', evidence: 'Reports, portals and emails under your name' },
      { screen: 'Final-Signup', evidence: 'One email, and the account is yours' },
      { screen: 'Final-AgencyTrial', evidence: 'shown on client reports' },
      { screen: 'Final-CheckEmail', evidence: 'We sent a sign-in link to you@company.com' },
      { screen: 'Final-Account', evidence: 'Keep this audit.' },
      { screen: 'Final-Pricing', evidence: 'Up to 2,000 pages per audit' },
    ],
    addedFor: {
      email: 'Final-Settings',
      name: 'Final-Settings',
      state_history: 'FACTS',
      trial_ends_at: 'Final-Dashboard',
      card_last4: 'Final-Ag-Matrix',
      renews_at: 'Final-Ag-Matrix',
      billing_period_months: 'Final-Ag-Matrix',
      timezone: 'FACTS',
      limits: 'Final-Settings',
      email_prefs: 'Final-Settings',
      integrations: 'Final-Settings',
      api_keys: 'Final-Developers',
      branding: 'Final-Ag-Branding',
      'branding.postal_address': 'FACTS',
      agency_trial_consent: 'FACTS',
    },
  },
  {
    name: 'Seat',
    collection: 'seats',
    schema: SeatSchema,
    readBy: [
      { screen: 'Final-Ag-Seats', evidence: 'Who sees which clients and who gets which alerts' },
      { screen: 'Final-Ag-Client', evidence: 'Priya (account manager)' },
      { screen: 'Final-Ag-Reports', evidence: 'Priya 2' },
    ],
    addedFor: {
      email: 'Final-Ag-Seats',
      name: 'Final-Ag-Seats',
      role: 'Final-Ag-Seats',
      client_scope: 'Final-Ag-Seats',
      alert_channels: 'Final-Ag-Seats',
      invited_at: 'Final-Ag-Seats',
      accepted_at: 'Final-Ag-Seats',
      theme: 'Final-Settings',
    },
  },
  {
    name: 'Site',
    collection: 'sites',
    schema: SiteSchema,
    readBy: [
      { screen: 'Final-Site', evidence: 'Settings for this site' },
      { screen: 'Final-Ag-Matrix', evidence: 'Example Outfitter' },
      { screen: 'Final-Ag-Client', evidence: 'maya@example-outfitter.com' },
      { screen: 'Final-CheckEmail-NoAudit', evidence: 'as its first site' },
    ],
    addedFor: {
      host: 'Final-Site',
      staging_of_site_id: 'Final-Site',
      client_name: 'Final-Ag-Matrix',
      client_contact_name: 'Final-Ag-Client',
      client_contact_email: 'Final-Ag-Client',
      schedule: 'Final-Site',
      paused: 'Final-TrialEnd',
      competitor_hosts: 'Final-Site',
      slack_channel: 'Final-Ag-Client',
      owner_seat_id: 'Final-Ag-Client',
      client_report: 'Final-Ag-Client',
      'client_report.timezone': 'Final-Ag-Reports',
      'client_report.page_slug': 'Final-Ag-Client',
      'client_report.paused_by_recipient_at': 'FACTS',
    },
  },
  {
    name: 'Check',
    collection: 'checks',
    schema: CheckSchema,
    readBy: [
      { screen: 'Final-Result', evidence: 'Everything we checked' },
      { screen: 'Final-Result-Dark', evidence: 'Everything we checked' },
      { screen: 'Final-Crawl', evidence: 'Read robots.txt and the sitemap' },
      { screen: 'Final-Public', evidence: 'What each crawler got back' },
      { screen: 'Final-Segment', evidence: 'Responses kept as evidence' },
      { screen: 'Final-Seg-JS', evidence: 'Text without JavaScript, site' },
      { screen: 'Final-Seg-Structure', evidence: 'Average click depth' },
      { screen: 'Final-Seg-Content', evidence: 'Pages with a quotable opening' },
      { screen: 'Final-Seg-Signals', evidence: 'Where we looked' },
      { screen: 'Final-Seg-Changes', evidence: 'Your audit history' },
      { screen: 'Final-Home', evidence: "What's in the way" },
      { screen: 'Final-Developers', evidence: 'Available now, on Pro' },
      { screen: 'Final-Dashboard', evidence: 'Crawler access now' },
      { screen: 'Final-Site', evidence: 'Grades, six checks' },
    ],
    addedFor: {
      trigger: 'Final-Site',
      queued_at: 'Final-Crawl',
      started_at: 'Final-Crawl',
      finished_at: 'Final-Home',
      tested_at: 'Final-Segment',
      expires_at: 'Final-Result',
      deferred_until: 'brief',
      failure_reason: 'brief',
      result_email: 'Final-Crawl',
      'coverage.gradeable': 'brief',
      'coverage.excluded': 'brief',
      'technical_seo.site_structure_score': 'Final-Seg-Structure',
      structure: 'Final-Seg-Structure',
      without_js: 'Final-Seg-JS',
      content: 'Final-Seg-Content',
      signals: 'Final-Seg-Signals',
      crawlers: 'Final-Segment',
      stack: 'Final-Fix',
      competitors: 'Final-Seg-Signals',
      progress: 'Final-Crawl',
    },
  },
  {
    name: 'PageResult',
    collection: 'page_results',
    schema: PageResultSchema,
    readBy: [
      { screen: 'Final-Seg-JS', evidence: 'How much of each page survives without JavaScript' },
      { screen: 'Final-Seg-Structure', evidence: 'Suggested parent' },
      { screen: 'Final-LinkMap', evidence: 'Crawlers that reach it' },
    ],
    addedFor: {
      url: 'Final-Seg-JS',
      template_key: 'Final-Seg-JS',
      kind: 'brief',
      status_code: 'Final-LinkMap',
      depth: 'Final-LinkMap',
      links_in: 'Final-LinkMap',
      links_out: 'Final-LinkMap',
      pagerank_share: 'Final-LinkMap',
      is_orphan: 'Final-Seg-Structure',
      js_only: 'Final-LinkMap',
      found_via: 'Final-Seg-Structure',
      sitemap_lastmod: 'Final-Seg-Structure',
      suggested_parent_url: 'Final-Seg-Structure',
      sampled: 'Final-Seg-JS',
      without_js: 'Final-Seg-JS',
      crawlers_reached: 'Final-LinkMap',
      crawlers_reading_text: 'Final-Seg-Structure',
      content_failures: 'Final-Seg-Content',
    },
  },
  {
    name: 'LinkEdge',
    collection: 'link_edges',
    schema: LinkEdgeSchema,
    readBy: [
      { screen: 'Final-LinkMap', evidence: 'Linked from' },
      { screen: 'Final-Reports', evidence: 'the link map as an edge list' },
    ],
    addedFor: {
      from_url: 'Final-LinkMap',
      to_url: 'Final-LinkMap',
      anchor_text: 'Final-LinkMap',
      is_generic_anchor: 'Final-LinkMap',
      js_only: 'Final-Seg-Structure',
    },
  },
  {
    name: 'AccessTest',
    collection: 'access_tests',
    schema: AccessTestSchema,
    readBy: [
      { screen: 'Final-Segment', evidence: 'error code: 1020' },
      { screen: 'Final-Seg-JS', evidence: 'what the server sent' },
      { screen: 'Final-Reports', evidence: 'Every response as CSV' },
    ],
    addedFor: {
      ua: 'FACTS',
      page_url: 'Final-Segment',
      template_key: 'Final-Segment',
      tested_at: 'Final-Segment',
      verdict: 'FACTS',
      cause: 'FACTS',
      request_headers: 'Final-Segment',
      body_excerpt: 'Final-Segment',
    },
  },
  {
    name: 'Fix',
    collection: 'fixes',
    schema: FixSchema,
    readBy: [
      { screen: 'Final-Fix', evidence: 'The packet' },
      { screen: 'Final-Public', evidence: 'The three fixes with the largest effect' },
      { screen: 'Final-Dashboard-Day0', evidence: 'Start with the fix that pays most' },
      { screen: 'Final-Ag-Client', evidence: 'Open fixes' },
      { screen: 'Final-Agencies', evidence: 'Link the 7 orphan pages from their collections' },
      { screen: 'Final-Seg-Content', evidence: 'Fixes for quotable content' },
    ],
    addedFor: {
      number: 'Final-Site',
      section: 'Final-Site',
      title: 'Final-Fix',
      detail: 'Final-Seg-Structure',
      crawler_uas: 'Final-Segment',
      rank: 'Final-Dashboard-Day0',
      effort: 'Final-Public',
      before_after: 'Final-Fix',
      packet: 'Final-Fix',
    },
  },
  {
    name: 'FixEvent',
    collection: 'fix_events',
    schema: FixEventSchema,
    readBy: [
      { screen: 'Final-Site', evidence: 'marked done Wed' },
      { screen: 'Final-Ag-Reports', evidence: 'Fix marked done after' },
      { screen: 'Final-TrialEnd', evidence: 'fix 0 closed Sat 31 Oct' },
    ],
    addedFor: { check_id: 'brief' },
  },
  {
    name: 'Change',
    collection: 'changes',
    schema: ChangeSchema,
    readBy: [
      { screen: 'Final-Dashboard', evidence: 'What changed, by site' },
      { screen: 'Final-Alerts', evidence: 'Everything that was sent, newest first' },
      { screen: 'Final-Seg-Changes', evidence: 'Cause we found' },
      { screen: 'Final-Home', evidence: 'robots.txt changed at 07:40' },
    ],
    addedFor: {
      detected_at: 'Final-Dashboard',
      kind: 'Final-Seg-Changes',
      subject: 'Final-Alerts',
      summary: 'Final-Dashboard',
      where: 'Final-Seg-Changes',
      pages_affected: 'Final-Dashboard',
      ua: 'Final-Dashboard',
      grade_deltas: 'Final-Alerts',
      cause: 'Final-Seg-Changes',
      fix_id: 'Final-Dashboard',
      notified: 'Final-Alerts',
    },
  },
  {
    name: 'AlertRule',
    collection: 'alert_rules',
    schema: AlertRuleSchema,
    readBy: [
      { screen: 'Final-Alerts', evidence: 'Rules, all sites' },
      { screen: 'Final-Site', evidence: 'Alerts for this site' },
    ],
    addedFor: {
      kind: 'Final-Alerts',
      enabled: 'Final-Alerts',
      threshold_points: 'Final-Alerts',
      channels: 'Final-Alerts',
      last_fired_at: 'Final-Site',
      last_fired_check_id: 'Final-Site',
    },
  },
  {
    name: 'Report',
    collection: 'reports',
    schema: ReportSchema,
    readBy: [
      { screen: 'Final-Reports', evidence: 'Reports made' },
      { screen: 'Final-Ag-Reports', evidence: 'Client reports' },
      { screen: 'Final-Site', evidence: 'Public link' },
      { screen: 'Final-Agencies', evidence: 'The prospect one-pager, as the client receives it' },
    ],
    addedFor: {
      kind: 'Final-Reports',
      format: 'Final-Reports',
      status: 'Final-Ag-Reports',
      made_by: 'Final-Reports',
      created_at: 'Final-Reports',
      covers_check_ids: 'Final-Reports',
      byte_count: 'Final-Reports',
      share_expires_at: 'Final-Reports',
      public_slug: 'Final-Site',
      scheduled_for: 'Final-Ag-Reports',
      sent_at: 'Final-Ag-Reports',
      recipient_email: 'Final-Ag-Reports',
      owner_seat_id: 'Final-Ag-Reports',
      headline: 'Final-Ag-Reports',
      open_tracking: 'Final-Ag-Reports',
      opened_at: 'Final-Ag-Reports',
    },
  },
  {
    name: 'CrawlerRegistryEntry',
    collection: null,
    schema: CrawlerRegistryEntrySchema,
    readBy: [
      { screen: 'Final-Pricing', evidence: 'Every plan audits as the same six crawlers' },
      { screen: 'Final-Crawl', evidence: 'Googlebot and Bingbot render JavaScript' },
    ],
    addedFor: {
      scored: 'FACTS',
      operator: 'Final-Result',
      ip_list_url: 'brief',
      source_notes: 'brief',
    },
  },
];
