/**
 * INTERIM, deleted when CC-22b's branch merges (owner ruling Q10). CC-22b owns the product's one
 * server sender, `captureServerEvent` in `lib/analytics-server.ts`, the consent check
 * `serverCaptureAllowed` in `lib/consent.ts`, and `checkRef` in `lib/v2/pipeline/public.ts`. Until
 * those are on this branch, `events.ts` imports the same names from here, with the behaviour the
 * ruling gives them; at the merge this file is deleted and `events.ts`'s two imports point at theirs.
 */
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import { consentRequiredFromCookie } from '../../consent';

const DECISION_COOKIE = 'cm_consent';

/**
 * True when the visitor granted consent, false when they denied it; with no decision, true unless
 * their region needs prior consent.
 */
export function serverCaptureAllowed(cookieHeader?: string | null): boolean {
  for (const part of (cookieHeader ?? '').split(';')) {
    const pair = part.trim();
    if (pair === `${DECISION_COOKIE}=granted`) return true;
    if (pair === `${DECISION_COOKIE}=denied`) return false;
  }
  return !consentRequiredFromCookie(cookieHeader);
}

/** A check's reference in events: a hash of its id, which is a capability and is not sent. */
export const checkRef = (checkId: string): string => stableId('check_ref', checkId);

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/i/v0/e/';
/** How long a send may hold the action it records. */
const SEND_TIMEOUT_MS = 2000;

/**
 * Sends one event with no person profile and no IP or GeoIP, giving up after SEND_TIMEOUT_MS; a
 * failure is logged without the payload and swallowed.
 */
export async function captureServerEvent(
  event: string,
  distinctId: string,
  properties: Readonly<Record<string, unknown>>,
): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch(POSTHOG_CAPTURE_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: distinctId,
        properties: {
          ...properties,
          $process_person_profile: false,
          $ip: null,
          $geoip_disable: true,
        },
      }),
    });
    if (!res.ok) console.error(`server event ${event} refused: ${res.status}`);
  } catch {
    console.error(`server event ${event} failed to send`);
  }
}
