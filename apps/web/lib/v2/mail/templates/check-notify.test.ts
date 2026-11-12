import { describe, expect, it } from 'vitest';
import { buildOutgoing } from '../headers';
import { checkNotify } from './check-notify';
import { foreignTargets, htmlTargets, textUrls } from './inspect';

const CHECK = 'c0000000-0000-4000-8000-0000000000aa';
const HOSTILE = '<script>x</script>"\'&\r\nBcc: victim@example.com https://evil.example/';

describe('check-notify (D2, v1’s neutral rules)', () => {
  it('names the host and links the check’s own page, finished', () => {
    const m = checkNotify({ host: 'example.com', checkId: CHECK, outcome: 'finished' });
    expect(m.subject).toBe('Your Crawlmouse check of example.com is ready');
    expect(htmlTargets(m.html)).toEqual([`https://crawlmouse.com/audit/${CHECK}`]);
    expect(m.text).toContain(`https://crawlmouse.com/audit/${CHECK}`);
    expect(m.text).toContain("If you didn't request this email, you can safely ignore it");
    expect(m.html).toContain('If you didn&#39;t request this email, you can safely ignore it');
  });

  it('says a failed check ended without a result, and still links it', () => {
    const m = checkNotify({ host: 'example.com', checkId: CHECK, outcome: 'failed' });
    expect(m.subject).toBe('Your Crawlmouse check of example.com has ended');
    expect(m.text).toContain('did not complete');
    expect(htmlTargets(m.html)).toEqual([`https://crawlmouse.com/audit/${CHECK}`]);
  });

  it('carries no grade, score or number from the check', () => {
    for (const outcome of ['finished', 'failed'] as const) {
      const m = checkNotify({ host: 'example.com', checkId: CHECK, outcome });
      for (const part of [m.subject, m.text, m.html]) {
        expect(part).not.toMatch(/\bgrades?\b|\bscores?\b|\/100/i);
      }
      // No number at all in the words the reader sees (the link's id aside).
      for (const part of [m.subject, m.text.replace(/https:\/\/\S+/g, '')]) {
        expect(part).not.toMatch(/\d/);
      }
    }
  });

  it('escapes, bounds and folds the host, and never links it', () => {
    const m = checkNotify({ host: HOSTILE.repeat(20), checkId: CHECK, outcome: 'finished' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toMatch(/"'&\r?\n/);
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject.length).toBeLessThan(160);
    expect(foreignTargets(m)).toEqual([]);
    expect(textUrls(m.text).filter((u) => !u.includes('evil'))).toEqual([
      `https://crawlmouse.com/audit/${CHECK}`,
    ]);
    // The subject reaches a header only through buildOutgoing, which refuses a control character.
    expect(() =>
      buildOutgoing({ to: 'a@example.com', mail: m, idempotencyKey: 'check_notify:x' }),
    ).not.toThrow();
  });

  it('refuses a check id that is not one, rather than linking it', () => {
    expect(() =>
      checkNotify({ host: 'example.com', checkId: '../../evil', outcome: 'finished' }),
    ).toThrow(RangeError);
  });
});
