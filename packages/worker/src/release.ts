import { UNRELEASED } from './vantage.js';

/**
 * The worker build. build.ts writes the first 12 hex digits of the commit it bundles into
 * `__WORKER_RELEASE__`; code that is not bundled (tests, `tsx`) has none, and is `unreleased`.
 */
declare const __WORKER_RELEASE__: string | undefined;

export const RELEASE: string =
  typeof __WORKER_RELEASE__ === 'string' ? __WORKER_RELEASE__ : UNRELEASED;
