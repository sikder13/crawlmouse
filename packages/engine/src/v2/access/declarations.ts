/**
 * The agent signals: which count toward the AI readability grade, and whether a declaration file is
 * there.
 *
 * Only schema.org markup and Content Signals carry weight (FACTS B5). The rest are declarations with
 * no documented consumer yet, or that cannot be tested from outside (Web Bot Auth, FACTS I10):
 * reported as present or absent, worth nothing either way, and never a defect. No fix type exists for
 * any of them, so none can open a fix.
 *
 * The worker requests the declaration paths and records each as a DeclarationFetch
 * (packages/types/src/v2/declaration.ts); reading those into a probe is the pipeline's (CC-20).
 * `declarationSignal` reads a probe: what one GET of the path answered. An HTML page at the path is not the file; another
 * media type the declaration is not served as leaves the question open.
 */
import type { Check, RecommendationClass, SignalKind } from '@crawlmouse/types/v2';
import { GONE_STATUSES } from '../detectors/thresholds.js';

export const SIGNAL_TABLE: Readonly<
  Record<SignalKind, { counts_toward_grade: boolean; recommendation_class: RecommendationClass }>
> = {
  schema_org: { counts_toward_grade: true, recommendation_class: 'best_practice' },
  content_signals: { counts_toward_grade: true, recommendation_class: 'best_practice' },
  web_bot_auth: { counts_toward_grade: false, recommendation_class: 'experimental' },
  llms_txt: { counts_toward_grade: false, recommendation_class: 'experimental' },
  mcp_server_card: { counts_toward_grade: false, recommendation_class: 'experimental' },
  markdown_negotiation: { counts_toward_grade: false, recommendation_class: 'experimental' },
  agent_skills_index: { counts_toward_grade: false, recommendation_class: 'experimental' },
  ucp: { counts_toward_grade: false, recommendation_class: 'experimental' },
  rsl: { counts_toward_grade: false, recommendation_class: 'experimental' },
  agent_card: { counts_toward_grade: false, recommendation_class: 'experimental' },
  llms_full: { counts_toward_grade: false, recommendation_class: 'experimental' },
};

/** The declarations one GET can find: where, what the file is, and the media types it is served as. */
export const DECLARATIONS = {
  llms_txt: {
    path: '/llms.txt',
    file: 'an llms.txt file',
    media_types: ['text/plain', 'text/markdown'],
  },
  mcp_server_card: {
    path: '/.well-known/mcp',
    file: 'an MCP server card',
    media_types: ['application/json'],
  },
} as const satisfies Partial<
  Record<SignalKind, { path: string; file: string; media_types: readonly string[] }>
>;

export type DeclarationKind = keyof typeof DECLARATIONS;

/** What one GET of a declaration's path answered: `status` null when nothing answered. */
export interface DeclarationProbe {
  status: number | null;
  /** The Content-Type, as sent; null when none was sent. */
  media_type: string | null;
  /**
   * The body's length in bytes; null when not recorded. A DeclarationFetch whose `bytes_complete` is
   * false gives null here: its count is what was read, not the file's length.
   */
  bytes: number | null;
}

/** The contract's SignalResult, as a check stores it. */
export type SignalResult = Check['signals'][number];

type State = SignalResult['state'];

/** `type/subtype` in lower case, without parameters; null when absent or not of that form. */
function mediaType(raw: string | null): string | null {
  const type = raw?.split(';')[0]!.trim().toLowerCase() ?? '';
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/.test(type)
    ? type
    : null;
}

function judge(kind: DeclarationKind, probe: DeclarationProbe | null): [State, string] {
  const { path, file, media_types } = DECLARATIONS[kind];
  if (probe === null) return ['indeterminate', `${path} was not requested.`];
  const asked = `GET ${path}`;
  if (probe.status === null) return ['indeterminate', `${asked} got no response.`];
  if (GONE_STATUSES.some((s) => s === probe.status))
    return ['not_detected', `${asked} answered ${probe.status}: the file is not there.`];
  if (probe.status !== 200)
    return [
      'indeterminate',
      `${asked} answered ${probe.status}, which does not say whether the file is there.`,
    ];
  if (probe.bytes === 0) return ['not_detected', `${asked} answered 200 with an empty body.`];
  const type = mediaType(probe.media_type);
  if (type === 'text/html')
    return ['not_detected', `${asked} answered 200 with an HTML page, which is not ${file}.`];
  if (type === null || !(media_types as readonly string[]).includes(type))
    return [
      'indeterminate',
      `${asked} answered 200 with ${type ?? 'no recognisable media type'}, so whether it is ${file} is not known.`,
    ];
  const size = probe.bytes === null ? '' : `, ${probe.bytes.toLocaleString('en-US')} bytes`;
  return ['detected', `${asked} answered 200 with ${type}${size}.`];
}

export function declarationSignal(
  kind: DeclarationKind,
  probe: DeclarationProbe | null,
): SignalResult {
  const [state, evidence] = judge(kind, probe);
  return { signal: kind, state, ...SIGNAL_TABLE[kind], evidence };
}
