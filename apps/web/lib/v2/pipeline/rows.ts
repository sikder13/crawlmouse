/**
 * Database rows, as PostgREST returns them (`to_jsonb` serialises a row the same way), to contract
 * records. The read-back (load.ts) and the pipeline's store both use them.
 *
 * Each converter reads the entity's fields from its contract schema and takes those from the row, so a
 * database-only or generated column is left behind; writes each of those fields that is a timestamp
 * as the contract's UTC instant, digit for digit (instantFromDb); and parses the record with the
 * entity's schema, so a row the contract refuses, or one read without a contract column, throws here.
 * A jsonb column holding JSON null and a SQL null both arrive as null, which is the contract's null.
 */
import type { DiffInputs } from '@crawlmouse/engine/v2/pipeline';
import {
  AccessTestSchema,
  ChangeSchema,
  CheckSchema,
  FingerprintSchema,
  FixEventSchema,
  FixSchema,
  FixTypeSchema,
  LinkEdgeSchema,
  MeasurementLineageSchema,
  PageResultSchema,
  SiteSchema,
  UsageEventSchema,
  type AccessTest,
  type Change,
  type Check,
  type Fix,
  type FixEvent,
  type LinkEdge,
  type MeasurementLineage,
  type PageResult,
  type Site,
  type UsageEvent,
} from '@crawlmouse/types/v2';
import { z } from 'zod';

type Row = Record<string, unknown>;

/** A timestamptz as Postgres writes it: a T or a space, any fraction, an offset in hours or hh:mm. */
const DB_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * A timestamptz as the contract's instant: UTC with a trailing Z, keeping every fractional digit
 * Postgres wrote (a JavaScript Date keeps milliseconds only, so the fraction is carried as text).
 */
export function instantFromDb(value: unknown): string {
  const m = typeof value === 'string' ? DB_TIMESTAMP.exec(value) : null;
  if (!m) throw new Error(`rows: not a timestamp: ${JSON.stringify(value)}`);
  const [, date, time, fraction = '', offset = 'Z'] = m;
  // Offsets are whole minutes, so moving to UTC leaves the fraction as it is.
  const zone =
    offset === 'Z' || offset.includes(':')
      ? offset
      : offset.length === 3
        ? `${offset}:00`
        : `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const whole = new Date(`${date}T${time}${zone}`);
  if (Number.isNaN(whole.getTime())) throw new Error(`rows: not a timestamp: ${value}`);
  return `${whole.toISOString().slice(0, 19)}${fraction}Z`;
}

interface Def {
  type: string;
  format?: string;
  innerType?: z.ZodType;
}
const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** The field holds a timestamp (z.iso.datetime), nullable or not. */
function isInstant(field: z.ZodType): boolean {
  let def = defOf(field);
  while ((def.type === 'nullable' || def.type === 'optional') && def.innerType)
    def = defOf(def.innerType);
  return def.type === 'string' && def.format === 'datetime';
}

interface ObjectSchema<T> {
  shape: Readonly<Record<string, z.ZodType>>;
  parse(value: unknown): T;
}

/**
 * `schema`'s fields from `row`, each timestamp as an instant, parsed. A field in `derived` is taken
 * from there instead: one the table stores under other columns.
 */
function contractRecord<T>(schema: ObjectSchema<T>, row: Row, derived: Row = {}): T {
  const record: Row = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    if (Object.hasOwn(derived, key)) {
      record[key] = derived[key];
      continue;
    }
    const value = Object.hasOwn(row, key) ? row[key] : undefined;
    record[key] =
      value !== null && value !== undefined && isInstant(field) ? instantFromDb(value) : value;
  }
  return schema.parse(record);
}

export const checkFromRow = (row: Row): Check => contractRecord(CheckSchema, row);
export const pageResultFromRow = (row: Row): PageResult => contractRecord(PageResultSchema, row);
export const linkEdgeFromRow = (row: Row): LinkEdge => contractRecord(LinkEdgeSchema, row);
export const accessTestFromRow = (row: Row): AccessTest => contractRecord(AccessTestSchema, row);
export const fixFromRow = (row: Row): Fix => contractRecord(FixSchema, row);
export const changeFromRow = (row: Row): Change => contractRecord(ChangeSchema, row);
export const lineageFromRow = (row: Row): MeasurementLineage =>
  contractRecord(MeasurementLineageSchema, row);
export const usageEventFromRow = (row: Row): UsageEvent => contractRecord(UsageEventSchema, row);

/** A fix event carries its kind's fields only: who marked it done, or the check that measured it. */
export function fixEventFromRow(row: Row): FixEvent {
  const common = { id: row.id, fix_id: row.fix_id, at: instantFromDb(row.at), kind: row.kind };
  return FixEventSchema.parse(
    row.kind === 'marked_done'
      ? { ...common, by_seat_id: row.by_seat_id }
      : { ...common, check_id: row.check_id },
  );
}

const ScheduleSchema = SiteSchema.shape.schedule.unwrap();
const ClientReportSchema = SiteSchema.shape.client_report.unwrap();

/**
 * A site. Site.schedule is stored flattened as `schedule_<key>` columns, and Site.client_report as the
 * site's report_schedules row, which the row must carry under `report_schedules` (PostgREST's
 * `select('*, report_schedules(*)')` embeds it as an object, or an array of at most one; null or an
 * empty array when the site has none). A row read without it throws rather than report no client
 * report.
 */
export function siteFromRow(row: Row): Site {
  if (!Object.hasOwn(row, 'report_schedules'))
    throw new Error(
      'siteFromRow: the site row must carry its report_schedules row (select *, report_schedules(*))',
    );
  const report = oneScheduleRow(row.report_schedules);
  return contractRecord(SiteSchema, row, {
    schedule:
      row.schedule_cadence === null
        ? null
        : Object.fromEntries(
            Object.keys(ScheduleSchema.shape).map((key) => [key, row[`schedule_${key}`]]),
          ),
    client_report: report === null ? null : contractRecord(ClientReportSchema, report),
  });
}

function oneScheduleRow(value: unknown): Row | null {
  if (!Array.isArray(value)) return (value as Row | null) ?? null;
  if (value.length > 1) throw new Error('siteFromRow: more than one report_schedules row');
  return (value[0] as Row | undefined) ?? null;
}

/** The engine's DiffInputs (checks.diff_inputs): the next check's diff reads it back. */
export const DiffInputsSchema: z.ZodType<DiffInputs> = z.strictObject({
  page_cap: z.int().min(1),
  robots_txt: z.string().nullable(),
  detectors: z.array(FixTypeSchema),
  indeterminate: z.array(FingerprintSchema),
});

/** `checks.diff_inputs`, parsed; null when the check stored none. */
export const diffInputsFromRow = (row: Row): DiffInputs | null =>
  row.diff_inputs === null ? null : DiffInputsSchema.parse(row.diff_inputs);
