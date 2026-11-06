/**
 * The two declarations that count toward Signals (FACTS B5), decided for a check.
 *
 * Content Signals: robots.txt has a `Content-Signal:` line naming at least one of `search`,
 * `ai-input`, `ai-train` with `yes` or `no`, as a directive or in the comment form Cloudflare writes
 * (`# Content-Signal: …`). Whatever the values say, the site has declared them. robots.txt that could
 * not be read leaves it undecided.
 *
 * schema.org: a graded page carries a JSON-LD node with a type. JSON-LD is read whether or not the page
 * needs JavaScript. With no graded page, or none marked while some graded page was not fetched, it is
 * undecided.
 */
import type { SignalKind } from '@crawlmouse/types/v2';
import { toPersistableText } from '../../text-safety.js';
import { SIGNAL_TABLE, type SignalResult } from '../access/declarations.js';
import type { ContentFeatures } from '../content/read.js';

const CONTENT_SIGNAL_LINE = /^\s*(?:#\s*)?content-signal\s*:\s*(.*)$/i;
// A key starts the value or follows a space, comma or semicolon, so `x-search=yes` names no signal.
const SIGNAL_VALUE = /(?:^|[\s,;])(?:search|ai-input|ai-train)\s*=\s*(?:yes|no)\b/i;
const EVIDENCE_BYTES = 500;

const result = (
  signal: SignalKind,
  state: SignalResult['state'],
  evidence: string,
): SignalResult => ({
  signal,
  state,
  ...SIGNAL_TABLE[signal],
  evidence: toPersistableText(evidence, EVIDENCE_BYTES),
});

export function contentSignals(robotsTxt: string | null): SignalResult {
  if (robotsTxt === null)
    return result('content_signals', 'indeterminate', 'robots.txt could not be read.');
  const lines = robotsTxt.split(/\r?\n/);
  const at = lines.findIndex((l) => {
    const m = CONTENT_SIGNAL_LINE.exec(l);
    return m !== null && SIGNAL_VALUE.test(m[1]!);
  });
  return at === -1
    ? result(
        'content_signals',
        'not_detected',
        'robots.txt has no Content-Signal line naming search, ai-input or ai-train.',
      )
    : result('content_signals', 'detected', `robots.txt line ${at + 1}: ${lines[at]!.trim()}`);
}

/**
 * `graded`: the features of the graded pages that were fetched; `unread`: graded pages that were not.
 * With none marked, an unfetched page could carry the markup, so it is undecided rather than absent.
 */
export function schemaOrg(graded: readonly ContentFeatures[], unread: number): SignalResult {
  if (graded.length === 0 && unread === 0)
    return result('schema_org', 'indeterminate', 'No graded page to read.');
  const marked = graded.filter((f) => f.json_ld.length > 0).length;
  const total = graded.length + unread;
  if (marked > 0)
    return result('schema_org', 'detected', `JSON-LD on ${marked} of the ${total} graded pages.`);
  return unread > 0
    ? result(
        'schema_org',
        'indeterminate',
        `No JSON-LD on the ${graded.length} graded pages read; ${unread} not read.`,
      )
    : result('schema_org', 'not_detected', `No JSON-LD on any of the ${total} graded pages.`);
}
