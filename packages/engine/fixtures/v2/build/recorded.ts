/**
 * The recorded built-site fixture as the build tests read it: the BuildInput (recordedInput), the
 * worker batches in batches/ (and variant/), and the render outcome in render.json. generate.ts
 * records them; nothing here runs the worker.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { BatchResult } from '@crawlmouse/types/v2';
import type { BuildInput, Seed } from '../../../src/v2/build/types.js';
import type { RenderOutcome } from '../../../src/v2/render/run.js';
import { LASTMOD, sitemapPaths } from './site/site.js';

const OUT = new URL('./', import.meta.url);
export const HOST = 'https://built-site.test';
export const CHECK = 'b0000000-0000-4000-8000-0000000000c1';
export const SITE_ID = 'b0000000-0000-4000-8000-0000000000a1';
export const PAGE_CAP = 500;

/** The BuildInput without its batches and render, which are recorded beside it. */
export type RecordedInput = Omit<BuildInput, 'batches' | 'render'>;

export function recordedInput(): RecordedInput {
  return {
    check: {
      id: CHECK,
      site_id: SITE_ID,
      previous_check_id: null,
      trigger: 'first_audit',
      queued_at: '2026-11-05T02:29:58Z',
      started_at: '2026-11-05T02:30:00Z',
      finished_at: '2026-11-05T02:41:00Z',
      expires_at: '2026-12-05T02:29:58Z',
      page_cap: PAGE_CAP,
      grade_version: '2.0.0',
    },
    site: {
      id: SITE_ID,
      account_id: null,
      host: 'built-site.test',
      staging_of_site_id: null,
      client_name: null,
      client_contact_name: null,
      client_contact_email: null,
      schedule: null,
      paused: false,
      competitor_hosts: [],
      slack_channel: null,
      owner_seat_id: null,
      client_report: null,
      created_at: '2026-11-05T02:29:58Z',
    },
    homepage_url: HOST,
    seeds: seedsOf(HOST),
    previous: null,
    fixes: [],
    events: [],
    lineage: { engine_sha: '0'.repeat(40), worker_release: 'unreleased' },
    now: '2026-11-05T02:41:00Z',
  };
}

export function seedsOf(base: string): Seed[] {
  return [
    { url: `${base}/`, source: 'homepage', lastmod: null },
    ...sitemapPaths().map((p) => ({
      url: `${base}${p}`,
      source: 'sitemap' as const,
      lastmod: LASTMOD[p] ?? null,
    })),
  ];
}

export function readRecorded(dir: string): BatchResult[] {
  const at = new URL(`${dir}/`, OUT);
  return readdirSync(at)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, at), 'utf8')) as BatchResult);
}

export function recordedBuild(): BuildInput {
  return {
    ...recordedInput(),
    batches: readRecorded('batches'),
    render: JSON.parse(readFileSync(new URL('render.json', OUT), 'utf8')) as RenderOutcome,
  };
}
