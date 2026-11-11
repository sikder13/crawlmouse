/**
 * The account's alert rules and its Slack destination (CC-27b D7): the write behind
 * `PUT /api/alert-rules`. The route establishes the caller's membership of the account through their
 * own session; this module decides what the body asks for and writes it, with the service role, to
 * that account only.
 *
 * The body is what the Alerts screen posts: one rule's switch, `{ rule, enabled }` (the rule an
 * account-level one, `site_id` null), and the Slack destination, `{ slackWebhookUrl }` to set or
 * replace it or `{ clearSlack: true }` to remove it. A form carries the same fields as strings.
 * Setting a URL needs a tier whose gates open Slack (402 otherwise); clearing one does not.
 *
 * The URL goes into Vault through `set_account_slack_webhook` and is not read back: the answer says
 * whether one is set and its last four characters, which is all a page shows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RequestBody } from '../../billing/request-body';
import type { TierGates } from '../../entitlement-v2';

export const SLACK_URL_MAX = 500;
/** Slack's incoming-webhook URL, as `set_account_slack_webhook` (migration 027b, section C) holds it. */
const SLACK_URL = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+$/;

export interface AlertRulesPlan {
  rule: { id: string; enabled: boolean } | null;
  slack: { set: string } | 'clear' | null;
}

export interface SlackState {
  set: boolean;
  last4: string | null;
}

export type AlertRulesDecision =
  | { ok: true; plan: AlertRulesPlan }
  | { ok: false; status: 400; code: 'invalid' }
  | { ok: false; status: 402; code: 'upgrade_required'; gate: 'slack' };

const flag = (kind: RequestBody['kind']) =>
  kind === 'json' ? z.boolean() : z.enum(['true', 'false']).transform((v) => v === 'true');

const bodyOf = (kind: RequestBody['kind']) =>
  z
    .strictObject({
      rule: z.uuid().optional(),
      enabled: flag(kind).optional(),
      slackWebhookUrl: z.string().max(SLACK_URL_MAX).regex(SLACK_URL).optional(),
      clearSlack: flag(kind)
        .refine((v) => v)
        .optional(),
    })
    .refine((b) => (b.rule === undefined) === (b.enabled === undefined))
    .refine((b) => !(b.slackWebhookUrl !== undefined && b.clearSlack !== undefined))
    .refine((b) => b.rule !== undefined || b.slackWebhookUrl !== undefined || b.clearSlack);

/** What the body asks for, under the gates of the account's tier now. */
export function decideAlertRules(
  body: RequestBody,
  gates: Readonly<TierGates>,
): AlertRulesDecision {
  const parsed = bodyOf(body.kind).safeParse(body.fields);
  if (!parsed.success) return { ok: false, status: 400, code: 'invalid' };
  const b = parsed.data;
  if (b.slackWebhookUrl !== undefined && !gates.slack) {
    return { ok: false, status: 402, code: 'upgrade_required', gate: 'slack' };
  }
  return {
    ok: true,
    plan: {
      rule: b.rule === undefined ? null : { id: b.rule, enabled: b.enabled! },
      slack:
        b.slackWebhookUrl !== undefined
          ? { set: b.slackWebhookUrl }
          : b.clearSlack
            ? 'clear'
            : null,
    },
  };
}

export interface AlertRulePorts {
  /** Sets `enabled` on the account-level rule `ruleId` of `accountId`; false when there is none. */
  setRuleEnabled(accountId: string, ruleId: string, enabled: boolean): Promise<boolean>;
  setSlack(accountId: string, url: string): Promise<void>;
  clearSlack(accountId: string): Promise<void>;
  slackLast4(accountId: string): Promise<string | null>;
}

export type AlertRulesOutcome =
  | { ok: true; slack: SlackState }
  | { ok: false; status: 404; code: 'not_found' };

/**
 * Writes the plan to `accountId`: the rule first, so a rule that is not one of the account's own
 * account-level rules is a 404 with nothing written; then the Slack destination.
 */
export async function applyAlertRules(
  ports: AlertRulePorts,
  accountId: string,
  plan: AlertRulesPlan,
): Promise<AlertRulesOutcome> {
  if (plan.rule !== null) {
    const found = await ports.setRuleEnabled(accountId, plan.rule.id, plan.rule.enabled);
    if (!found) return { ok: false, status: 404, code: 'not_found' };
  }
  if (plan.slack === 'clear') await ports.clearSlack(accountId);
  else if (plan.slack !== null) await ports.setSlack(accountId, plan.slack.set);
  const last4 = await ports.slackLast4(accountId);
  return { ok: true, slack: { set: last4 !== null, last4 } };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`alert rules: ${what} failed: ${error.message}`);
}

/** The writes over the service role, each keyed by the account id. */
export function supabaseAlertRulePorts(admin: SupabaseClient): AlertRulePorts {
  return {
    async setRuleEnabled(accountId, ruleId, enabled) {
      const found = await admin
        .from('alert_rules')
        .select('id')
        .eq('id', ruleId)
        .eq('account_id', accountId)
        .is('site_id', null)
        .maybeSingle();
      if (found.error) failed('alert_rules read', found.error);
      if (found.data === null) return false;
      const { error } = await admin
        .from('alert_rules')
        .update({ enabled })
        .eq('id', ruleId)
        .eq('account_id', accountId)
        .is('site_id', null);
      if (error) failed('alert_rules update', error);
      return true;
    },
    async setSlack(accountId, url) {
      const { error } = await admin.rpc('set_account_slack_webhook', {
        p_account: accountId,
        p_url: url,
      });
      if (error) failed('set_account_slack_webhook', error);
    },
    async clearSlack(accountId) {
      const { error } = await admin.rpc('clear_account_slack_webhook', { p_account: accountId });
      if (error) failed('clear_account_slack_webhook', error);
    },
    async slackLast4(accountId) {
      const { data, error } = await admin.rpc('account_slack_last4', { p_account: accountId });
      if (error) failed('account_slack_last4', error);
      return (data as string | null) ?? null;
    },
  };
}
