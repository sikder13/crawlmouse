import { describe, expect, it } from 'vitest';
import { REPORTS_BUCKET } from './generate';
import { supabaseShareFiles, supabaseShareStore } from './share-store';

// The file a share link opens is signed as a download, as a member's own download is: the object is
// not opened in place on the storage host.
describe('supabaseShareFiles', () => {
  function fakeStorage(answer: unknown) {
    const calls: unknown[][] = [];
    const client = {
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (...a: unknown[]) => {
            calls.push([bucket, ...a]);
            return answer;
          },
        }),
      },
    };
    return { calls, files: supabaseShareFiles(client as never) };
  }

  it('signs in the private reports bucket, for the seconds asked, as a download', async () => {
    const { calls, files } = fakeStorage({ data: { signedUrl: 'https://storage.example/s' } });
    expect(await files.signedUrl('a/b.pdf', 600)).toBe('https://storage.example/s');
    expect(calls).toEqual([[REPORTS_BUCKET, 'a/b.pdf', 600, { download: true }]]);
  });

  it('signs under a file name when one is given', async () => {
    const { calls, files } = fakeStorage({ data: { signedUrl: 'https://storage.example/s' } });
    await files.signedUrl('a/b.pdf', 600, 'crawlmouse-x.com-2026-11-12-audit.pdf');
    expect(calls).toEqual([
      [REPORTS_BUCKET, 'a/b.pdf', 600, { download: 'crawlmouse-x.com-2026-11-12-audit.pdf' }],
    ]);
  });

  it('throws when Storage refuses', async () => {
    const { files } = fakeStorage({ data: null, error: { message: 'no' } });
    await expect(files.signedUrl('a/b.pdf', 600)).rejects.toThrow(/sign failed: no/);
  });
});

describe('supabaseShareStore.fileFacts', () => {
  const LINK = {
    reportId: 'r1',
    accountId: 'a1',
    siteId: 's1',
    kind: 'audit_pdf' as const,
    format: 'pdf' as const,
    storagePath: 'a1/r1.pdf',
  };
  /** A client whose two reads answer from `rows`, keyed by table, and record what they asked. */
  function fakeClient(rows: Record<string, { data: unknown; error: unknown }>) {
    const asked: string[] = [];
    const client = {
      from: (table: string) => ({
        select: (cols: string) => ({
          eq: (col: string, val: string) => ({
            maybeSingle: async () => {
              asked.push(`${table}.${cols} where ${col}=${val}`);
              return rows[table];
            },
          }),
        }),
      }),
    };
    return { asked, store: supabaseShareStore(client as never) };
  }

  it('reads the report’s creation time and its site’s host', async () => {
    const { asked, store } = fakeClient({
      reports: { data: { created_at: '2026-11-12T10:00:00+00:00' }, error: null },
      sites: { data: { host: 'shop.example.com' }, error: null },
    });
    expect(await store.fileFacts(LINK)).toEqual({
      host: 'shop.example.com',
      createdAt: '2026-11-12T10:00:00+00:00',
    });
    expect(asked.sort()).toEqual(['reports.created_at where id=r1', 'sites.host where id=s1']);
  });

  it('is null when either row is gone', async () => {
    const { store } = fakeClient({
      reports: { data: { created_at: '2026-11-12T10:00:00+00:00' }, error: null },
      sites: { data: null, error: null },
    });
    expect(await store.fileFacts(LINK)).toBeNull();
  });

  it('throws when a read fails', async () => {
    const { store } = fakeClient({
      reports: { data: null, error: { message: 'down' } },
      sites: { data: { host: 'x' }, error: null },
    });
    await expect(store.fileFacts(LINK)).rejects.toThrow(/reports read failed: down/);
  });
});
