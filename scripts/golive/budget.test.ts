import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACE } from '@crawlmouse/inngest/check';
import { DOC_PATH, renderBudget } from './budget-doc';
import {
  FUNCTIONS,
  HOBBY_HEADROOM_LINE,
  SHAPES,
  MAX_SECONDS,
  SEARCH,
  checkExecutions,
  cronPerDay,
  cronRunsPerDay,
  heaviestSearched,
  finishedFanOut,
  floorBySwitchOn,
  hobbyVerdict,
  monthlyFloor,
  type CheckShape,
} from './budget';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const INNGEST = join(ROOT, 'inngest');

/** The source without comments, so a step named in prose is not counted as a call. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const STEP_CALL = /\bstep\.(run|sleep|sleepUntil|waitForEvent|sendEvent|invoke)\(/g;
const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;
/** A `cron: '…'` trigger, in any quote. */
const CRON_LITERAL = /\bcron\s*:\s*(['"`])([^'"`]+)\1/g;
/** `onFailure` as an options key: property, method or shorthand. */
const ON_FAILURE = /(?<![\w$])onFailure\s*(?::|\(|,|\})/g;

const functionFiles = (): string[] =>
  readdirSync(INNGEST)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `inngest/${f}`)
    .filter((f) => count(code(readFileSync(join(ROOT, f), 'utf8')), /createFunction\(/g) > 0);

describe('the function rows against the code', () => {
  it('has one row per createFunction call, in each file that makes one', () => {
    for (const file of functionFiles()) {
      const made = count(code(readFileSync(join(ROOT, file), 'utf8')), /createFunction\(/g);
      expect(FUNCTIONS.filter((f) => f.file === file).length, file).toBe(made);
    }
    expect(new Set(FUNCTIONS.map((f) => f.file))).toEqual(new Set(functionFiles()));
  });

  it("names each file's step call sites, so a step added to a function fails here", () => {
    for (const file of functionFiles()) {
      const sites = count(code(readFileSync(join(ROOT, file), 'utf8')), STEP_CALL);
      const rows = FUNCTIONS.filter((f) => f.file === file);
      expect(
        rows.reduce((s, f) => s + f.callSites, 0),
        file,
      ).toBe(sites);
    }
  });

  it('reads the Inngest id each row names from its file', () => {
    for (const f of FUNCTIONS) {
      const text = readFileSync(join(ROOT, f.file), 'utf8');
      const constant = new RegExp(`_FN_ID = '${f.id.replace(/\./g, '\\.')}'`);
      const literal = new RegExp(`id: '${f.id.replace(/\./g, '\\.')}'`);
      expect(constant.test(text) || literal.test(text), `${f.id} in ${f.file}`).toBe(true);
    }
  });

  it('marks onFailure on exactly the rows of each file that declare it', () => {
    for (const file of functionFiles()) {
      const declared = count(code(readFileSync(join(ROOT, file), 'utf8')), ON_FAILURE);
      expect(FUNCTIONS.filter((f) => f.file === file && f.onFailure).length, file).toBe(declared);
    }
    // Independent of the regex: inngest/audit.ts:411 and inngest/check.ts:376 declare it, nothing else.
    expect(
      FUNCTIONS.filter((f) => f.onFailure)
        .map((f) => f.id)
        .sort(),
    ).toEqual(['crawlmouse.audit', 'crawlmouse.check.run']);
  });

  it.each([
    ['a property', 'createFunction({ id, onFailure: async () => {} }, t, h)'],
    ['a property with a space', 'createFunction({ id, onFailure : handler }, t, h)'],
    ['a method', 'createFunction({ id, async onFailure({ event }) {} }, t, h)'],
    ['a plain method', 'createFunction({ id, onFailure() {} }, t, h)'],
    ['shorthand', 'createFunction({ id, onFailure }, t, h)'],
    ['shorthand mid-list', 'createFunction({ onFailure, id }, t, h)'],
  ])('finds onFailure written as %s', (_label, text) => {
    expect(count(code(text), ON_FAILURE)).toBe(1);
  });

  it('does not count onFailure in a comment, or a name that only contains it', () => {
    expect(
      count(code('// onFailure: x\n/* onFailure() */\nconst myOnFailureX = 1;'), ON_FAILURE),
    ).toBe(0);
  });

  it("names each cron row's schedule as its file writes it", () => {
    for (const file of functionFiles()) {
      const literals = [...code(readFileSync(join(ROOT, file), 'utf8')).matchAll(CRON_LITERAL)]
        .map((m) => m[2]!)
        .sort();
      const rows = FUNCTIONS.filter((f) => f.file === file && f.cron !== null)
        .map((f) => f.cron!)
        .sort();
      expect(rows, file).toEqual(literals);
    }
  });

  it.each([
    ["{ cron: '0 3 * * *' }", '0 3 * * *'],
    ['{cron:"*/10 * * * *"}', '*/10 * * * *'],
    ['{ cron : `11 * * * *` }', '11 * * * *'],
  ])('reads the cron literal in %s', (text, cron) => {
    expect([...text.matchAll(CRON_LITERAL)].map((m) => m[2])).toEqual([cron]);
  });

  it('cites, for each event row, lines of its file that hold a step call', () => {
    for (const f of FUNCTIONS.filter((x) => x.cron === null && x.id !== 'crawlmouse.check.run')) {
      expect(f.stepAt?.length, f.id).toBeGreaterThan(0);
      const lines = readFileSync(join(ROOT, f.file), 'utf8').split('\n');
      for (const at of f.stepAt!) {
        expect(count(code(lines[at - 1] ?? ''), STEP_CALL), `${f.file}:${at}`).toBe(1);
      }
      expect(new Set(f.stepAt).size, f.id).toBe(f.stepAt!.length);
    }
  });

  // Counted by hand from each file (the step call lines), independently of STEP_CALL and the rows.
  const HAND: Record<string, number> = {
    'inngest/audit.ts': 5, // 357 361 376 378 386
    'inngest/billing.ts': 5, // 65 77 95 116 120
    'inngest/check.ts': 13, // 193 197 205 235 256 313 379 380 390 391 392 445 447
    'inngest/check-reaper.ts': 1, // 39
    'inngest/check-expiry.ts': 2, // 41 44
    'inngest/trial-lifecycle.ts': 6, // 87 89 99 102 103 113
    'inngest/past-due-sweep.ts': 4, // 51 52 58 61
    'inngest/deletion.ts': 6, // 73 85 97 98 106 110
    'inngest/mail.ts': 5, // 88 99 110 126 141
    'inngest/schedule.ts': 5, // 98 104 113 122 139
    'inngest/alerts.ts': 2, // 51 57
    'inngest/summary.ts': 4, // 52 57 61 88
  };
  it.each(Object.entries(HAND))('counts %s step call sites as a hand count does', (file, hand) => {
    expect(count(code(readFileSync(join(ROOT, file), 'utf8')), STEP_CALL)).toBe(hand);
    expect(
      FUNCTIONS.filter((f) => f.file === file).reduce((n, f) => n + f.callSites, 0),
      file,
    ).toBe(hand);
  });

  it('has a hand count for every file that makes a function', () => {
    expect(Object.keys(HAND).sort()).toEqual(functionFiles().sort());
  });

  it('does not count a step named only in a comment', () => {
    expect(
      count(code("// step.run('x')\n/* step.sleep('y') */\nstep.run('z', f)"), STEP_CALL),
    ).toBe(1);
  });
});

describe('a check, by running runCheck', () => {
  // Counted by hand from inngest/check.ts, independently of the simulation:
  //   run 1 · claim 1 · discover 1
  //   crawl-1: post 1, wait-1 (5 s) poll-1 running, wait-2 (10 s) poll-2 done → 4, read 1  = 6
  //   crawl-2-post answers none                                                             = 1
  //   access-1: as crawl-1                                                                  = 6
  //   access-2-post answers not_needed                                                      = 1
  //   render, build, persist, emit, finalize                                                = 5
  it('counts 22 executions for the typical shape (one batch of 14 s each phase)', async () => {
    expect(await checkExecutions(SHAPES.find((s) => s.label === 'typical')!)).toBe(22);
  });

  // A batch done at its first poll is post, wait, poll, read: 4. Two batches and both access stages:
  // 1 + 1 + 1 + 2×4 + 1 (crawl-3-post none) + 2×4 + 5 = 25.
  it('counts 25 for two crawl batches and both access stages, each done at the first poll', async () => {
    const shape: CheckShape = {
      label: 't',
      why: '',
      claimWaits: 0,
      crawlBatches: 2,
      accessStages: 2,
      batchSeconds: 5,
    };
    expect(await checkExecutions(shape)).toBe(25);
  });

  it('adds two per claim wait (a sleep and a claim)', async () => {
    const base: CheckShape = {
      label: 't',
      why: '',
      claimWaits: 0,
      crawlBatches: 1,
      accessStages: 1,
      batchSeconds: 5,
    };
    expect(
      (await checkExecutions({ ...base, claimWaits: 3 })) - (await checkExecutions(base)),
    ).toBe(6);
  });

  it('adds two per poll: 64 s past the post is polled at 5, 15, 35, 65 s', async () => {
    const base: CheckShape = {
      label: 't',
      why: '',
      claimWaits: 0,
      crawlBatches: 1,
      accessStages: 1,
      batchSeconds: 5,
    };
    const long = { ...base, batchSeconds: 64 };
    // Two batches (crawl-1, access-1), each three polls more than the 5 s batch.
    expect((await checkExecutions(long)) - (await checkExecutions(base))).toBe(2 * 3 * 2);
  });
});

describe('a cron schedule, read', () => {
  it.each([
    ['*/10 * * * *', 144],
    ['0 * * * *', 24],
    ['11 * * * *', 24],
    ['0 3 * * *', 1],
    ['17 5 * * *', 1],
    ['* * * * *', 1440],
    ['*/15 */2 * * *', 48],
  ])('runs %s %i times a day', (cron, perDay) => {
    expect(cronRunsPerDay(cron)).toBe(perDay);
  });

  it.each([
    '0 3 * * 1',
    '0 3 1 * *',
    '0 3 * 1 *',
    '*/7 * * * *',
    '0 3 * *',
    '0-5 * * * *',
    '60 * * * *',
  ])('refuses %s, a form it does not read', (cron) => {
    expect(() => cronRunsPerDay(cron)).toThrow();
  });

  it("derives each cron row's runs a day from its schedule", () => {
    const reaper = FUNCTIONS.find((f) => f.id === 'crawlmouse.check.reaper')!;
    expect(reaper.cron).toBe('*/10 * * * *');
    expect(reaper.runsPerDay).toBe(144);
    for (const f of FUNCTIONS)
      expect(f.runsPerDay, f.id).toBe(f.cron === null ? 0 : cronRunsPerDay(f.cron));
  });
});

describe('a check against a worker that answers busy, runs long or loses a batch', () => {
  const one: CheckShape = {
    label: 't',
    why: '',
    claimWaits: 0,
    crawlBatches: 1,
    accessStages: 1,
    batchSeconds: 5,
  };
  // Hand count of `one`: run, claim, discover; crawl-1 post, wait, poll, read (4); crawl-2-post
  // none (1); access-1 as crawl-1 (4); access-2-post not_needed (1); render, build, persist, emit,
  // finalize (5). 1 + 1 + 1 + 4 + 1 + 4 + 1 + 5 = 18.
  it('counts 18 for one batch each phase, done at the first poll', async () => {
    expect(await checkExecutions(one)).toBe(18);
  });

  it('adds a sleep and a post for each busy answer, on each of the four posts', async () => {
    expect(await checkExecutions({ ...one, busyPerPost: 1 })).toBe(18 + 4 * 2);
    // At 20 busy answers a post the clock decides: run, claim, discover 3; crawl-1-post 20 busy (post
    // and 30 s sleep each) and taken 41, now 600 s; wait 5 s, poll, read 3, now 605 s; crawl-2-post
    // busy: the 20th sleep reaches 1,205 s, past the finish timeout: 40. 3 + 41 + 3 + 40 = 87.
    expect(await checkExecutions({ ...one, busyPerPost: PACE.busyRetries })).toBe(87);
  });

  it('refuses more busy answers than a post retries', async () => {
    await expect(checkExecutions({ ...one, busyPerPost: PACE.busyRetries + 1 })).rejects.toThrow();
  });

  it('polls a batch done just before its deadline 12 times', async () => {
    // Polls at 5, 15, 35, 65, 95, …, 275, 305 s after the post: 12, the last past 299 s.
    const atDeadline = { ...one, batchSeconds: MAX_SECONDS + PACE.pollGraceS - 1 };
    expect(await checkExecutions(atDeadline)).toBe(18 + 2 * (11 * 2));
  });

  it('re-posts a batch whose first read finds it gone: repost, wait, poll, read-2', async () => {
    expect(await checkExecutions({ ...one, readFailsFirst: true })).toBe(18 + 2 * 4);
  });

  it('stops counting at the sleep that passes the finish timeout', async () => {
    // Hand count: run 1; claim 1 and five waits of 60 s (sleep + claim) 10, now 300 s; discover 1;
    // crawl-1-post busy 20 times (20 posts, 20 sleeps of 30 s) and taken at the 21st post: 41, now
    // 900 s; polls at 905, 915, 935, 965, 995, …, 1175 (11 sleeps, 11 polls): 22; the sleep to 1205 s
    // passes 1,200 s and is the last: 1. 1 + 1 + 10 + 1 + 41 + 22 + 1 = 77.
    const cut: CheckShape = {
      ...one,
      claimWaits: PACE.claimWaits,
      busyPerPost: PACE.busyRetries,
      batchSeconds: MAX_SECONDS + PACE.pollGraceS - 1,
    };
    expect(PACE.finishS).toBe(1200);
    expect(await checkExecutions(cut)).toBe(77);
  });

  it('names as heaviest the largest count of the shapes it tries, and says it is no bound', async () => {
    const { shape, executions, tried } = await heaviestSearched();
    expect(tried).toBe(2 * 3 * 4 * 2);
    expect(await checkExecutions(shape)).toBe(executions);
    for (const busyPerPost of SEARCH.busyPerPost)
      for (const batchSeconds of SEARCH.batchSeconds) {
        const other = { ...shape, busyPerPost, batchSeconds };
        expect(await checkExecutions(other)).toBeLessThanOrEqual(executions);
      }
    expect(shape.why).toMatch(/Not a bound/);
    expect(shape.why).not.toMatch(/the constants' bound/);
  });

  it("copies max_seconds from the pipeline's limits", () => {
    const limits = readFileSync(join(ROOT, 'apps/web/lib/v2/pipeline/limits.ts'), 'utf8');
    expect([...limits.matchAll(/max_seconds: (\d+)/g)].map((m) => Number(m[1]))).toEqual([
      MAX_SECONDS,
      MAX_SECONDS,
    ]);
  });
});

describe('the month', () => {
  it('computes the floor from the cron rows: runs a day × (1 + idle steps) × 31', () => {
    // Independent sum: reaper 144×2, three hourly ticks and the sweep 24×3 each, five dailies.
    const hand = (144 * 2 + 24 * 3 * 3 + (2 + 1) + (2 + 1) + (1 + 2) + (1 + 2) + (1 + 1)) * 31;
    expect(monthlyFloor()).toBe(hand);
    expect(FUNCTIONS.filter((f) => f.runsPerDay > 0).map(cronPerDay)).toHaveLength(9);
  });

  it('counts a finished check as starting three functions of two executions each', () => {
    expect(finishedFanOut()).toBe(6);
  });

  it('fails the Hobby plan when the floor plus 1,000 typical checks passes the line', async () => {
    const { total, passes } = await hobbyVerdict();
    expect(total).toBe(monthlyFloor() + 1_000 * (22 + 6));
    expect(passes).toBe(total <= HOBBY_HEADROOM_LINE);
  });
});

describe('docs/ops/inngest-budget.md', () => {
  it('is the render of the model, byte for byte', async () => {
    expect(readFileSync(DOC_PATH, 'utf8')).toBe(await renderBudget());
  });
});

describe('the floor by switch-on step', () => {
  it('starts schedule and summary only once V2_CHECKS_PUBLIC joins V2_PIPELINE', () => {
    const [pipeline, door, checks, billing] = floorBySwitchOn();
    // V2_PIPELINE: v1's 3+3 a day, the reaper 288, the expiry 3.
    expect(pipeline!.floor).toBe((3 + 3 + 288 + 3) * 31);
    expect(door!.floor).toBe(pipeline!.floor);
    // V2_CHECKS_PUBLIC adds the purge 3, the contact purge 2, the schedule and summary ticks 72 each.
    expect(checks!.floor).toBe(door!.floor + (3 + 2 + 72 + 72) * 31);
    // V2_BILLING adds the past-due sweep, 72 a day.
    expect(billing!.floor).toBe(checks!.floor + 72 * 31);
    expect(billing!.floor).toBe(monthlyFloor());
  });
});
