/**
 * The account door's constants. The Sign-up, Check-email and Continue pages render these; none of
 * the numbers or addresses they show is typed in a component.
 */

/**
 * How long a sign-in link works. Supabase Auth enforces it (`mailer_otp_exp`), not this code:
 * `scripts/supabase/auth-config.ts --read` fails when production disagrees.
 */
export const AUTH_LINK_MINUTES = 15;
export const AUTH_LINK_SECONDS = AUTH_LINK_MINUTES * 60;

/**
 * The address the sign-in link comes from. The Supabase email template sends it from magic@ today;
 * CC-28 moves the template to signin@crawlmouse.com and changes this constant in the same step.
 */
export const SIGNIN_SENDER = 'magic@crawlmouse.com';

/** The address change notes will come from. Nothing sends from it before CC-28. */
export const ALERTS_SENDER = 'alerts@crawlmouse.com';

/** How long a first audit takes, as the Check-email page says it. Shown only with V2_PIPELINE=1. */
export const FIRST_AUDIT_MINUTES = 2;

/** How long to wait for the email before checking spam. */
export const RESEND_HINT_MINUTES = 1;

/** The one trial reminder goes this many days before the trial ends (ARCH-2 §3.2, FACTS A8). */
export const TRIAL_REMINDER_DAYS_BEFORE_END = 3;

/** Cookie names. Each is httpOnly; their lifetimes are below. */
export const COOKIES = {
  /** The sign-in link's token, between the GET that receives it and the POST that verifies it. */
  otp: 'cm_auth_otp',
  /** What a sign-up asked for: the first site and the time zone. */
  signup: 'cm_auth_signup',
  /** A random per-browser id, one of the trial ledger's signals. */
  device: 'cm_auth_device',
  /**
   * Which address a door request was made for: a hash (continue-intent.ts `emailBinding`), not the
   * address. The landing uses the named site and a Keep's claim only when it matches the email the
   * link verified, so a link to someone else's account cannot carry them into it.
   */
  binding: 'cm_auth_for',
  /** The validated return target after sign-in (v1's cookie, shared). */
  next: 'post_login_next',
} as const;

/** v1's return target lives 10 minutes, as it did before the door. */
export const V1_NEXT_COOKIE_SECONDS = 600;

/** `cm_auth_device` lives a year (SECURITY-DESIGN §5.3). */
export const DEVICE_COOKIE_SECONDS = 365 * 24 * 60 * 60;

/**
 * The only kinds of email an account gets (DESIGN-LOCK: exactly three). The Sign-up page's
 * sentence about email is built from this list, so it names no kind that is not here.
 */
export const EMAIL_KINDS = ['sign_in_link', 'change_note', 'trial_reminder'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
