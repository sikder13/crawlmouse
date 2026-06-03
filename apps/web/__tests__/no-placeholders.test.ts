import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard: shipped content/legal pages must not contain authoring placeholders. This protects the
// real Privacy/Terms/AUP/Subprocessors/Status/Developers copy from regressing back into stubs.
// All six pages are now shipped, so the guard ALSO asserts each file is present and non-empty:
// an accidental delete/rename or a typo in PAGE_PATHS must fail loudly, not be skipped.
const PAGE_PATHS = [
  'app/privacy/page.tsx',
  'app/terms/page.tsx',
  'app/aup/page.tsx',
  'app/subprocessors/page.tsx',
  'app/status/page.tsx',
  'app/developers/page.tsx',
] as const;

// Case-insensitive authoring-stub tokens. NOTE: the founder-draft banner phrase
// "pending review by counsel" is intentional — "pending" is deliberately NOT forbidden.
const FORBIDDEN_TOKENS = ['placeholder', 'lorem', 'replace with', 'tbd', 'todo', 'fixme'] as const;

describe('content pages contain no authoring placeholders', () => {
  for (const rel of PAGE_PATHS) {
    // __dirname is apps/web/__tests__; the pages live one level up under apps/web/.
    const abs = resolve(__dirname, '..', rel);

    it(`${rel} exists, is non-empty, and has no placeholder/lorem/replace-with/TBD/TODO/FIXME`, () => {
      // readFileSync (not existsSync + read) closes the TOCTOU window: one syscall reads the file
      // atomically. A missing page throws ENOENT here -> the test FAILS loudly (no silent skip).
      const source = readFileSync(abs, 'utf8');
      // A zero-length / whitespace-only file means the page is a stub or a partial write.
      expect(source.trim().length, `${rel} is empty or whitespace-only`).toBeGreaterThan(0);
      const lower = source.toLowerCase();
      for (const token of FORBIDDEN_TOKENS) {
        expect(lower, `${rel} should not contain "${token}"`).not.toContain(token);
      }
    });
  }
});
