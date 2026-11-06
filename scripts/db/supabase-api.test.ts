import { describe, expect, it } from 'vitest';
import { waitForReplay, type ActionRun } from './supabase-api';

type Steps = Array<[string, string]>;
const run = (steps: Steps, id = 'run1', created_at = '2026-11-06T06:45:30Z'): ActionRun => ({
  id,
  created_at,
  run_steps: steps.map(([name, status]) => ({ name, status })),
});

/** A fake API that answers each poll with the next listing, repeating the last one. */
function fake(listings: ActionRun[][]) {
  let polls = 0;
  return {
    api: {
      listActionRuns: async () => listings[Math.min(polls++, listings.length - 1)]!,
    },
    polls: () => polls,
  };
}
const opts = { sleep: async () => {}, log: () => {}, intervalMs: 1, timeoutMs: 60_000 };

// The sequence read from a real branch on 2026-11-06: the replay step went from RUNNING back to
// CREATED when a `pull` step appeared, and only then did every step finish.
const OBSERVED: ActionRun[][] = [
  [
    run([
      ['configure', 'RUNNING'],
      ['deploy', 'EXITED'],
      ['migrate', 'CREATED'],
    ]),
  ],
  [
    run([
      ['configure', 'RUNNING'],
      ['deploy', 'EXITED'],
      ['migrate', 'RUNNING'],
    ]),
  ],
  [
    run([
      ['configure', 'RUNNING'],
      ['deploy', 'EXITED'],
      ['migrate', 'CREATED'],
      ['pull', 'EXITED'],
    ]),
  ],
  [
    run([
      ['configure', 'EXITED'],
      ['deploy', 'EXITED'],
      ['migrate', 'EXITED'],
      ['pull', 'EXITED'],
    ]),
  ],
];

describe('waitForReplay waits for the branch replay to finish', () => {
  it('returns only after every step has finished on two polls in a row', async () => {
    const f = fake(OBSERVED);
    const state = await waitForReplay(f.api, 'branchref', opts);
    expect(state).toEqual({
      settled: true,
      failed: [],
      steps: 'configure=EXITED deploy=EXITED migrate=EXITED pull=EXITED',
    });
    expect(f.polls()).toBe(5);
  });

  it('does not return on one finished-looking poll that is followed by a running one', async () => {
    const done = run([
      ['deploy', 'EXITED'],
      ['migrate', 'EXITED'],
    ]);
    const f = fake([
      [done],
      [
        run([
          ['deploy', 'EXITED'],
          ['migrate', 'RUNNING'],
        ]),
      ],
      [done],
      [done],
    ]);
    const state = await waitForReplay(f.api, 'branchref', opts);
    expect(state.settled).toBe(true);
    expect(f.polls()).toBe(4);
  });

  it('is not finished while the run has no replay step', async () => {
    // A run whose only step has finished, seen three times, then the replay step appears.
    const early = run([['deploy', 'EXITED']]);
    const later = run([
      ['deploy', 'EXITED'],
      ['migrate', 'EXITED'],
    ]);
    const f = fake([[early], [early], [early], [later]]);
    const state = await waitForReplay(f.api, 'branchref', opts);
    expect(state).toEqual({ settled: true, failed: [], steps: 'deploy=EXITED migrate=EXITED' });
    expect(f.polls()).toBe(5);
  });

  it('reports a DEAD step as failed once the run has finished', async () => {
    const dead = run([
      ['deploy', 'EXITED'],
      ['migrate', 'DEAD'],
    ]);
    const state = await waitForReplay(fake([[dead]]).api, 'branchref', opts);
    expect(state).toEqual({
      settled: true,
      failed: ['migrate'],
      steps: 'deploy=EXITED migrate=DEAD',
    });
  });

  it('counts PAUSED as finished: Supabase uses it for a warning or a skipped step', async () => {
    const paused = run([
      ['health', 'PAUSED'],
      ['migrate', 'EXITED'],
    ]);
    const state = await waitForReplay(fake([[paused]]).api, 'branchref', opts);
    expect(state).toEqual({ settled: true, failed: [], steps: 'health=PAUSED migrate=EXITED' });
  });

  it('returns unsettled with the last steps at the deadline', async () => {
    const f = fake([[run([['migrate', 'RUNNING']])]]);
    const state = await waitForReplay(f.api, 'branchref', { ...opts, timeoutMs: 0 });
    expect(state).toEqual({ settled: false, failed: [], steps: 'migrate=RUNNING' });
  });

  it('reads the newest run when the branch has several', async () => {
    const old = run([['migrate', 'DEAD']], 'old', '2026-11-06T06:00:00Z');
    const now = run([['migrate', 'EXITED']], 'new', '2026-11-06T06:45:30Z');
    const state = await waitForReplay(fake([[now, old]]).api, 'branchref', opts);
    expect(state).toEqual({ settled: true, failed: [], steps: 'migrate=EXITED' });
  });
});
