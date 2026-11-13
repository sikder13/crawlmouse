import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOC_PATH, renderBudget } from './budget-doc';
import {
  FUNCTIONS,
  HOBBY_HEADROOM_LINE,
  SHAPES,
  checkExecutions,
  cronPerDay,
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
