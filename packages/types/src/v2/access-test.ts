/**
 * AccessTest: one request (or one robots.txt reading, or one owner log line) and what came back.
 * The raw evidence behind a CrawlerResult.
 *
 * `ua` is the crawler the verdict is about. It is null for the untagged browser-identity control, the
 * tagged Googlebot canary and renders: those are part of the method (FACTS D1/L5) but are not any
 * crawler's result. `identity_role` names which a row is.
 */
import { z } from 'zod';
import {
  CountSchema,
  crawledText,
  HeaderSchema,
  MAX_HEADERS,
  HttpStatusSchema,
  HttpUrlSchema,
  IdSchema,
  TemplateKeySchema,
  TimestampSchema,
} from './common.js';
import {
  AccessCauseSchema,
  EvidenceClassSchema,
  IdentityRoleSchema,
  RequestSigningSchema,
  SignatureVerificationSchema,
  SourceIpClassSchema,
  VerdictSchema,
  WitnessRoleSchema,
} from './enums.js';

/** The most any timing field holds, in milliseconds; a request's own deadline is 30 seconds. */
export const MAX_TIMING_MS = 120_000;
const TimingMsSchema = z.int().min(0).max(MAX_TIMING_MS);

/**
 * How long the request's phases took, in whole milliseconds from the moment it was sent, for the
 * last request a row's evidence shows. `dns_ms`: until the socket's address lookup ended; null when
 * no lookup ran (an address literal, or a connection reused). `connect_ms`: until the connection was
 * ready, TLS included; null on a reused connection. `ttfb_ms`: until the response headers arrived;
 * null when none did. `total_ms`: until the request ended.
 */
export const RequestTimingSchema = z.strictObject({
  dns_ms: TimingMsSchema.nullable(),
  connect_ms: TimingMsSchema.nullable(),
  ttfb_ms: TimingMsSchema.nullable(),
  total_ms: TimingMsSchema,
});
export type RequestTiming = z.infer<typeof RequestTimingSchema>;

/**
 * The identity that was served on the same page, and so made a refusal a rule aimed at the user agent
 * rather than an unverified address (ENGINE-GAP §3.5a): a tested crawler, or the canary. `ua` is its
 * registry token.
 */
export const WitnessSchema = z.strictObject({
  role: WitnessRoleSchema,
  ua: z.string().min(1).max(64),
});

/** A Fly region code, as Fly sets FLY_REGION on a Machine. */
export const FlyRegionSchema = z.string().regex(/^[a-z]{3}$/);
/** The worker build: the first 12 hex digits of its commit, or `unreleased` for a local build. */
export const WorkerReleaseSchema = z.string().regex(/^(?:[0-9a-f]{12}|unreleased)$/);
import { rules } from './rules.js';

export const AccessTestSchema = z
  .strictObject({
    id: IdSchema,
    check_id: IdSchema,
    ua: z.string().min(1).nullable(),
    page_url: HttpUrlSchema,
    template_key: TemplateKeySchema,
    tested_at: TimestampSchema,
    verdict: VerdictSchema,
    evidence_class: EvidenceClassSchema,
    /** The User-Agent actually sent, tag included; an owner-log line can carry any string, so bounded. */
    identity_sent: crawledText(512, 1),
    source_ip_class: SourceIpClassSchema,
    /** What this evidence cannot show, said plainly. */
    limitations: z.array(z.string().min(1).max(500)).max(8),
    cause: AccessCauseSchema.nullable(),
    request_headers: z.array(HeaderSchema).max(MAX_HEADERS),
    raw_status: HttpStatusSchema.nullable(),
    final_url: HttpUrlSchema.nullable(),
    /** Only the response headers that bear on the verdict. */
    headers: z.array(HeaderSchema).max(MAX_HEADERS),
    byte_count: CountSchema.nullable(),
    word_count: CountSchema.nullable(),
    /** The start of the body as received, cut by the engine to 2,000 UTF-8 bytes. */
    body_excerpt: crawledText(2000).nullable(),
    /**
     * The request line as we sent it, when a response shows the request reached the server. Both null
     * when no request was made, none answered, or the line is not known (an owner-log entry). What the
     * server answered with is not recorded.
     */
    method: z.literal('GET').nullable(),
    http_version: z.literal('1.1').nullable(),
    identity_role: IdentityRoleSchema,
    /** The request shown carried our tag (`Crawlmouse/2.0` in its user agent). Never the control's. */
    tagged: z.boolean(),
    /** On a simulated blocked_by_ua_rule row: the first identity served on the page, in request order. */
    witness: WitnessSchema.nullable(),
    /** The Fly region the request left from; null off Fly. */
    fly_region: FlyRegionSchema.nullable(),
    /**
     * Whether our request was signed, whether the site verified it, and the worker build that made
     * it. All three null exactly on an owner-log line, which is not one of our requests.
     */
    request_signing: RequestSigningSchema.nullable(),
    signature_verified: SignatureVerificationSchema.nullable(),
    worker_release: WorkerReleaseSchema.nullable(),
    /**
     * Null when no request was made, the evidence is not one of ours (an owner-log line), or the
     * worker that made it did not record timing (a release before CC-12d).
     */
    timing: RequestTimingSchema.nullable(),
  })
  .check(
    rules((t, rule) => {
      const observed = t.evidence_class === 'observed';
      rule.exactlyWhen('observed_owner_logs', observed, t.source_ip_class === 'owner_logs');
      rule.exactlyWhen('access_request_line', t.method !== null, t.http_version !== null);
      rule.exactlyWhen('access_identity_ua', t.ua !== null, t.identity_role === 'crawler');
      if (t.identity_role === 'control' && t.tagged) rule.fail('control_untagged');
      rule.exactlyWhen(
        'access_witness',
        t.witness !== null,
        t.verdict === 'blocked_by_ua_rule' && t.evidence_class === 'simulated',
      );
      if (t.witness !== null && t.witness.ua === t.ua) rule.fail('witness_other');
      rule.exactlyWhen('fly_region', t.fly_region !== null, t.source_ip_class === 'fly_egress');
      const ours = [t.request_signing, t.signature_verified, t.worker_release];
      const some = ours.some((v) => v !== null);
      rule.exactlyWhen('worker_request', some, !observed);
      if (some && ours.some((v) => v === null)) rule.fail('worker_request_whole');
      const phases = t.timing
        ? [t.timing.dns_ms, t.timing.connect_ms, t.timing.ttfb_ms, t.timing.total_ms]
        : [];
      const known = phases.filter((v): v is number => v !== null);
      if (known.some((v, i) => i > 0 && v < known[i - 1]!)) rule.fail('timing_order');
    }),
  );

export type AccessTest = z.infer<typeof AccessTestSchema>;
