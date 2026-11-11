/**
 * A fix's packet as plain text, for "Copy as a prompt". Moved here from view/segment/fixes.ts, which
 * re-exports it, so a client control can import it without the fixtures that module reads.
 */
import type { Fix } from '@crawlmouse/types/v2';

export type FixPacket = NonNullable<Fix['packet']>;

/** The verify lines of the segment's packet block and of the prompt. */
export const verifyLines = (p: FixPacket) => [
  'Verify (we run this after you mark done):',
  `  ${p.verify.command}`,
  `  → expect ${p.verify.expect}`,
];

/**
 * The whole packet as plain text, for "Copy as a prompt": the fix page and the segment copy this,
 * so the same fix is handed over in the same words wherever it is copied from.
 */
export function packetPrompt(f: Pick<Fix, 'title'>, p: FixPacket): string {
  return [
    f.title,
    '',
    ...p.context,
    '',
    'Change:',
    ...p.change,
    ...(p.keep.length ? ['', 'Keep:', ...p.keep] : []),
    '',
    ...verifyLines(p),
  ].join('\n');
}
