/**
 * Test support for the report routes: an Agency account that keeps the engine's recorded site,
 * checked twice (the re-check verifies the orphan fix), and a second client site; the people who do
 * and do not reach them; and a bucket in memory.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { insertRow, prepareMeasurement, ROWS } from '../../../__tests__/helpers/v2-check-tables';
import {
  addSeat,
  keptSite,
  makePaid,
  person,
  removeSeat,
  type Person,
} from '../account/sites-test-support';
import { memoryEvidenceStore } from '../pipeline/test-support/memory-evidence';
import {
  FIRST,
  keepSite,
  persistBuild,
  SECOND,
  secondInput,
} from '../pipeline/test-support/public-checks';
import type { ReportFile } from './generate';
import type { ReportBucket } from './generate-run';

export interface ReportWorld {
  accountId: string;
  owner: Person;
  /** An unscoped account manager. */
  manager: Person;
  /** A developer whose seat covers the recorded site only. */
  developer: Person;
  /** A developer whose seat covers the other client site only. */
  outOfScope: Person;
  /** Held an unscoped account manager seat, since removed. */
  removed: Person;
  /** The owner of another account, on Free, with a site and a check of its own. */
  stranger: Person & { site: string; check: string };
  /** The recorded site, kept by the account: its two checks and the fix the second verified. */
  site: { id: string; first: string; second: string; verifiedFix: string; openFix: string };
  /** Another client site of the account, with one finished check. */
  other: { id: string; check: string };
  builds: { first: BuiltCheck; second: BuiltCheck };
}

/** A kept site of `accountId` with one finished check, written as postgres. */
async function siteWithCheck(db: PGlite, accountId: string) {
  const site = await keptSite(db, accountId);
  const check = randomUUID();
  await insertRow(db, 'checks', ROWS.checks(check, site.id));
  return { id: site.id, check };
}

/** Call it once on a database the migrations were applied to: the recorded site's ids are fixed. */
export async function reportWorld(db: PGlite): Promise<ReportWorld> {
  await prepareMeasurement(db);
  const owner = await person(db, 'owner');
  const accountId = owner.accountId;
  await makePaid(db, accountId, 'agency');

  const evidence = memoryEvidenceStore();
  const input = recordedBuild();
  const first = await persistBuild(db, evidence, input);
  await keepSite(db, input.site.id, accountId);
  const second = await persistBuild(db, evidence, secondInput(first), { siteSeeded: true });
  await keepSite(db, input.site.id, accountId);
  const verified = second.fix_events.find((e) => e.kind === 'verified');
  const open = second.fixes.find((f) => f.status === 'open');
  if (!verified || !open) throw new Error('reportWorld: the recorded re-check changed shape');

  const other = await siteWithCheck(db, accountId);
  const [manager, developer, outOfScope, removed, stranger] = [
    await person(db, 'manager'),
    await person(db, 'developer'),
    await person(db, 'out-of-scope'),
    await person(db, 'removed'),
    await person(db, 'stranger'),
  ];
  await addSeat(db, accountId, manager, 'account_manager');
  await addSeat(db, accountId, developer, 'developer', [input.site.id]);
  await addSeat(db, accountId, outOfScope, 'developer', [other.id]);
  await removeSeat(db, await addSeat(db, accountId, removed, 'account_manager'));
  const theirs = await siteWithCheck(db, stranger.accountId);
  return {
    accountId,
    owner,
    manager,
    developer,
    outOfScope,
    removed,
    stranger: { ...stranger, site: theirs.id, check: theirs.check },
    site: {
      id: input.site.id,
      first: FIRST,
      second: SECOND,
      verifiedFix: verified.fix_id,
      openFix: open.id,
    },
    other,
    builds: { first, second },
  };
}

/** A bucket in memory: what was put and how many times, and each address it was asked to sign. */
export function memoryReportBucket() {
  const objects = new Map<string, ReportFile>();
  const signed: [path: string, seconds: number][] = [];
  const state = { refuse: false, puts: 0 };
  const bucket: ReportBucket = {
    async put(path, file) {
      if (state.refuse) throw new Error('the bucket refused the file');
      state.puts++;
      objects.set(path, file);
    },
    async signedUrl(path, seconds) {
      signed.push([path, seconds]);
      return `https://storage.test/reports/${path}?token=signed`;
    },
  };
  return { objects, signed, state, bucket };
}
