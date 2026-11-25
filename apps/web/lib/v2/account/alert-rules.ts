/**
 * The account's alert rules and its Slack destination (CC-27b D7): the write behind
 * `PUT /api/alert-rules`. The route establishes the caller's membership of the account through their
 * own session; this module decides what the body asks for and writes it, with the service role, to
 * that account only.
 *
 * The body is what the Alerts screen posts: one rule's switch, `{ rule, enabled }` (the rule an
 * account-level one, `site_id` null), and the Slack destination, `{ slackWebhookUrl }` to set or
 * replace it, `{ clearSlack: true }` to remove it, or `{ testSlack: true }` alone to post the fixed
 * test message to it. A form carries the same fields as strings. Setting a URL or testing one needs a
 * tier whose gates open Slack (402 otherwise); clearing one does not.
 *
 * The URL goes into Vault through `set_account_slack_webhook` and is not read back: the answer says
 * whether one is set and its last four characters, which is all a page shows. Setting it also puts
 * Slack on the account's rules, and clearing it takes Slack off them (`slackOnRules`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RequestBody } from '../../billing/request-body';
import type { TierGates } from '../../entitlement-v2';
import { SLACK_TEST_TEXT } from '../copy/integrations';
import { slackPoster, type PostSlack } from '../monitor/slack';

export const SLACK_URL_MAX = 500;
/** Slack's incoming-webhook URL, as `set_account_slack_webhook` (migration 027b, section C) holds it. */
const SLACK_URL = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+$/;

export interface AlertRulesPlan {
  rule: { id: string; enabled: boolean } | null;
  /** `test`: post the fixed test message to the stored webhook, and change nothing. */
  slack: { set: string } | 'clear' | 'test' | null;
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
      testSlack: flag(kind)
        .refine((v) => v)
        .optional(),
    })
    .refine((b) => (b.rule === undefined) === (b.enabled === undefined))
    .refine((b) => !(b.slackWebhookUrl !== undefined && b.clearSlack !== undefined))
    // A test changes nothing, so it travels alone.
    .refine(
      (b) =>
        !b.testSlack ||
        (b.rule === undefined && b.slackWebhookUrl === undefined && b.clearSlack === undefined),
    )
    .refine(
      (b) => b.rule !== undefined || b.slackWebhookUrl !== undefined || b.clearSlack || b.testSlack,
    );

/** What the body asks for, under the gates of the account's tier now. */
export function decideAlertRules(
  body: RequestBody,
  gates: Readonly<TierGates>,
): AlertRulesDecision {
  const parsed = bodyOf(body.kind).safeParse(body.fields);
  if (!parsed.success) return { ok: false, status: 400, code: 'invalid' };
  const b = parsed.data;
  if ((b.slackWebhookUrl !== undefined || b.testSlack) && !gates.slack) {
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
            : b.testSlack
              ? 'test'
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
  /** Posts the test message to the account's webhook, if its tier has Slack and one is set. */
  testSlack(accountId: string): Promise<'sent' | 'not_connected' | 'unreachable' | 'failed'>;
}

export type AlertRulesOutcome =
  | { ok: true; slack: SlackState; tested: boolean }
  | { ok: false; status: 404; code: 'not_found' }
  | { ok: false; status: 409; code: 'slack_not_connected' }
  | { ok: false; status: 502; code: 'slack_failed' }
  | { ok: false; status: 503; code: 'slack_unreachable' };

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
  if (plan.slack === 'test') {
    const sent = await ports.testSlack(accountId);
    if (sent === 'not_connected') return { ok: false, status: 409, code: 'slack_not_connected' };
    if (sent === 'failed') return { ok: false, status: 502, code: 'slack_failed' };
    if (sent === 'unreachable') return { ok: false, status: 503, code: 'slack_unreachable' };
  } else if (plan.slack === 'clear') await ports.clearSlack(accountId);
  else if (plan.slack !== null) await ports.setSlack(accountId, plan.slack.set);
  const last4 = await ports.slackLast4(accountId);
  return { ok: true, slack: { set: last4 !== null, last4 }, tested: plan.slack === 'test' };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`alert rules: ${what} failed: ${error.message}`);
}

/**
 * Puts Slack on each of the account's alert rules, beside their other channels, or takes it off.
 * A destination alone sends nothing: delivery posts to Slack for a fired rule whose `channels` name
 * it, and the default rules name email only (`seed_default_alert_rules`). So connecting Slack sends
 * every rule's alerts there too, and disconnecting stops it. A rule seeded after the connection
 * starts on email only.
 */
async function slackOnRules(admin: SupabaseClient, accountId: string, on: boolean): Promise<void> {
  const { data, error } = await admin
    .from('alert_rules')
    .select('id, channels')
    .eq('account_id', accountId);
  if (error) failed('alert_rules read', error);
  const rules = z.array(z.object({ id: z.string(), channels: z.array(z.string()) })).parse(data);
  for (const rule of rules) {
    const has = rule.channels.includes('slack');
    if (has === on) continue;
    const channels = on ? [...rule.channels, 'slack'] : rule.channels.filter((c) => c !== 'slack');
    const update = await admin
      .from('alert_rules')
      .update({ channels })
      .eq('id', rule.id)
      .eq('account_id', accountId);
    if (update.error) failed('alert_rules channels', update.error);
  }
}

/** The writes over the service role, each keyed by the account id. */
export function supabaseAlertRulePorts(
  admin: SupabaseClient,
  post: PostSlack = slackPoster(),
  now: () => Date = () => new Date(),
): AlertRulePorts {
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
      await slackOnRules(admin, accountId, true);
    },
    async clearSlack(accountId) {
      const { error } = await admin.rpc('clear_account_slack_webhook', { p_account: accountId });
      if (error) failed('clear_account_slack_webhook', error);
      await slackOnRules(admin, accountId, false);
    },
    async testSlack(accountId) {
      // The same read delivery makes: null unless the tier has Slack and a webhook is set.
      const { data, error } = await admin.rpc('account_slack_webhook_url', {
        p_account: accountId,
        p_now: now().toISOString(),
      });
      if (error) failed('account_slack_webhook_url', error);
      const url = (data as string | null) ?? null;
      if (url === null) return 'not_connected';
      const result = await post(url, SLACK_TEST_TEXT);
      if (result.ok) return 'sent';
      // A lookup or a connection that failed on our side never reached Slack: not the webhook's fault.
      return result.code === 'slack_dns' || result.code === 'network' ? 'unreachable' : 'failed';
    },
    async slackLast4(accountId) {
      const { data, error } = await admin.rpc('account_slack_last4', { p_account: accountId });
      if (error) failed('account_slack_last4', error);
      return (data as string | null) ?? null;
    },
  };
}
