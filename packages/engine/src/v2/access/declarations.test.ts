import { SignalKindSchema, SignalResultSchema } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { declarationSignal, SIGNAL_TABLE, type DeclarationProbe } from './declarations.js';

describe('the signal table', () => {
  it('weighs schema.org and Content Signals only, and every other signal is experimental', () => {
    expect(SIGNAL_TABLE).toEqual({
      schema_org: { counts_toward_grade: true, recommendation_class: 'best_practice' },
      content_signals: { counts_toward_grade: true, recommendation_class: 'best_practice' },
      web_bot_auth: { counts_toward_grade: false, recommendation_class: 'experimental' },
      llms_txt: { counts_toward_grade: false, recommendation_class: 'experimental' },
      mcp_server_card: { counts_toward_grade: false, recommendation_class: 'experimental' },
      markdown_negotiation: { counts_toward_grade: false, recommendation_class: 'experimental' },
      agent_skills_index: { counts_toward_grade: false, recommendation_class: 'experimental' },
    });
    expect(Object.keys(SIGNAL_TABLE).sort()).toEqual([...SignalKindSchema.options].sort());
  });
});

const probe = (over: Partial<DeclarationProbe>): DeclarationProbe => ({
  status: 200,
  media_type: 'text/plain',
  bytes: 120,
  ...over,
});

const NOT_KNOWN = 'so whether it is an llms.txt file is not known.';

// One case per line, so the table reads as a table.
// prettier-ignore
const CASES = [
  ['llms_txt', probe({}), 'detected', 'GET /llms.txt answered 200 with text/plain, 120 bytes.'],
  ['llms_txt', probe({ media_type: 'text/markdown', bytes: 1234 }), 'detected', 'GET /llms.txt answered 200 with text/markdown, 1,234 bytes.'],
  ['llms_txt', probe({ media_type: 'Text/Plain; charset=utf-8' }), 'detected', 'GET /llms.txt answered 200 with text/plain, 120 bytes.'],
  ['llms_txt', probe({ bytes: null }), 'detected', 'GET /llms.txt answered 200 with text/plain.'],
  ['llms_txt', probe({ status: 404 }), 'not_detected', 'GET /llms.txt answered 404: the file is not there.'],
  ['llms_txt', probe({ status: 410 }), 'not_detected', 'GET /llms.txt answered 410: the file is not there.'],
  ['llms_txt', probe({ media_type: 'text/html' }), 'not_detected', 'GET /llms.txt answered 200 with an HTML page, which is not an llms.txt file.'],
  ['llms_txt', probe({ media_type: 'text/html;charset=UTF-8' }), 'not_detected', 'GET /llms.txt answered 200 with an HTML page, which is not an llms.txt file.'],
  ['llms_txt', probe({ bytes: 0 }), 'not_detected', 'GET /llms.txt answered 200 with an empty body.'],
  ['llms_txt', probe({ media_type: 'application/octet-stream' }), 'indeterminate', `GET /llms.txt answered 200 with application/octet-stream, ${NOT_KNOWN}`],
  ['llms_txt', probe({ media_type: null }), 'indeterminate', `GET /llms.txt answered 200 with no recognisable media type, ${NOT_KNOWN}`],
  ['llms_txt', probe({ media_type: `text/${'x'.repeat(600)}` }), 'indeterminate', `GET /llms.txt answered 200 with no recognisable media type, ${NOT_KNOWN}`],
  ['llms_txt', probe({ status: 403 }), 'indeterminate', 'GET /llms.txt answered 403, which does not say whether the file is there.'],
  ['llms_txt', probe({ status: null }), 'indeterminate', 'GET /llms.txt got no response.'],
  ['llms_txt', null, 'indeterminate', '/llms.txt was not requested.'],
  ['mcp_server_card', probe({ media_type: 'application/json' }), 'detected', 'GET /.well-known/mcp answered 200 with application/json, 120 bytes.'],
  ['mcp_server_card', probe({}), 'indeterminate', 'GET /.well-known/mcp answered 200 with text/plain, so whether it is an MCP server card is not known.'],
] as const;

describe('declarationSignal', () => {
  it.each(CASES)('%s, %j: %s', (kind, p, state, evidence) => {
    const s = declarationSignal(kind, p);
    expect(SignalResultSchema.parse(s)).toEqual({
      signal: kind,
      state,
      counts_toward_grade: false,
      recommendation_class: 'experimental',
      evidence,
    });
  });

  it('a declaration carries no weight whatever the answer', () => {
    for (const status of [200, 403, 404, null])
      for (const kind of ['llms_txt', 'mcp_server_card'] as const)
        expect(declarationSignal(kind, probe({ status })).counts_toward_grade).toBe(false);
  });
});
