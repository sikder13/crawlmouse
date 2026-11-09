import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { WEB_ROOT } from '../_lib/tokens-css';
import * as constants from '../../../lib/auth/constants';
import * as prices from '../../../lib/billing/prices';
import { TRIAL_DAYS } from '../../../lib/billing/state-machine';
import { GATES } from '../../../lib/entitlement-v2';
import {
  EMAIL_MONTHS,
  MIN_PEPPER_LENGTH,
  RECENT_DAYS,
  RECENT_TRIALS_REFUSED_AT,
} from '../../../lib/auth/ledger';
import { FIRST_LOGIN_TOLERANCE_MS, TRIAL_OUTCOMES } from '../../../lib/auth/first-login';
import { CLAIM_REFUSALS } from '../../../lib/auth/claim';
import { SCHEDULE_HOUR_LOCAL } from '../../../lib/auth/schedule';
import { ACCOUNT_DOOR_CHANGES } from '../../../lib/v2/copy/account-door';
import { PREVIEWS } from '../../../app/(v2-preview)/v2-preview/_preview/registry';
import {
  applyBody,
  MAGIC_LINK_HREF,
  PRODUCTION_SITE_URL,
  SIGNUP_HREF,
} from '../../../../../scripts/supabase/auth-config';
import { code, table } from './build-spec-22';

export const SPEC_25_PATH = join(WEB_ROOT, '..', '..', 'docs', 'specs', 'v2', '25-account-door.md');

const minutes = (ms: number) => `${ms / 60_000} minutes`;
const days = (s: number) => `${s / 86_400} days`;

function constantsSection(): string {
  const c = constants;
  return [
    '## Constants',
    '',
    'From `apps/web/lib/auth/constants.ts` and `apps/web/lib/billing/prices.ts`, which the pages render. `__tests__/v2/account-door-screens.test.tsx` fails on a number in the door’s visible text, outside the shell, that none of these, `GATES` or `TRIAL_DAYS` holds.',
    '',
    table(
      ['Constant', 'Value'],
      [
        [code('AUTH_LINK_MINUTES'), String(c.AUTH_LINK_MINUTES)],
        [code('SIGNIN_SENDER'), code(c.SIGNIN_SENDER)],
        [code('ALERTS_SENDER'), code(c.ALERTS_SENDER)],
        [
          code('FIRST_AUDIT_MINUTES'),
          `${c.FIRST_AUDIT_MINUTES} (shown only with \`V2_PIPELINE=1\`)`,
        ],
        [code('RESEND_HINT_MINUTES'), String(c.RESEND_HINT_MINUTES)],
        [code('TRIAL_REMINDER_DAYS_BEFORE_END'), String(c.TRIAL_REMINDER_DAYS_BEFORE_END)],
        [code('EMAIL_KINDS'), c.EMAIL_KINDS.map(code).join(', ')],
        [code('TRIAL_DAYS'), `${TRIAL_DAYS} (\`lib/billing/state-machine.ts\`)`],
        ...(
          [
            'PRO_MONTHLY',
            'PRO_YEARLY',
            'AGENCY_MONTHLY',
            'AGENCY_YEARLY',
            'EXTRA_SEAT',
            'EXTRA_SITE',
          ] as const
        ).map((k) => [code(k), prices.usd(prices[k])]),
      ],
    ),
    '',
    `\`SIGNIN_SENDER\` is the address the Supabase template sends from today. CC-28 moves the template to \`signin@crawlmouse.com\` and changes the constant in the same step.`,
  ].join('\n');
}

function cookiesSection(): string {
  const c = constants.COOKIES;
  return [
    '## Cookies',
    '',
    'Each is httpOnly, `SameSite=Lax`, and `Secure` in production. Every value read back is validated again: a cookie is the caller’s to set. `cm_auth_for` binds every magic-link request, door or v1, to its address: the landing uses the named site and a Keep’s claim, and `/login/verify` the anonymous v1 audits’ claim, only when it matches the email the link signed in. No cookie reaches Sentry: the door’s names contain `auth`, which the span-header filter replaces with `[Filtered]`; `sentry.server.config.ts` runs the request-data integration with cookies off, which removes `request.cookies` and the raw `Cookie` header from every event; and `lib/auth/sentry-scrub.ts`, on every event and transaction, walks only the event’s own plain objects (never the SDK’s live state), drops `cookie`, `cookies`, `set-cookie`, `token_hash`, `post_login_next` and span cookie-header keys, and replaces `token_hash`, `code`, `post_login_next` and PostgREST `=eq.` filter values in strings. `__tests__/v2/account-door-sentry.test.ts` drives the SDK’s own pipeline, a message and a forced transaction, with both layers, each alone and neither.',
    '',
    table(
      ['Name', 'Set by', 'Path', 'Lifetime', 'Holds'],
      [
        [
          code(c.otp),
          'GET /login/verify',
          '`/login/verify`',
          minutes(constants.AUTH_LINK_SECONDS * 1000),
          'the link’s token, until the POST spends or refuses it',
        ],
        [
          code(c.signup),
          'the magic-link route, door on',
          '`/`',
          minutes(constants.AUTH_LINK_SECONDS * 1000),
          'the named site (shape-checked host) and the time zone',
        ],
        [
          code(c.next),
          'the magic-link route',
          '`/`',
          `${minutes(constants.AUTH_LINK_SECONDS * 1000)} for a door request; ${minutes(constants.V1_NEXT_COOKIE_SECONDS * 1000)} for v1`,
          'the return target; for a Keep, the claim',
        ],
        [
          code(c.device),
          'the magic-link route, door on, when absent',
          '`/`',
          days(constants.DEVICE_COOKIE_SECONDS),
          '32 random bytes, base64url: the ledger’s device signal',
        ],
      ],
    ),
  ].join('\n');
}

function flagSection(): string {
  return [
    '## Flags',
    '',
    'Read per request by `apps/web/lib/auth/flags.ts`; on for the value `1` only.',
    '',
    table(
      ['Surface', '`V2_ACCOUNT_DOOR` unset', '`V2_ACCOUNT_DOOR=1`'],
      [
        ['`/signup`, `/check-email`', '404', 'rendered, noindex, no canonical'],
        ['`POST /api/checks/[id]/claim`', '404', 'claims for a member'],
        [
          '`POST /api/auth/magic-link`',
          'v1: `site`, `tz`, `claimCheckId` are not read',
          'reads them; refuses a cross-site post; sets `cm_auth_signup`, `cm_auth_device`; computes `next`',
        ],
        ['`GET /login/verify`', 'renders (carries the token to Continue)', 'the same'],
        [
          '`POST /login/verify`',
          'verifies, v1 claim, redirect',
          'and then the first-login hook and a Keep’s claim',
        ],
      ],
    ),
    '',
    'With `V2_PIPELINE=1` (CC-20b) Sign-up and Check-email say a named site’s first audit starts when the link is opened, that a kept site is re-checked and that change notes come from `alerts@`, and Sign-up points to Keep on the audit page; without it they say only that the site is kept (D6). The keep bar’s own line (\`We’ll re-check {domain} monthly\`) is the locked one-ask line and renders only on CC-20b’s live result page. This step starts no check. Before CC-20b sets the flag, those sentences must be true: checks scheduled, and CC-28 sending from `alerts@`.',
  ].join('\n');
}

function firstLoginSection(): string {
  return [
    '## First login and the trial ledger',
    '',
    `First login is the verify that confirmed the email: in that verify’s response \`email_confirmed_at\` and \`last_sign_in_at\` are within ${FIRST_LOGIN_TOLERANCE_MS / 1000} s of each other (D5 as amended). It depends on Supabase Auth’s \`mailer_autoconfirm\` being false, which \`auth-config --read\` asserts.`,
    '',
    `The ledger rule (D4 as amended, with SECURITY-DESIGN §5.3): the trial is refused when \`trial_ledger\` holds, under the same hash, an \`email\` row younger than ${EMAIL_MONTHS} calendar months; or ${RECENT_TRIALS_REFUSED_AT} \`device\` rows in the last ${RECENT_DAYS} days; or ${RECENT_TRIALS_REFUSED_AT} \`ip24\` rows in the last ${RECENT_DAYS} days together with a \`device\` row in the same window. An IP alone never refuses. IPv4 is keyed by its /24, IPv6 by its /48. Values are HMAC-SHA256 under \`TRIAL_LEDGER_PEPPER\` over \`kind:value\`; a pepper shorter than ${MIN_PEPPER_LENGTH} characters reads as none, and then nothing is read or written, the account stays Free and Sentry gets \`auth.trial-ledger-no-pepper\`. CC-04 owns the \`hostname\` and \`card_fingerprint\` kinds and the 13-month sweep.`,
    '',
    "The trial is decided in one call, `start_trial_with_ledger` (migration 006c, `docs/specs/v2/06c-trial-function.md`), and the rule above is SQL in it (`trial_ledger_refusals`); the numbers here are the ones `lib/auth/ledger.ts` names, and `__tests__/v2-006c-trial-function.test.ts` runs vectors built from them through the SQL. The hook computes the hashes (the pepper never leaves the app) and `trial_started {variant: 'no_card'}` with `next()`. The function, in one transaction, locks the account and each hash, applies the rule, and either refuses or applies the transition through `apply_entitlement_transition` and writes the ledger rows. A decision it cannot make (an error other than a stale version, a lock timeout, an answer that is not a decision) is reported to Sentry as `auth.trial-decision-failed` with its `reason`, and the account stays Free; a stale version (`40001`) is a lost race, `not_first`, not reported.",
    '',
    table(
      ['Outcome', 'Meaning'],
      Object.entries(TRIAL_OUTCOMES).map(([k, v]) => [code(k), v]),
    ),
    '',
    `A site named on Sign-up is attached at any sign-in with room (a first login or a later one), after the SSRF guard (\`validateUrlOrThrow\`), with the owner seat and the tier’s schedule (\`GATES[tier].schedule\`: \`${GATES.pro.schedule}\` on a paid tier, \`${GATES.free.schedule}\` on Free), on the attach weekday at ${String(SCHEDULE_HOUR_LOCAL).padStart(2, '0')}:00 in the account’s zone.`,
  ].join('\n');
}

function claimSection(): string {
  return [
    '## Claim',
    '',
    '`claimCheck` (`apps/web/lib/auth/claim.ts`) is called by `POST /api/checks/[id]/claim` and by the sign-in POST for a Keep. One conditional update takes an unowned site (`where account_id is null`) for the caller’s default account and owner seat, with the tier’s schedule; then the check’s `expires_at` is cleared. A claim stopped between the two writes is completed by the next one.',
    '',
    table(
      ['Code', 'Status', 'When'],
      Object.entries(CLAIM_REFUSALS).map(([k, v]) => [code(k), String(v.status), v.when]),
    ),
    '',
    'The Storage move of the check’s evidence objects is CC-20b’s; no evidence object exists yet.',
  ].join('\n');
}

function correctionsSection(): string {
  return [
    '## Copy against the locked artboards',
    '',
    'From `apps/web/lib/v2/copy/account-door.ts`, applied by the lock comparison in `__tests__/v2/account-door-screens.test.tsx`.',
    '',
    table(
      ['Screen', 'Locked', 'Rendered', 'Why'],
      ACCOUNT_DOOR_CHANGES.map((c) => [c.screen, c.locked, c.rendered, c.source]),
    ),
  ].join('\n');
}

function previewSection(): string {
  const door = PREVIEWS.filter((p) => /\/screens\/(signup|check-email|continue)/.test(p.path));
  return [
    '## Preview pages',
    '',
    table(
      ['Path', 'Name', 'Orange elements'],
      door.map((p) => [code(p.path), p.name, String(p.orange ?? 1)]),
    ),
  ].join('\n');
}

function ownerSection(): string {
  const body = applyBody();
  return [
    '## Owner setup, in order',
    '',
    '0. Before merging: step 2 below. The Continue page ships live for every sign-in and its expired state says a new link works for 15 minutes; production’s `mailer_otp_exp` read 600 on 2026-11-05.',
    '1. Set `TRIAL_LEDGER_PEPPER` in Vercel (Production and Preview, Sensitive): at least 32 random characters, for example `openssl rand -base64 48`.',
    `2. Run \`SUPABASE_PROJECT_REF=<ref> pnpm --filter @crawlmouse/scripts exec tsx supabase/auth-config.ts --apply\`. It sets ${Object.entries(
      body,
    )
      .map(([k, v]) => `\`${k} = ${v}\``)
      .join(
        ' and ',
      )}, then reads back and checks \`mailer_autoconfirm = false\`, \`site_url = ${PRODUCTION_SITE_URL}\` and that the magic-link and confirmation templates link to \`${MAGIC_LINK_HREF}\` and \`${SIGNUP_HREF}\`.`,
    '3. Set `V2_ACCOUNT_DOOR=1` for Preview deployments only, and redeploy.',
    '4. Production gets `V2_ACCOUNT_DOOR=1` when CC-20b and CC-26 ship, not in this step.',
    '5. Before Production gets `V2_ACCOUNT_DOOR=1`: `db-apply-prod` has applied `20261108000001_v2_006c_trial_function_and_checks.sql` and the owner has verified it (`docs/specs/v2/06c-trial-function.md`, "After the apply"). The first-login hook calls `start_trial_with_ledger` and has no other path, so without it every first login fails and stays Free. The door goes off in Production before any rollback of that migration.',
  ].join('\n');
}

function gapsSection(): string {
  return [
    '## Known gaps and follow-ups',
    '',
    '- **The trial and its ledger rows are one transaction (CC-06c, closed).** `start_trial_with_ledger` replaced the separate ledger read, transition and insert, and the rate-limit slot before them; `auth.trial-ledger-write-failed` no longer exists. Its own known gaps are in `docs/specs/v2/06c-trial-function.md`.',
    '- **A failed trial decision is not retried** (CC-06c D11). First login is detected once; a sign-up whose decision failed stays Free, and Sentry has `auth.trial-decision-failed` for it.',
    '- **Cross-device.** The named site and a Keep’s claim ride cookies in the browser that asked for the link. Opened on another device, the link signs in and the trial is decided, but no site is attached and no audit claimed; the copy says "opened in this browser".',
    '- **The ledger is decided after Check-email is shown.** A refused sign-up reads "if it is your first trial" there; CC-26 shows the reason category on the dashboard.',
    '- **No-JS Continue** signs in and redirects, and fires no PostHog event.',
    '- **The check id is the claim right** (ARCH-2 §4.3): a member who holds an unowned check’s id may claim it. Two claims for two sites can pass the site limit together; the limit has no database constraint.',
    '- **Login CSRF through the link itself**: someone can send a person a sign-in link to the sender’s own account; opening it puts the sender’s token in `cm_auth_otp`, and Continue signs the person in as the sender. The POST refuses cross-site posts, which stops a page from doing this silently; the link itself is inherent to magic links. A named site and a Keep are bound to the address that asked for them (`cm_auth_for`), so they stay out of the sender’s account. When this browser asked for a link to another address (`cm_auth_for` set and not the sender’s), its device id is not recorded for the sender’s trial (CC-06c D9). Its anonymous v1 audits are claimed only when `cm_auth_for` is the binding of the address the link signed in, so a browser that asked for no link keeps them too (CC-V1FIX A-8; `app/login/verify/route.csrf.test.ts`). Such a browser’s device id is still recorded, since it cannot be told apart from the owner’s own link opened on another device.',
    '- **The locked trial sentence stands on the Sign-up lead and the Keep bar** (DESIGN-LOCK’s one-ask wording, "starts 14 days of Pro"): a sign-up the ledger refuses, or an existing account, reads it too. The named-site Check-email, shown after the ask, carries the condition; the from-audit kind states no trial with the pipeline off.',
    '- **What the account cannot take is not said on the page.** A named site is not attached when the account is full, when the SSRF guard refuses the host, or for a user from before migration 001 (no v2 account until CC-05’s backfill). A Keep is refused when the account is full (\`site_limit\`), already keeps that host (\`host_kept\`), has no v2 account (\`no_account\`), or the check has expired (\`expired\`). The copy says “if the account has room for another site”; a refused claim lands on \`/dashboard?claim=<code>\`, which the v1 dashboard does not read; CC-26 shows it.',
    '- **`cm_auth_for` is an unpeppered hash of the email**, so a known address can be matched to it; it is httpOnly and kept out of Sentry, and it relies on no other origin being able to set crawlmouse.com cookies.',
    '- **The Sentry scrubber does not recognise a `token_hash` that is double-URL-encoded, or written as a JSON key inside a string**; no current path sends either. It also hides PostgREST filter values that are not secrets (`removed_at=is.null` becomes `is.[Filtered]`), and does not walk class instances or Maps, which the SDK normalises to plain objects before it runs.',
    '- **On the Edge runtime, Sentry events now carry request headers, URL and query** (not cookies, not bodies), because the request-data integration is named in `sentry.server.config.ts`; before, Edge events had none.',
    '- **With `V2_PIPELINE=1` the copy is CC-20b’s to prove true**: the first-audit, re-check and alerts sentences and the keep bar’s line.',
    '- **Outside this step:** the result preview still shows the Agency price as $69 a month; Sign-up shows $99 (D7). The result page’s owner reconciles it.',
    '- **Fidelity notes**: the Sign-up footnote’s "14-day trial with a card" is text, not a link (the Agency trial page is CC-03’s); the plan card is a `section` (the v2 `Card` takes no `aside`); Check-email’s "Back to the audit" goes back in history (no live v2 audit route yet); "Send the link again" is disabled, drawn as the disabled quiet button, for the minute the page mentions after each send. The Turnstile widget draws its light theme on dark pages (`components/ui/Turnstile.tsx`, v1’s).',
  ].join('\n');
}

export async function buildSpec25(): Promise<string> {
  const md = [
    '# SPEC 25 — the account door',
    '',
    '> Generated by `pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts`. Do not edit it by hand: `apps/web/__tests__/v2/spec.test.ts` fails when this file differs from what the generator writes.',
    '',
    'Sign-up, Check your email, the sign-in landing that a link scanner cannot spend, the first-login hook that decides the no-card Pro trial and attaches the first site, and the claim of an anonymous v2 check. The constants, cookie lifetimes, ledger windows, outcomes, refusals, copy corrections and previews below are rendered from the code. The routes and flags tables are written; `app/login/verify/route.test.ts`, `app/api/auth/magic-link/route.v2.test.ts`, `app/api/checks/[id]/claim/route.test.ts` and `__tests__/v2/account-door-screens.test.tsx` test their rows.',
    '',
    '## Routes',
    '',
    table(
      ['Route', 'Guard'],
      [
        ['`GET /signup`', '`V2_ACCOUNT_DOOR=1`, else 404'],
        [
          '`GET /check-email?kind=signin|named-site|from-audit&site=`',
          '`V2_ACCOUNT_DOOR=1`, else 404; `site` shown only when it is a hostname',
        ],
        [
          '`POST /api/auth/magic-link`',
          'rate limits and Turnstile as before; with the door on, a cross-site post is a 403',
        ],
        [
          '`GET /login/verify`',
          'never verifies; moves the token into `cm_auth_otp`, 303 to `/login/verify/continue`',
        ],
        [
          '`GET /login/verify/continue`',
          'renders Continue, or the expired state with `?state=expired`',
        ],
        [
          '`POST /login/verify`',
          'same-origin (`Origin`, or `Origin: null` with `Sec-Fetch-Site: same-origin`), else 403',
        ],
        [
          '`POST /api/checks/[id]/claim`',
          '`V2_ACCOUNT_DOOR=1`, else 404; an `Origin` not ours is a 403; a session, else 401; a uuid id',
        ],
      ],
    ),
    '',
    flagSection(),
    '',
    cookiesSection(),
    '',
    firstLoginSection(),
    '',
    claimSection(),
    '',
    constantsSection(),
    '',
    correctionsSection(),
    '',
    previewSection(),
    '',
    ownerSection(),
    '',
    gapsSection(),
    '',
  ].join('\n');
  const options = (await resolveConfig(SPEC_25_PATH)) ?? {};
  return format(md, { ...options, parser: 'markdown' });
}
