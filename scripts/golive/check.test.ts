import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { earlyRedactor, main, parseArgs, parseEnvFile } from './check';
import { PRECONDITIONS } from './preconditions';
import { PROBES, type ProbeId } from './probes/index';
import { pass, type Probe, type ProbeResult } from './probes/types';
import { VERCEL_PROJECT_ID } from './probes/vercel-env';
import { MASK } from './redact';
import { fakeToken, json, scriptedFetch, scriptedGit } from './test-support';

type Answers = Partial<Record<ProbeId, ProbeResult>>;
const allPass = (): Record<ProbeId, Probe> => {
  const probes: Partial<Record<ProbeId, Probe>> = {};
  for (const id of Object.keys(PROBES) as ProbeId[]) probes[id] = async () => pass('ok');
  return probes as Record<ProbeId, Probe>;
};
const probesWith = (answers: Answers): Record<ProbeId, Probe> => {
  const p = allPass();
  for (const [id, r] of Object.entries(answers)) p[id as ProbeId] = async () => r!;
  return p;
};
const manualThrough = (step: number) =>
  PRECONDITIONS.filter((p) => p.check.kind === 'manual' && p.gates <= step).map((p) => p.id);

async function run(argv: string[], probes: Record<ProbeId, Probe>, file: string | null = '') {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    processEnv: {},
    readFile: () => file,
    fetch: scriptedFetch(() => json({})).fetch,
    now: () => new Date(Date.UTC(2026, 10, 13)),
    git: scriptedGit({}),
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    probes,
  });
  return { code, out, err, all: [...out, ...err].join('\n') };
}

describe('the arguments', () => {
  it('default to step 1 and nothing ticked', () => {
    expect(parseArgs([])).toMatchObject({ step: 1, ticked: new Set() });
    expect(parseArgs(['--', '--step', '3'])).toMatchObject({ step: 3 });
  });
  it.each([
    ['--step', '0'],
    ['--step', '6'],
    ['--step', 'two'],
    ['--ticked', 'no-such-row'],
    ['--other'],
    ['--step'],
  ])('refuse %s %s', (...argv) => {
    expect(typeof parseArgs(argv.filter((a): a is string => a !== undefined))).toBe('string');
  });
  it('exit 2 on bad arguments', async () => {
    expect((await run(['--step', '9'], allPass())).code).toBe(2);
  });
});

describe('step gating', () => {
  it('passes a step when every row gating it and every earlier step passes', async () => {
    const r = await run(['--step', '2', '--ticked', manualThrough(2).join(',')], allPass());
    expect(r.code).toBe(0);
  });

  it('does not pass a manual row that is not ticked', async () => {
    const ticked = manualThrough(2).slice(1);
    const r = await run(['--step', '2', '--ticked', ticked.join(',')], allPass());
    expect(r.code).toBe(1);
    expect(r.out.at(-1)).toContain(manualThrough(2)[0]!);
  });

  it('ignores a failing row that gates a later step', async () => {
    const r = await run(
      ['--step', '1', '--ticked', manualThrough(1).join(',')],
      probesWith({ 'stripe-live-prices': { status: 'fail', reason: 'x' } }),
    );
    expect(r.code).toBe(0);
    expect(r.all).toContain('stripe-live-prices: fail (x)');
  });

  it('blocks on a failing row that gates an earlier step', async () => {
    const r = await run(
      ['--step', '4', '--ticked', manualThrough(4).join(',')],
      probesWith({ 'worker-healthz': { status: 'fail', reason: 'x' } }),
    );
    expect(r.code).toBe(1);
  });

  it('never counts unknown as pass, at any step', async () => {
    for (const step of [1, 2, 3, 4, 5]) {
      const r = await run(
        ['--step', String(step), '--ticked', manualThrough(step).join(',')],
        probesWith({
          'vercel-env-1': { status: 'unknown', reason: 'set VERCEL_TOKEN in scripts/.env.local' },
        }),
      );
      expect(r.code, `step ${step}`).toBe(1);
      expect(r.all).toContain(
        'vercel-env-step-1: unknown (set VERCEL_TOKEN in scripts/.env.local)',
      );
    }
  });

  it('turns a probe that throws into unknown, without its message', async () => {
    const probes = allPass();
    probes['worker-healthz'] = async () => {
      throw new Error('secret detail from a library');
    };
    const r = await run(['--ticked', manualThrough(1).join(',')], probes);
    expect(r.code).toBe(1);
    expect(r.all).toContain('worker-healthz: unknown (the probe failed (Error))');
    expect(r.all).not.toContain('secret detail');
  });

  it('prints one line per row, grouped by step', async () => {
    const r = await run([], allPass());
    for (const p of PRECONDITIONS)
      expect(
        r.out.filter((l) => l.startsWith(`  ${p.id}: `)),
        p.id,
      ).toHaveLength(1);
    for (const s of [1, 2, 3, 4, 5])
      expect(r.out.some((l) => l.startsWith(`step ${s}: `))).toBe(true);
  });
});

describe('the env file', () => {
  it('reads KEY=value lines, quoted or not, skipping comments', () => {
    expect(parseEnvFile('# c\nA=1\nexport B="two"\nC=\'3\'\n\nbad line')).toEqual({
      A: '1',
      B: 'two',
      C: '3',
    });
  });
});

describe('--env-file', () => {
  const readFrom = async (argv: string[], processEnv: Record<string, string | undefined>) => {
    const read: string[] = [];
    await main(argv, {
      processEnv,
      readFile: (p) => {
        read.push(p);
        return '';
      },
      fetch: scriptedFetch(() => json({})).fetch,
      now: () => new Date(Date.UTC(2026, 10, 13)),
      git: scriptedGit({}),
      out: () => {},
      err: () => {},
      probes: allPass(),
    });
    return read;
  };

  it("resolves a relative path against pnpm's caller directory (INIT_CWD)", async () => {
    expect(
      await readFrom(['--env-file', 'scripts/.env.local'], { INIT_CWD: '/caller/repo' }),
    ).toEqual(['/caller/repo/scripts/.env.local']);
  });

  it('keeps an absolute path, and resolves against the working directory without INIT_CWD', async () => {
    expect(await readFrom(['--env-file', '/abs/.env'], { INIT_CWD: '/caller' })).toEqual([
      '/abs/.env',
    ]);
    expect(await readFrom(['--env-file', 'rel/.env'], {})).toEqual([
      resolve(process.cwd(), 'rel/.env'),
    ]);
  });
});

describe('no token, file value or received value reaches what the command writes', () => {
  it('redacts planted values from stdout, stderr and the reported error, through the real probes', async () => {
    const tokens = {
      VERCEL_TOKEN: fakeToken(['vcp', 'planted'], 'v'),
      SUPABASE_ACCESS_TOKEN: fakeToken(['sbp', 'planted'], 's'),
      FLY_READ_TOKEN: fakeToken(['fo1', 'planted'], 'f'),
      STRIPE_LIVE_READ_KEY: ['rk', 'live', 'p'.repeat(30)].join('_'),
      RESEND_API_KEY: fakeToken(['re', 'planted'], 'r'),
    };
    const fileOnly = 'worker-signing-secret-value-planted-' + 'w'.repeat(16);
    const envText = [...Object.entries(tokens), ['WORKER_SIGNING_SECRET', fileOnly]]
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const received = {
      plain: 'a-plain-text-env-value-' + 'x'.repeat(12),
      body: 'an-error-body-from-the-api-' + 'y'.repeat(12),
      thrown: 'a-value-in-a-thrown-error-' + 'z'.repeat(12),
    };
    const fetch = scriptedFetch((url) => {
      switch (url.hostname) {
        case 'api.vercel.com':
          // A plain variable's value comes back without decrypt; the token is echoed too.
          return json({
            envs: [
              {
                key: 'CRAWL_WORKER_URL',
                value: received.plain,
                target: ['production'],
                echo: tokens.VERCEL_TOKEN,
              },
            ],
          });
        case 'api.supabase.com':
          return json({ message: received.body, token: tokens.SUPABASE_ACCESS_TOKEN }, 401);
        case 'api.machines.dev':
          throw new Error(`connect failed with ${tokens.FLY_READ_TOKEN} and ${received.thrown}`);
        case 'api.stripe.com':
          return json(
            { error: { message: `Invalid API Key provided: ${tokens.STRIPE_LIVE_READ_KEY}` } },
            401,
          );
        case 'api.resend.com':
          return new Response(`not json ${tokens.RESEND_API_KEY} ${received.body}`, {
            status: 500,
          });
        default:
          return json({ ok: true, body: received.body });
      }
    }).fetch;
    const out: string[] = [];
    const err: string[] = [];
    let thrown = '';
    try {
      await main(['--step', '5'], {
        processEnv: { VERCEL_TOKEN: tokens.VERCEL_TOKEN },
        readFile: () => envText,
        fetch,
        now: () => new Date(Date.UTC(2026, 10, 13)),
        git: scriptedGit({}),
        // A writer that echoes each line inside an error too, as a logger might.
        out: (s) => out.push(s),
        err: (s) => err.push(s),
      });
    } catch (e) {
      thrown = `${String(e)}\n${(e as Error).stack ?? ''}`;
    }
    const all = [...out, ...err, thrown].join('\n');
    // The leak was there to make: the probes ran and saw these hosts.
    expect(all).toContain('vercel-env-step-1:');
    expect(all).toContain('stripe-live-prices: unknown (Stripe prices answered HTTP 401)');
    for (const v of [...Object.values(tokens), fileOnly, ...Object.values(received)]) {
      expect(all).not.toContain(v);
    }
  });

  it('redacts a token and a received value even from a probe reason that quotes them', async () => {
    const token = fakeToken(['vcp', 'planted'], 'm');
    const got = 'a-received-value-quoted-by-a-bug-' + 'n'.repeat(10);
    const probes = allPass();
    probes['vercel-env-1'] = async (d) => {
      const res = await d.fetch(`https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env`);
      const body = (await res.json()) as { v: string };
      return { status: 'fail', reason: `token ${d.env.VERCEL_TOKEN} body ${body.v}` };
    };
    const out: string[] = [];
    await main([], {
      processEnv: {},
      readFile: () => `VERCEL_TOKEN=${token}`,
      fetch: scriptedFetch(() => json({ v: got })).fetch,
      now: () => new Date(),
      git: scriptedGit({}),
      out: (s) => out.push(s),
      err: (s) => out.push(s),
      probes,
    });
    const line = out.find((l) => l.startsWith('  vercel-env-step-1:'))!;
    expect(line).toBe(`  vercel-env-step-1: fail (token ${MASK} body ${MASK})`);
  });

  it('redacts a token from the one error main reports when the check itself fails', async () => {
    const token = fakeToken(['vcp', 'planted'], 'k');
    const err: string[] = [];
    const code = await main([], {
      processEnv: {},
      readFile: () => `VERCEL_TOKEN=${token}`,
      fetch: scriptedFetch(() => json({})).fetch,
      now: () => new Date(),
      git: scriptedGit({}),
      out: (s) => {
        throw new Error(`write failed on: ${s} ${token}`);
      },
      err: (s) => err.push(s),
    });
    expect(code).toBe(2);
    expect(err.join('\n')).toContain(MASK);
    expect(err.join('\n')).not.toContain(token);
  });
});

describe('the redactor masks secrets, not the words the check prints (review r1 N1)', () => {
  const mainWith = async (
    file: string,
    route: Parameters<typeof scriptedFetch>[0],
    probes?: Record<ProbeId, Probe>,
  ) => {
    const out: string[] = [];
    await main(['--step', '5'], {
      processEnv: {},
      readFile: () => file,
      fetch: scriptedFetch(route).fetch,
      now: () => new Date(Date.UTC(2026, 10, 13)),
      git: scriptedGit({}),
      out: (s) => out.push(s),
      err: (s) => out.push(s),
      probes,
    });
    return out.join('\n');
  };

  it('prints the worker host and the JSON keys a response carried, and masks a received value', async () => {
    const planted = 'a-received-secret-' + 'x'.repeat(12);
    const all = await mainWith(`FLY_READ_TOKEN=${fakeToken(['fo1'])}`, (url) => {
      if (url.hostname === 'crawlmouse-worker.fly.dev')
        return json({ ok: true, app: 'crawlmouse-worker', statements: planted });
      return json([
        { state: 'started', image_ref: { repository: 'crawlmouse-worker', tag: planted } },
      ]);
    });
    expect(all).toContain(
      'worker-healthz: pass (https://crawlmouse-worker.fly.dev/healthz answered 200 ok)',
    );
    expect(all).not.toContain(planted);
  });

  it('masks a received string of 12 characters or more, and leaves a shorter one', async () => {
    const long = 'r'.repeat(12);
    const short = 's'.repeat(11);
    const probes = allPass();
    probes['vercel-env-1'] = async (d) => {
      await d.fetch(`https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env`);
      return { status: 'fail', reason: `${long} ${short}` };
    };
    const all = await mainWith(
      `VERCEL_TOKEN=${fakeToken(['vcp'])}`,
      () => json({ a: long, b: short }),
      probes,
    );
    expect(all).toContain(`vercel-env-step-1: fail (${MASK} ${short})`);
  });

  it('registers a short file value only for a token-named variable', async () => {
    const probes = allPass();
    probes['vercel-env-1'] = async (d) => ({
      status: 'fail',
      reason: `token ${d.env.VERCEL_TOKEN} pepper ${d.env.TRIAL_LEDGER_PEPPER} region iad 1`,
    });
    const all = await mainWith(
      'CRAWL_PAUSED=1\nWORKER_REGION=iad\nVERCEL_TOKEN=tok9\nTRIAL_LEDGER_PEPPER=pep7',
      () => json({}),
      probes,
    );
    expect(all).toContain('step 1: ');
    expect(all).toContain('golive:check — gating step 5');
    expect(all).toContain(`vercel-env-step-1: fail (token ${MASK} pepper ${MASK} region iad 1)`);
  });

  it('masks a long file value whatever its name', async () => {
    const value = 'https://some-long-value.example/' + 'p'.repeat(8);
    const probes = allPass();
    probes['vercel-env-1'] = async (d) => ({ status: 'fail', reason: `${d.env.CRAWL_WORKER_URL}` });
    const all = await mainWith(`CRAWL_WORKER_URL=${value}`, () => json({}), probes);
    expect(all).toContain(`vercel-env-step-1: fail (${MASK})`);
  });

  it('the early redactor reads the file --env-file names', () => {
    const value = 'an-env-file-secret-' + 'e'.repeat(12);
    const read: string[] = [];
    const early = earlyRedactor(
      ['--', '--env-file', 'other/.env'],
      { INIT_CWD: '/caller' },
      (p) => {
        read.push(p);
        return `SOME_SECRET=${value}\nVERCEL_TOKEN=tok9`;
      },
    );
    expect(read).toEqual(['/caller/other/.env']);
    expect(early.redact(`x ${value} tok9 step 1`)).toBe(`x ${MASK} ${MASK} step 1`);
  });
});
