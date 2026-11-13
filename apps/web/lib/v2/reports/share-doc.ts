/**
 * A proof page's stored file read back (CC-31 D6b): the `ReportDoc` its report was made as, kept in
 * the reports bucket as JSON (`REPORT_FILES.html`). The shared page and the signed-in page render
 * this and nothing else, so what a client is shown is what was stored when the report was made.
 */
import { z } from 'zod';
import type { ReportDoc } from './generate';

const Side = z.strictObject({
  label: z.string(),
  date: z.string(),
  value: z.string(),
  evidence: z.array(z.string()),
});

const Block = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({
    type: z.literal('facts'),
    rows: z.array(z.strictObject({ label: z.string(), value: z.string() })),
  }),
  z.strictObject({
    type: z.literal('table'),
    caption: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  z.strictObject({ type: z.literal('pair'), title: z.string(), before: Side, after: Side }),
]);

const Doc = z.strictObject({
  title: z.string(),
  lines: z.array(z.string()),
  sections: z.array(z.strictObject({ heading: z.string(), blocks: z.array(Block) })),
  notMeasured: z.array(z.string()),
  footer: z.strictObject({ text: z.string(), href: z.string() }),
}) satisfies z.ZodType<ReportDoc>;

/** The document a stored file holds, or null for bytes that are not one. */
export function parseStoredDoc(bytes: Uint8Array): ReportDoc | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  const parsed = Doc.safeParse(value);
  return parsed.success ? parsed.data : null;
}
