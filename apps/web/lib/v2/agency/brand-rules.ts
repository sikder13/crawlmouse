/**
 * The white-label brand's rules (Goal 1 row 24), shared by the route that saves it
 * (`app/api/agency/brand/route.ts`) and the Settings card that posts to it
 * (`lib/v2/view/settings.ts`), so the card shows the route's own rule and is shown only to the
 * roles the route accepts. No server-only import: a client component may read it.
 */
import type { SeatRole } from '../account/profile';

/** The route; the account is named in its query string (`?account=<uuid>`). */
export const AGENCY_BRAND_ROUTE = '/api/agency/brand';

/** The multipart body's field names. Any `accountId` field in the body is never read. */
export const BRAND_FIELDS = { name: 'agencyName', logo: 'logo' } as const;

/** The longest brand name, in characters (code points) after controls are stripped and trimmed. */
export const BRAND_NAME_MAX = 60;

/**
 * What a refused name must change, said with the refusal: the length, and the shapes the mail
 * templates' `LINKABLE` guard refuses (an @, a colon or a slash, a dot followed by another
 * character, seven digits or more).
 */
export const BRAND_NAME_RULE = `Use 1 to ${BRAND_NAME_MAX} characters, with no @, colon or slash, no dot followed by another character, and no number of 7 digits or more.`;

/** The seat roles the route lets save a brand; every other role and no seat are refused 403. */
export const BRAND_EDITORS: readonly SeatRole[] = ['owner', 'account_manager'];

/** Saves an hour per account before the route answers 429 `rate_limited`. */
export const BRAND_SAVES_PER_HOUR = 5;
