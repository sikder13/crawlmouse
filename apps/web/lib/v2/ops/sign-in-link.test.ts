import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { requestSignInLink, SIGN_IN_REDIRECT_PATH, type SignInLinkDeps } from './sign-in-link';

const WEB = resolve(__dirname, '../../..');
const REPO = resolve(WEB, '../..');
const ADDRESS = ['someone', 'example.com'].join('@');

function deps(answer: { error: { status?: number; message: string } | null }) {
  const signInWithOtp = vi.fn(async () => ({ data: {}, error: answer.error }));
  const d: SignInLinkDeps = {
    client: () => ({ auth: { signInWithOtp } }),
    baseUrl: 'https://crawlmouse.test',
  };
  return { d, signInWithOtp };
}

describe('requestSignInLink', () => {
  it("asks Supabase Auth for a link to the address, creating no user, landing on the route's page", async () => {
    const { d, signInWithOtp } = deps({ error: null });
    expect(await requestSignInLink(ADDRESS, d)).toBe('sent');
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: ADDRESS,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `https://crawlmouse.test${SIGN_IN_REDIRECT_PATH}`,
      },
    });
  });

  it('answers refused when Auth refuses, and logs the status without the address', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { d } = deps({ error: { status: 429, message: `rate limit for ${ADDRESS}` } });
    expect(await requestSignInLink(ADDRESS, d)).toBe('refused');
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]![0])).not.toContain('@');
    log.mockRestore();
  });

  it('lands on the path the magic-link route sends its own links to', () => {
    const route = readFileSync(join(WEB, 'app/api/auth/magic-link/route.ts'), 'utf8');
    const paths = [...route.matchAll(/emailRedirectTo:\s*`\$\{baseUrl\}([^`]+)`/g)].map(
      (m) => m[1],
    );
    expect(paths).toEqual([SIGN_IN_REDIRECT_PATH]);
    expect(route).toMatch(/process\.env\.NEXT_PUBLIC_BASE_URL \?\? 'http:\/\/localhost:3000'/);
  });
});

describe('who may import it', () => {
  // It sends a sign-in link to any address it is given, past the magic-link route's Turnstile: only
  // the console's actions and the sign-in canary may call it.
  const ALLOWED = [/^apps\/web\/app\/api\/internal\//, /^inngest\/signin-canary\.ts$/];
  const SPEC = /(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"]*ops\/sign-in-link)['"]/g;

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(tsx?|mjs|jsx?)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('is imported only by app/api/internal and inngest/signin-canary.ts', () => {
    const files = [...walk(WEB), ...walk(join(REPO, 'inngest'))];
    expect(files.length).toBeGreaterThan(200);
    const importers = files
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => [...readFileSync(f, 'utf8').matchAll(SPEC)].length > 0)
      .map((f) => relative(REPO, f));
    expect(importers.filter((f) => !ALLOWED.some((a) => a.test(f)))).toEqual([]);
  });

  it('the scan sees an import in each spelling', () => {
    for (const src of [
      "import { requestSignInLink } from '@/lib/v2/ops/sign-in-link';",
      "import { requestSignInLink } from '../../lib/v2/ops/sign-in-link';",
      "const m = await import('../apps/web/lib/v2/ops/sign-in-link');",
    ])
      expect([...src.matchAll(SPEC)].length, src).toBe(1);
  });
});
