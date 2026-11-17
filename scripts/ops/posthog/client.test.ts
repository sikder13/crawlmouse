/**
 * `list()`'s paging against answers PostHog actually gives. A list endpoint can answer with no `next`
 * field at all (the dry run of 2026-11-16 threw "Cannot read properties of undefined (reading
 * 'startsWith')" on one), and an answer with no `results` array is refused with the kind and the path
 * named, not read as a crash.
 */
import { describe, expect, it } from 'vitest';
import { POSTHOG_HOST, postHogClient, type Fetch } from './client';

const PROJECT = '448922';
const BASE = `${POSTHOG_HOST}/api/projects/${PROJECT}/`;

/** Answers each GET with the next body in `bodies`, and records the URLs asked for. */
function answering(bodies: unknown[]): { fetch: Fetch; urls: string[] } {
  const urls: string[] = [];
  const fetch: Fetch = async (url) => {
    urls.push(url);
    const body = bodies.shift();
    if (body === undefined) throw new Error(`no answer left for ${url}`);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetch, urls };
}

const clientOf = (fetch: Fetch) => postHogClient({ key: 'phx_test', projectId: PROJECT, fetch });

describe('list()', () => {
  it('ends at an answer with no next field', async () => {
    const f = answering([{ results: [{ id: 1, name: 'one' }] }]);
    expect(await clientOf(f.fetch).list('survey')).toEqual([{ id: 1, name: 'one' }]);
    expect(f.urls).toEqual([`${BASE}surveys/?limit=200`]);
  });

  it('follows a next link and ends at a null next, as before', async () => {
    const f = answering([
      { results: [{ id: 1, name: 'one' }], next: `${BASE}actions/?limit=200&offset=200` },
      { results: [{ id: 2, name: 'two' }], next: null },
    ]);
    expect((await clientOf(f.fetch).list('action')).map((r) => r.id)).toEqual([1, 2]);
    expect(f.urls).toHaveLength(2);
  });

  it('refuses an answer with no results array, naming the kind and the path', async () => {
    const f = answering([{ detail: 'not a list' }]);
    await expect(clientOf(f.fetch).list('cohort')).rejects.toThrow(
      `cohort: GET /api/projects/${PROJECT}/cohorts/ answered without a results array`,
    );
  });
});
