/** Account: who pays, on which plan, and (on Agency) whose brand the client sees. */
import { z } from 'zod';
import {
  EmailSchema,
  HostSchema,
  HttpsUrlSchema,
  IdSchema,
  instant,
  TimestampSchema,
  TimeZoneSchema,
} from './common.js';
import { AccountStateSchema, IntegrationKindSchema } from './enums.js';
import { rules } from './rules.js';

/**
 * Agency branding. Only the agency name is collected at the trial step; the report domain, sender
 * address and the rest are set under Branding and are optional on day 1 (FACTS J11/K6), so each is
 * null until set. `portal_domain` keeps its column name (FACTS A7) though the UI says "client report
 * page".
 */
export const AgencyBrandingSchema = z
  .strictObject({
    agency_name: z.string().min(1),
    logo_url: HttpsUrlSchema.nullable(),
    /** Report heading colour; null uses the product default. */
    accent_hex: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable(),
    portal_domain: HostSchema.nullable(),
    dns: z
      .strictObject({
        txt_found: z.boolean(),
        cname_found: z.boolean(),
        certificate_issued_at: TimestampSchema.nullable(),
      })
      .nullable(),
    sender_email: EmailSchema.nullable(),
    email_auth: z
      .strictObject({
        spf_passes: z.boolean(),
        dkim_passes: z.boolean(),
        dmarc_policy: z.string().nullable(),
      })
      .nullable(),
    open_tracking_default: z.boolean(),
    /** The sender's postal address in every client email footer (FACTS D6). */
    postal_address: z.string().min(1).nullable(),
  })
  .check(
    rules((b, rule) => {
      rule.exactlyWhen('branding_dns', b.portal_domain === null, b.dns === null);
      rule.exactlyWhen('branding_email_auth', b.sender_email === null, b.email_auth === null);
      if (b.sender_email !== null && b.postal_address === null) rule.fail('branding_postal');
    }),
  );

const TRIAL_STATES = new Set(['pro_trial', 'agency_trial']);

export const AccountSchema = z
  .strictObject({
    id: IdSchema,
    email: EmailSchema,
    name: z.string().nullable(),
    state: AccountStateSchema,
    /** Append-only: every state the account has been in, oldest first; the last one is `state`. */
    state_history: z
      .array(z.strictObject({ state: AccountStateSchema, since: TimestampSchema }))
      .min(1),
    trial_ends_at: TimestampSchema.nullable(),
    card_last4: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    renews_at: TimestampSchema.nullable(),
    /** 1 for monthly, 12 for annual; null until there is a subscription. */
    billing_period_months: z
      .int()
      .check(
        rules((m, rule) => {
          if (m !== 1 && m !== 12) rule.fail('billing_period');
        }),
      )
      .nullable(),
    /** The account's zone; schedules read "Fri around 06:00" in it (FACTS H4). */
    timezone: TimeZoneSchema,
    limits: z.strictObject({
      sites: z.int().min(1),
      seats: z.int().min(1),
      pages_per_audit: z.int().min(1),
      competitors_per_site: z.int().min(0),
      full_renders_per_month: z.int().min(0),
    }),
    email_prefs: z.strictObject({ change_notes: z.boolean(), trial_reminder: z.boolean() }),
    integrations: z.array(
      z.strictObject({
        kind: IntegrationKindSchema,
        connected: z.boolean(),
        label: z.string().nullable(),
      }),
    ),
    api_keys: z.array(
      z.strictObject({
        /** The visible start of the key only. Bounded, so a whole key can never be stored here. */
        prefix: z.string().regex(/^cm_ro_[0-9a-f]{4,8}$/),
        created_at: TimestampSchema,
        last_used_at: TimestampSchema.nullable(),
      }),
    ),
    branding: AgencyBrandingSchema.nullable(),
    /**
     * The Agency trial's consent checkbox (renewal, EU withdrawal, Terms), recorded before the card is
     * taken (FACTS J15, L6). Null for an account that never started an Agency trial.
     */
    agency_trial_consent: z.strictObject({ recorded_at: TimestampSchema }).nullable(),
  })
  .check(
    rules((a, rule) => {
      // zod still runs this refinement when `.min(1)` has already failed, so an empty history must
      // return here rather than read a missing entry.
      const last = a.state_history[a.state_history.length - 1];
      if (!last) return;
      if (last.state !== a.state) rule.fail('history_current');
      for (let i = 1; i < a.state_history.length; i++) {
        if (instant(a.state_history[i]!.since) <= instant(a.state_history[i - 1]!.since)) {
          rule.fail('history_forward');
        }
      }
      const hadAgencyTrial = a.state_history.some((h) => h?.state === 'agency_trial');
      rule.exactlyWhen('trial_consent', a.agency_trial_consent !== null, hadAgencyTrial);
      rule.exactlyWhen('trial_ends', a.trial_ends_at !== null, TRIAL_STATES.has(a.state));
    }),
  );

export type AgencyBranding = z.infer<typeof AgencyBrandingSchema>;
export type Account = z.infer<typeof AccountSchema>;
