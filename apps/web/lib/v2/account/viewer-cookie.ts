/**
 * The account switcher's cookie (CC-31 D2b): the id of the account a person with several seats chose
 * to act in. It is a preference and no credential: `readViewer` follows it only when it names one of
 * the caller's own active seats, so a forged or stale value reads as no choice.
 */
export const ACCOUNT_COOKIE = 'cm_account';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cookie's value as an account id, or null when it is absent or not shaped like one. */
export function chosenAccount(value: string | undefined): string | null {
  return value !== undefined && ID.test(value) ? value : null;
}

/** The choice a request's `Cookie` header carries, for a route that holds the request. */
export function chosenInHeader(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === ACCOUNT_COOKIE) return chosenAccount(value);
  }
  return null;
}

/** The cookie that records `accountId` as the choice; `secure` is true wherever the site is HTTPS. */
export function accountCookie(accountId: string, secure: boolean) {
  if (!ID.test(accountId)) throw new RangeError('accountCookie: not an account id');
  return {
    name: ACCOUNT_COOKIE,
    value: accountId,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  } as const;
}
