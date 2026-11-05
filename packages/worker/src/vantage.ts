import { FlyRegionSchema, WorkerReleaseSchema, type SourceIpClass } from '@crawlmouse/types/v2';

/**
 * Where the worker's requests leave from, read from the environment Fly gives every Machine
 * (https://fly.io/docs/machines/runtime-environment/): FLY_REGION, the region's three-letter code,
 * and FLY_MACHINE_ID. Both present: a Fly Machine, so `fly_egress` and its region. Otherwise
 * `other_egress` and no region; FLY_REGION alone is a variable anyone can set and is not taken as
 * Fly. A malformed FLY_REGION on a Machine stops the worker at start rather than record a region it
 * cannot vouch for.
 */

export const UNRELEASED = 'unreleased';

export interface Vantage {
  flyRegion: string | null;
  sourceIpClass: Extract<SourceIpClass, 'fly_egress' | 'other_egress'>;
  /** The build (release.ts): the first 12 hex digits of its commit, or `unreleased`. */
  release: string;
}

type Env = Readonly<Record<string, string | undefined>>;

export function vantageOf(env: Env, release: string): Vantage {
  if (!WorkerReleaseSchema.safeParse(release).success)
    throw new Error(`worker release must be 12 hex digits or "${UNRELEASED}"`);
  if (env.FLY_MACHINE_ID === undefined || env.FLY_REGION === undefined)
    return { flyRegion: null, sourceIpClass: 'other_egress', release };
  if (!FlyRegionSchema.safeParse(env.FLY_REGION).success)
    throw new Error('FLY_REGION must be a three-letter lower-case Fly region code');
  return { flyRegion: env.FLY_REGION, sourceIpClass: 'fly_egress', release };
}

/** The vantage of a worker run off Fly from an unreleased build, as tests and local runs are. */
export const LOCAL_VANTAGE: Vantage = vantageOf({}, UNRELEASED);
