import { randomUUID } from 'node:crypto';
import {
  AccessTestSchema,
  type AccessCause,
  type AccessTest,
  type EvidenceClass,
  type Verdict,
} from '@crawlmouse/types/v2';
import type { FetchOutcome } from '../fetch/fetcher.js';
import type { Identity } from '../identities.js';
import {
  bodyExcerpt,
  evidenceHeaders,
  requestHeaders,
  requestLimitations,
  standardStatus,
  storedLimitations,
  storedUrl,
  userAgentOf,
} from './evidence.js';
import { bounded, CAPS } from './bounded.js';

export interface AccessRowInput {
  checkId: string;
  pageUrl: string;
  templateKey: string;
  /** The registry token of the crawler the verdict is about; null for the control and the canary. */
  ua: string | null;
  verdict: Verdict;
  evidence: EvidenceClass;
  cause: AccessCause | null;
  limitations: string[];
  /** The request the evidence comes from; null when none was made. */
  fetch: FetchOutcome | null;
  /** The identity that would have been sent, named when no request was made. */
  identity: Identity;
  testedAt: number;
  words: number | null;
}

/** Builds one AccessTest and validates it against the CC-11 schema; an invalid row is a worker bug and throws. */
export function accessTestRow(i: AccessRowInput): AccessTest {
  const f = i.fetch;
  return AccessTestSchema.parse({
    id: randomUUID(),
    check_id: i.checkId,
    ua: i.ua === null ? null : bounded(i.ua, CAPS.token),
    // Request fields, which the request schema already holds within these caps.
    page_url: bounded(i.pageUrl, CAPS.url),
    template_key: bounded(i.templateKey, CAPS.templateKey),
    tested_at: new Date(i.testedAt).toISOString(),
    verdict: i.verdict,
    evidence_class: i.evidence,
    identity_sent: userAgentOf(f, i.identity),
    source_ip_class: 'fly_egress',
    limitations: storedLimitations([...i.limitations, ...requestLimitations(f)]),
    cause: i.cause,
    request_headers: f ? requestHeaders(f) : [],
    raw_status: standardStatus(f?.status ?? null),
    final_url: f ? storedUrl(f.finalUrl) : null,
    headers: f ? evidenceHeaders(f) : [],
    byte_count: f && f.status !== null ? f.bytes : null,
    word_count: i.words,
    body_excerpt: f ? bodyExcerpt(f) : null,
    // The request line as sent, when a response shows the request reached the server: every request
    // goes through safeFetch, which sends GET over HTTP/1.1.
    method: f && f.status !== null ? 'GET' : null,
    http_version: f && f.status !== null ? '1.1' : null,
  });
}
