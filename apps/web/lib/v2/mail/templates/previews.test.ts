import { describe, expect, it } from 'vitest';
import { buildOutgoing } from '../headers';
import { MAIL_KINDS } from '../types';
import { foreignTargets } from './inspect';
import { MAIL_PREVIEWS, mailPreview } from './previews';

describe('the mail preview registry (D2)', () => {
  it('previews every kind that has a template, under unique, path-safe slugs', () => {
    const kinds = new Set(MAIL_PREVIEWS.map((p) => p.kind));
    expect(MAIL_KINDS.filter((k) => !kinds.has(k))).toEqual([]);
    const slugs = MAIL_PREVIEWS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
    expect(mailPreview('check-notify')?.kind).toBe('check_notify');
    expect(mailPreview('nope')).toBeUndefined();
  });

  it.each(MAIL_PREVIEWS.map((p) => [p.slug, p] as const))(
    '%s renders a sendable message whose links are all ours',
    (_, p) => {
      const m = p.render();
      expect(foreignTargets(m)).toEqual([]);
      expect(() =>
        buildOutgoing({ to: 'a@example.com', mail: m, idempotencyKey: 'k' }),
      ).not.toThrow();
      expect(m.text.length).toBeGreaterThan(0);
    },
  );
});

describe('the alert and summary previews show the lines rulings-3 added', () => {
  it('the alert: counts in the opening line, a grade line, a fix link and where phrases', () => {
    const m = mailPreview('alert')!.render();
    expect(m.text).toMatch(
      /^The check on \w{3} \d+ \w{3} at \d\d:\d\d [A-Z]{3,4} found \d+ problems? /m,
    );
    expect(m.text).toMatch(/^(Technical SEO|AI readability) [A-F][+-]? → [A-F][+-]?/m);
    expect(m.text).toMatch(
      /^ {2}Open the fix: https:\/\/crawlmouse\.com\/audit\/[0-9a-f-]+\/fix\/[0-9a-f-]+$/m,
    );
    expect(m.text).toContain('  in robots.txt · ');
    expect(m.text).toContain('  across the site · ');
    expect(m.text).not.toContain('America/');
  });

  it('the summary: the same where phrases, over the site’s week', () => {
    const m = mailPreview('weekly-summary')!.render();
    expect(m.text).toContain('  across the site · ');
    expect(m.text).toContain('  in robots.txt · ');
  });
});

describe('the previews a sample is built from', () => {
  it.each(['alert', 'weekly-summary'])(
    '%s takes a real unsubscribe link in place of its stand-in, in both bodies',
    (slug) => {
      const url = 'https://crawlmouse.com/unsubscribe?t=REALpayload.REALsig';
      const m = mailPreview(slug)!.render({ unsubscribeUrl: url });
      expect(m.html).toContain(url);
      expect(m.text).toContain(url);
      expect(`${m.html}${m.text}`).not.toContain('PREVIEW');
    },
  );

  it('the summary’s days hold every change it lists', () => {
    const m = mailPreview('weekly-summary')!.render();
    expect(m.text).toMatch(/from \d+ \w+ to \d+ \w+/);
    expect(m.text).not.toContain('No changes');
  });
});
