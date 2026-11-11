/**
 * `isReadableAudit` (the `/audit/[id]` redirect's question) reads the check's row and its site's,
 * and nothing else of the check: the overview it sends the reader to is what loads it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicCheckDeps, Viewer } from '../../../../lib/v2/pipeline/public';

vi.mock('server-only', () => ({}));

const ID = 'b0000000-0000-4000-8000-0000000000c1';
const SITE = 'a0000000-0000-4000-8000-0000000000a1';
const reads: [table: string, column: string, values: readonly string[]][] = [];
const never = (name: string) => () => {
  throw new Error(`isReadableAudit must not call ${name}`);
};
let site: Record<string, unknown> | undefined;
let check: Record<string, unknown> | undefined;
let viewer: Viewer = { userId: null };
const isMember = vi.fn(async () => false);

vi.mock('../../../../lib/v2/pipeline/public-deps', () => ({
  requestAccess: async () => ({
    viewer,
    deps: {
      read: {
        rows: async (table: string, column: string, values: readonly string[]) => {
          reads.push([table, column, values]);
          const row = table === 'checks' ? check : table === 'sites' ? site : undefined;
          return row ? [row] : [];
        },
      },
      evidence: { get: never('evidence.get') },
      now: never('now'),
      isMember,
      planOf: never('planOf'),
    } as unknown as PublicCheckDeps,
  }),
}));

const { isReadableAudit } = await import('./access');

afterEach(() => {
  reads.length = 0;
  isMember.mockClear();
  viewer = { userId: null };
});

describe('isReadableAudit', () => {
  const row = { id: ID, site_id: SITE, status: 'finished', queued_at: '2026-11-06T10:00:00Z' };

  it('is true for an unkept check, from the check row and the site row alone', async () => {
    check = row;
    site = { id: SITE, host: 'example.com', account_id: null, removed_at: null };
    expect(await isReadableAudit(ID)).toBe(true);
    expect(reads).toEqual([
      ['checks', 'id', [ID]],
      ['sites', 'id', [SITE]],
    ]);
    expect(isMember).not.toHaveBeenCalled();
  });

  it('is false for an id with no check row, after one read', async () => {
    check = undefined;
    expect(await isReadableAudit(ID)).toBe(false);
    expect(reads).toEqual([['checks', 'id', [ID]]]);
  });

  it('is false for a kept check read by a visitor, and asks membership for a signed-in reader', async () => {
    check = row;
    site = { id: SITE, host: 'example.com', account_id: 'acct', removed_at: null };
    expect(await isReadableAudit(ID)).toBe(false);
    expect(isMember).not.toHaveBeenCalled();
    viewer = { userId: 'user-1' };
    isMember.mockResolvedValueOnce(true);
    expect(await isReadableAudit(ID)).toBe(true);
    expect(isMember.mock.calls).toEqual([[SITE, 'user-1']]);
  });

  it('reads nothing for a value that is not a uuid', async () => {
    expect(await isReadableAudit('not-a-uuid')).toBe(false);
    expect(reads).toEqual([]);
  });
});
