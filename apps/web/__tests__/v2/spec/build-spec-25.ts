import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { WEB_ROOT } from '../_lib/tokens-css';
import * as constants from '../../../lib/auth/constants';
import * as prices from '../../../lib/billing/prices';
import { TRIAL_DAYS } from '../../../lib/billing/state-machine';
import { GATES } from '../../../lib/entitlement-v2';
import { MIN_PEPPER_LENGTH, RECENT_DAYS, RECENT_TRIALS_REFUSED_AT } from '../../../lib/auth/ledger';
import { FIRST_LOGIN_TOLERANCE_MS, TRIAL_OUTCOMES } from '../../../lib/auth/first-login';
import { CLAIM_REFUSALS } from '../../../lib/auth/claim';
import { SCHEDULE_HOUR_LOCAL } from '../../../lib/auth/schedule';
import { SERIALIZE_WINDOW_MS } from '../../../lib/auth/stores';
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
    'Each is httpOnly, `SameSite=Lax`, and `Secure` in production. Every value read back is validated again: a cookie is the caller’s to set.',
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
          'reads them; refuses a cross-site post; sets `cm_signup`, `cm_device`; computes `next`',
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
    'With `V2_PIPELINE=1` (CC-20b) Sign-up and Check-email say a named site’s first audit starts when the link is opened; without it they say the site is attached (D6). This step starts no check.',
  ].join('\n');
}

function firstLoginSection(): string {
  return [
    '## First login and the trial ledger',
    '',
    `First login is the verify that confirmed the email: in that verify’s response \`email_confirmed_at\` and \`last_sign_in_at\` are within ${FIRST_LOGIN_TOLERANCE_MS / 1000} s of each other (D5 as amended). It depends on Supabase Auth’s \`mailer_autoconfirm\` being false, which \`auth-config --read\` asserts.`,
    '',
    `The ledger rule (D4 as amended, with SECURITY-DESIGN §5.3): the trial is refused when \`trial_ledger\` holds, under the same hash, an \`email\` row younger than 12 calendar months; or ${RECENT_TRIALS_REFUSED_AT} \`device\` rows in the last ${RECENT_DAYS} days; or ${RECENT_TRIALS_REFUSED_AT} \`ip24\` rows in the last ${RECENT_DAYS} days together with a \`device\` row in the same window. An IP alone never refuses. IPv4 is keyed by its /24, IPv6 by its /48. Values are HMAC-SHA256 under \`TRIAL_LEDGER_PEPPER\` over \`kind:value\`; a pepper shorter than ${MIN_PEPPER_LENGTH} characters reads as none, and then nothing is read or written, the account stays Free and Sentry gets \`auth.trial-ledger-no-pepper\`. CC-04 owns the \`hostname\` and \`card_fingerprint\` kinds and the 13-month sweep.`,
    '',
    `Before the lookup, a one-shot bucket (\`increment_rate_limit\`, limit 1, ${minutes(SERIALIZE_WINDOW_MS)}, fail-closed) is taken on the email and device hashes, so two accounts sharing either cannot both pass. The trial is \`trial_started {variant: 'no_card'}\` through \`applyEntitlementTransition\`; the ledger rows are written only when that transition was applied.`,
    '',
    table(
      ['Outcome', 'Meaning'],
      Object.entries(TRIAL_OUTCOMES).map(([k, v]) => [code(k), v]),
    ),
    '',
    `A named first site is attached after the SSRF guard (\`validateUrlOrThrow\`), with the owner seat and the tier’s schedule (\`GATES[tier].schedule\`: \`${GATES.pro.schedule}\` on a paid tier, \`${GATES.free.schedule}\` on Free), on the attach weekday at ${String(SCHEDULE_HOUR_LOCAL).padStart(2, '0')}:00 in the account’s zone.`,
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
  ].join('\n');
}

function gapsSection(): string {
  return [
    '## Known gaps and follow-ups',
    '',
    "- **CC-06c: `start_trial_with_ledger(account_id, hashes[])`**, one SQL function, owner-applied; `hashes` is the array of `(kind, value_hash)` pairs the hook computes. Today the trial and its ledger rows are two PostgREST calls: a crash between them leaves a trial with no ledger rows (reported to Sentry as `auth.trial-ledger-write-failed`). The function does, in one transaction: lock the account `for update`; refuse unless `state = 'free' and trial_used_at is null`; read `trial_ledger` for the hashes under the rule above; apply the transition `apply_entitlement_transition` applies for `trial_started`; insert the rows; return the outcome. `lib/auth/first-login.ts` then calls it in place of steps 2 to 4.",
    '- **Cross-device.** The named site and a Keep’s claim ride cookies in the browser that asked for the link. Opened on another device, the link signs in and the trial is decided, but no site is attached and no audit claimed; the copy says "opened in this browser".',
    '- **The ledger is decided after Check-email is shown.** A refused sign-up reads "if it is your first trial" there; CC-26 shows the reason category on the dashboard.',
    '- **No-JS Continue** signs in and redirects, and fires no PostHog event.',
    '- **The check id is the claim right** (ARCH-2 §4.3): a member who holds an unowned check’s id may claim it. Two claims for two sites can pass the site limit together; the limit has no database constraint.',
    '- **Login CSRF through the link itself**: someone can send a person a sign-in link to the sender’s own account; opening it puts the sender’s token in `cm_otp`, and Continue signs the person in as the sender. The POST refuses cross-site posts, which stops a page from doing this silently; the link itself is inherent to magic links.',
    '- **Existing users naming a site on Sign-up**: the site is attached on the first login only; CC-26’s dashboard adds sites after that.',
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
          'never verifies; moves the token into `cm_otp`, 303 to `/login/verify/continue`',
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
