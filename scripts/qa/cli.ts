import { pathToFileURL } from 'node:url';
import { seedBilling } from './billing';
import { QaInboxError } from './inbox';
import { reset } from './reset';
import { exitCode, seed } from './seed';

/**
 * `pnpm qa:seed [--billing [--live]]` and `pnpm qa:reset` (CC-38 D1, D2).
 *   qa:seed                  part (a): users, accounts, markers, sites, the seat, the Pro trial
 *   qa:seed --billing        part (a), then a Checkout Session per paid QA account, in test mode
 *   qa:seed --billing --live the same in live mode, after the accounts are printed and confirmed
 *   qa:reset                 every QA account back to its starting sites, checks, fixes and seats
 * The exit code is 1 when a step was refused, 2 for a command line or environment it cannot run.
 */

export type Command =
  | { command: 'seed'; billing: boolean; live: boolean }
  | { command: 'reset' }
  | { error: string };

export function parseArgs(argv: readonly string[]): Command {
  // pnpm passes the root script's `--` through; it separates nothing here (as golive/check.ts reads it).
  const [command, ...flags] = argv.filter((a) => a !== '--');
  const unknown = (allowed: readonly string[]) => flags.find((f) => !allowed.includes(f));
  if (command === 'reset') {
    const bad = unknown([]);
    return bad === undefined ? { command: 'reset' } : { error: `qa:reset takes no ${bad}` };
  }
  if (command !== 'seed') return { error: 'usage: cli.ts seed [--billing [--live]] | reset' };
  const bad = unknown(['--billing', '--live']);
  if (bad !== undefined) return { error: `qa:seed does not know ${bad}` };
  if (new Set(flags).size !== flags.length) return { error: 'a flag is given twice' };
  const billing = flags.includes('--billing');
  const live = flags.includes('--live');
  if (live && !billing) return { error: '--live goes with --billing only' };
  return { command: 'seed', billing, live };
}

type Wire = (typeof import('./wiring'))['wire'];

export interface MainDeps {
  env: Readonly<Record<string, string | undefined>>;
  print(line: string): void;
  error(line: string): void;
  /** The wiring; ./wiring's `wire` unless a test gives another. */
  wire?: Wire;
}

export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
  const cmd = parseArgs(argv);
  if ('error' in cmd) {
    deps.error(cmd.error);
    return 2;
  }
  // Imported here, not above: the wiring loads the app's Stripe and Inngest modules, which parsing
  // the arguments (and the argument test) needs none of.
  const { wire: realWire, WiringError } = await import('./wiring');
  const wire = deps.wire ?? realWire;
  let wired: ReturnType<Wire>;
  let billing: ReturnType<ReturnType<Wire>['billing']> | null = null;
  try {
    wired = wire(deps.env, deps.print);
    // --billing's Stripe key, mode and database are checked before part (a) writes anything.
    if (cmd.command === 'seed' && cmd.billing) billing = wired.billing();
  } catch (e) {
    if (!(e instanceof QaInboxError || e instanceof WiringError)) throw e;
    deps.error(e.message);
    return 2;
  }
  if (cmd.command === 'reset') return exitCode(await reset(wired.reset));
  const steps = await seed(wired.seed);
  if (billing === null) return exitCode(steps);
  // Part (a) refused to create its users: nothing to bill.
  if (steps.some((s) => s.key === 'run' && s.outcome === 'refused')) return exitCode(steps);
  const billed = await seedBilling(billing, { live: cmd.live });
  return exitCode([...steps, ...billed]);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), {
    env: process.env,
    print: (line) => console.log(line),
    error: (line) => console.error(line),
  }).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
