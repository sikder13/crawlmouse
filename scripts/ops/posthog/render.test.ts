import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENT_REGISTRY } from '../../../apps/web/lib/analytics-registry';
import { REQUIRED_SCOPES } from './client';
import {
  cell,
  EVENTS_DOC,
  POSTHOG_DOC,
  filterText,
  formatted,
  renderEventsDoc,
  renderPostHogDoc,
} from './render';
import { SPEC } from './spec';

describe('docs/analytics', () => {
  it('posthog.md is the spec as render.ts writes it (run pnpm ops:posthog:docs to update)', async () => {
    const fresh = await formatted(renderPostHogDoc(), POSTHOG_DOC);
    expect(readFileSync(POSTHOG_DOC, 'utf8')).toEqual(fresh);
  });

  it('events.md is the registry as render.ts writes it (run pnpm ops:posthog:docs to update)', async () => {
    const fresh = await formatted(renderEventsDoc(), EVENTS_DOC);
    expect(readFileSync(EVENTS_DOC, 'utf8')).toEqual(fresh);
  });

  it('a change to the spec or the registry changes the rendering', () => {
    const fewer = { ...SPEC, cohorts: SPEC.cohorts.slice(1) };
    expect(renderPostHogDoc(fewer)).not.toEqual(renderPostHogDoc());
    const { home_viewed: _gone, ...rest } = EVENT_REGISTRY;
    expect(renderEventsDoc(rest)).not.toEqual(renderEventsDoc());
  });

  it('lists the key scopes the client declares', () => {
    for (const scope of REQUIRED_SCOPES) expect(renderPostHogDoc()).toContain(`\`${scope}\``);
  });
});

describe('filterText', () => {
  it('reads one value, several values, no value and a behavioral filter', () => {
    expect(filterText({ type: 'person', key: 'plan', operator: 'exact', value: ['pro'] })).toBe(
      'person `plan` = `pro`',
    );
    expect(
      filterText({ type: 'person', key: 'plan', operator: 'exact', value: ['pro', 'agency'] }),
    ).toBe('person `plan` is one of `pro`, `agency`');
    expect(filterText({ type: 'event', key: 'source', operator: 'is_not_set' })).toBe(
      'event `source` is not set',
    );
    expect(filterText({ type: 'behavioral', event: 'first_client_added', withinDays: 365 })).toBe(
      'sent `first_client_added` in the last 365 days',
    );
  });
});

describe('a table cell', () => {
  it('escapes a backslash before a pipe, so an escape already in the text cannot undo it', () => {
    expect(cell('a|b')).toBe('a\\|b');
    expect(cell('a\\|b')).toBe('a\\\\\\|b');
    expect(cell('^(localhost|127\\.0\\.0\\.1)$')).toBe('^(localhost\\|127\\\\.0\\\\.0\\\\.1)$');
  });
});
