import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getJson, putJson, supabaseEvidenceStore } from './evidence';
import { memoryEvidenceStore } from './test-support/memory-evidence';
import { EVIDENCE_BUCKET, evidencePath } from './types';

const OWNER = { accountId: null, siteId: 's1', checkId: 'c1' };

describe('evidence (D7)', () => {
  it('stores gzipped JSON and reads it back', async () => {
    const store = memoryEvidenceStore();
    const path = evidencePath(OWNER, 'batch-3');
    await putJson(store, path, { pages: [{ url: 'https://example.com', status: 200 }] });
    expect(path).toBe('anon/s1/c1/batch-3.json.gz');
    expect(JSON.parse(gunzipSync(store.objects.get(path)!).toString('utf8'))).toEqual({
      pages: [{ url: 'https://example.com', status: 200 }],
    });
    expect(await getJson(store, path)).toEqual({
      pages: [{ url: 'https://example.com', status: 200 }],
    });
  });

  it('puts to the private bucket with upsert, so a retried step replaces its object', async () => {
    const calls: unknown[][] = [];
    const sb = {
      storage: {
        from: (bucket: string) => ({
          upload: async (...args: unknown[]) => {
            calls.push(['upload', bucket, ...args]);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            calls.push(['remove', bucket, paths]);
            return { error: null };
          },
          download: async (path: string) => {
            calls.push(['download', bucket, path]);
            return { data: new Blob([new Uint8Array([1, 2])]), error: null };
          },
        }),
      },
    } as unknown as SupabaseClient;
    const store = supabaseEvidenceStore(sb);
    await store.put('a/b.json.gz', new Uint8Array([9]));
    await store.remove(['a/b.json.gz']);
    await store.remove([]);
    expect(await store.get('a/b.json.gz')).toEqual(new Uint8Array([1, 2]));
    expect(calls).toEqual([
      [
        'upload',
        EVIDENCE_BUCKET,
        'a/b.json.gz',
        new Uint8Array([9]),
        { upsert: true, contentType: 'application/gzip' },
      ],
      ['remove', EVIDENCE_BUCKET, ['a/b.json.gz']],
      ['download', EVIDENCE_BUCKET, 'a/b.json.gz'],
    ]);
  });

  it('throws on a Storage error, naming the path', async () => {
    const sb = {
      storage: {
        from: () => ({ upload: async () => ({ error: { message: 'denied' } }) }),
      },
    } as unknown as SupabaseClient;
    await expect(supabaseEvidenceStore(sb).put('x.json.gz', new Uint8Array())).rejects.toThrow(
      'evidence: put x.json.gz: denied',
    );
  });
});
