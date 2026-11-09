/**
 * Database rows, as PostgREST returns them, to contract records. Workstream A implements these; the
 * read-back and the pipeline's store both use them.
 */
import type { DiffInputs } from '@crawlmouse/engine/v2/pipeline';
import type { Check, Fix, FixEvent, PageResult, Site } from '@crawlmouse/types/v2';

type Row = Record<string, unknown>;
const todo = (name: string): never => {
  throw new Error(`${name}: workstream A implements this`);
};

export const checkFromRow = (_row: Row): Check => todo('checkFromRow');
export const siteFromRow = (_row: Row): Site => todo('siteFromRow');
export const fixFromRow = (_row: Row): Fix => todo('fixFromRow');
export const fixEventFromRow = (_row: Row): FixEvent => todo('fixEventFromRow');
export const pageResultFromRow = (_row: Row): PageResult => todo('pageResultFromRow');
/** `checks.diff_inputs`, parsed; null when the check stored none. */
export const diffInputsFromRow = (_row: Row): DiffInputs | null => todo('diffInputsFromRow');
