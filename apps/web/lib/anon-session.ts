import 'server-only';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';

const COOKIE = 'crawlmouse_anon';
const MAX_AGE_S = 60 * 60 * 24 * 365; // 1 year

/**
 * A stable, unguessable per-browser id for anonymous audits. httpOnly (not readable by
 * JS) — it acts as the capability that lets a visitor claim the audits they ran before
 * signing up. Settable only from a Route Handler / Server Action (not a Server Component).
 */
export async function getOrCreateAnonSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) return existing;
  const id = randomUUID();
  jar.set(COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_S,
  });
  return id;
}

export async function readAnonSessionId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value ?? null;
}

export async function clearAnonSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
