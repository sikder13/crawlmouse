/**
 * The privacy page lists the first-touch cookie (CC-41 rulings, "Added"): every cookie name
 * lib/analytics/first-touch.ts declares, the one `firstTouchCookie` writes among them, how long it is
 * kept, and each field it holds.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PrivacyPage from '../app/privacy/page';
import {
  FIRST_TOUCH_FIELD_LABELS,
  FIRST_TOUCH_FIELDS,
  firstTouchCookie,
} from '../lib/analytics/first-touch';

const SOURCE = readFileSync(resolve(__dirname, '../lib/analytics/first-touch.ts'), 'utf8');
const DECLARED = [...SOURCE.matchAll(/export const \w+_COOKIE = '([^']+)'/g)].map((m) => m[1]!);
const page = renderToStaticMarkup(<PrivacyPage />);

describe('the privacy page and the first-touch cookie', () => {
  it('every cookie first-touch.ts declares is listed by name, and the written one is declared', () => {
    const written = firstTouchCookie({ first_seen_at: '2026-11-15T00:00:00Z' }).split('=')[0]!;
    expect(DECLARED).toContain(written);
    for (const name of DECLARED) expect(page).toContain(`(${name})`);
  });

  it('says it is kept for the days the cookie is kept', () => {
    const maxAge = Number(
      /Max-Age=(\d+)/.exec(firstTouchCookie({ first_seen_at: '2026-11-15T00:00:00Z' }))![1],
    );
    expect(page).toContain(`kept for ${maxAge / 86_400} days`);
  });

  it('names each field the cookie holds', () => {
    for (const f of FIRST_TOUCH_FIELDS) expect(page).toContain(FIRST_TOUCH_FIELD_LABELS[f]);
  });
});
