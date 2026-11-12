import { describe, expect, it } from 'vitest';
import { buildOutgoing } from '../headers';
import { MAIL_KINDS } from '../types';
import { foreignTargets } from './inspect';
import { MAIL_PREVIEWS, mailPreview } from './previews';

describe('the mail preview registry (D2)', () => {
  it('previews every kind that has a template, under unique, path-safe slugs', () => {
    const kinds = new Set(MAIL_PREVIEWS.map((p) => p.kind));
    // `alert` and `weekly_summary` are WS-C's templates; they join this list with them.
    const pending = new Set(['alert', 'weekly_summary']);
    expect(MAIL_KINDS.filter((k) => !kinds.has(k) && !pending.has(k))).toEqual([]);
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
      expect(() => buildOutgoing({ to: 'a@example.com', mail: m, idempotencyKey: 'k' })).not.toThrow();
      expect(m.text.length).toBeGreaterThan(0);
    },
  );
});
