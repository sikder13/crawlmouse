/**
 * What a view function reads: a contract fixture, or a persisted check read back by the pipeline
 * (`loadCheck`). The two differ in `provenance` alone, which no view reads.
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import type { CheckDataset } from '../pipeline/types';

export type ViewDataset = FixtureDataset | CheckDataset;
