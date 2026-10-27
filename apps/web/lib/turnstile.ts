import 'server-only';
import { isProductionDeployment } from './turnstile-policy';

export async function verifyTurnstileToken(token: string, ip?: string): Promise<boolean> {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    // Fail closed in production: a missing secret there is a misconfiguration, not a dev convenience.
    if (isProductionDeployment(process.env)) {
      console.error(
        '[turnstile] TURNSTILE_SECRET_KEY is unset in production; rejecting the request.',
      );
      return false;
    }
    return true; // local development, test, or a preview without Turnstile: allow
  }
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    }),
  });
  const data = await res.json();
  return !!data.success;
}
