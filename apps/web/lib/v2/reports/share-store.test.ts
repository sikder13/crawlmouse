import { describe, expect, it } from 'vitest';
import { REPORTS_BUCKET } from './generate';
import { supabaseShareFiles } from './share-store';

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

  it('throws when Storage refuses', async () => {
    const { files } = fakeStorage({ data: null, error: { message: 'no' } });
    await expect(files.signedUrl('a/b.pdf', 600)).rejects.toThrow(/sign failed: no/);
  });
});
