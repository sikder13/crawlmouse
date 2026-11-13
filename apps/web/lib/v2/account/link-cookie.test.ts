import { describe, expect, it } from 'vitest';
import {
  clearLinkCookie,
  landLink,
  LINK_COOKIE_SECONDS,
  LINK_FLOWS,
  linkCookieSeconds,
  linkToken,
  type LinkFlow,
} from './link-cookie';
import { newToken } from './tokens';

const ORIGIN = 'https://crawlmouse.com';
const FLOWS = Object.keys(LINK_FLOWS) as LinkFlow[];

describe('landing an emailed link', () => {
  it.each(FLOWS)(
    '%s: moves the token into its cookie and redirects to a URL without it',
    (flow) => {
      const token = newToken();
      const res = landLink(ORIGIN, flow, token);
      expect(res.status).toBe(303);
      const location = res.headers.get('location')!;
      expect(location).toBe(`${ORIGIN}${LINK_FLOWS[flow].page}`);
      expect(location).not.toContain(token);
      const set = res.headers.get('set-cookie')!;
      expect(set).toContain(`${LINK_FLOWS[flow].cookie}=${token};`);
      for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
        expect(set).toContain(attr);
      }
      expect(set).toContain(`Max-Age=${linkCookieSeconds(flow)};`);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    },
  );

  it('keeps the invitation for an hour, across a sign-in by email, and the other flows for ten minutes', () => {
    expect(LINK_COOKIE_SECONDS).toBe(600);
    expect(Object.fromEntries(FLOWS.map((flow) => [flow, linkCookieSeconds(flow)]))).toEqual({
      emailChange: 600,
      emailUndo: 600,
      deleteConfirm: 600,
      restore: 600,
      invite: 3600,
      reportConfirm: 600,
      reportPause: 600,
    });
    expect(landLink(ORIGIN, 'invite', newToken()).headers.get('set-cookie')).toContain(
      'Max-Age=3600;',
    );
    expect(landLink(ORIGIN, 'restore', newToken()).headers.get('set-cookie')).toContain(
      'Max-Age=600;',
    );
  });

  it('sets no cookie for a value that is not a token, and still redirects', () => {
    for (const bad of ['', 'abc', `${newToken()}x`, '../../etc', `${'a'.repeat(42)};`]) {
      const res = landLink(ORIGIN, 'deleteConfirm', bad);
      expect(res.status).toBe(303);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('reads back only its own flow’s token', () => {
    const a = newToken();
    const b = newToken();
    const header = `other=1; ${LINK_FLOWS.deleteConfirm.cookie}=${a}; ${LINK_FLOWS.restore.cookie}=${b}`;
    expect(linkToken(header, 'deleteConfirm')).toBe(a);
    expect(linkToken(header, 'restore')).toBe(b);
    expect(linkToken(header, 'emailChange')).toBeNull();
    expect(linkToken(null, 'restore')).toBeNull();
    expect(linkToken(`${LINK_FLOWS.restore.cookie}=short`, 'restore')).toBeNull();
  });

  it('the email undo cookie is not read as the email change cookie, though one name starts the other', () => {
    const undo = newToken();
    expect(linkToken(`${LINK_FLOWS.emailUndo.cookie}=${undo}`, 'emailChange')).toBeNull();
  });

  it('clears a flow’s cookie with Max-Age=0 and the same path', () => {
    expect(clearLinkCookie('restore')).toMatch(
      /^cm_link_restore=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/,
    );
  });
});
