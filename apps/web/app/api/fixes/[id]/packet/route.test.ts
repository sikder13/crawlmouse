import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// GET /api/fixes/[id]/packet (CC-26b D9). The route's own guards, then lib/v2/account/fixes.ts,
// run over PGlite through the PostgREST stand-in: the session client as the caller (row security
// and column grants apply), the service role without.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as string | null,
  log: [] as string[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', async () => {
  const { clients } = await import('@/lib/v2/account/test-support/fix-world');
  return {
    supabaseServer: async () => {
      h.log.push('supabaseServer');
      return clients(h.db, h.user).session;
    },
  };
});
vi.mock('@/lib/supabase/admin', async () => {
  const { clients } = await import('@/lib/v2/account/test-support/fix-world');
  return {
    supabaseAdmin: () => {
      h.log.push('supabaseAdmin');
      return clients(h.db, null).admin;
    },
  };
});

import { fixture } from '@/lib/v2/fixtures';
import { fixWorld, makePro, type FixWorld } from '@/lib/v2/account/test-support/fix-world';
import { packetBodies, packetPrompt } from '@/lib/v2/view/segment/fixes';
import { bodyFor, withBodies } from '@/lib/v2/view/test-support/multi-body';
import { GET } from './route';

const PACKET = fixture('bad-site').fixes.find((f) => f.packet !== null)!.packet!;
/** The answer for a visible fix: its packet, and the prompt Copy fix copies, built from that packet. */
const ANSWER = {
  packet: PACKET,
  prompt: expect.stringMatching(
    new RegExp(
      [...PACKET.change, PACKET.verify.command]
        .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\S]*'),
    ),
  ),
};

let fw: FixWorld;
beforeAll(async () => {
  fw = await fixWorld();
  h.db = fw.db;
  for (const id of fw.ranked)
    await fw.db.query(`update public.site_fixes set packet = $2::jsonb where id = $1`, [
      id,
      JSON.stringify(PACKET),
    ]);
}, 120_000);
afterAll(async () => {
  await fw?.db.close();
});
beforeEach(() => {
  process.env.V2_CHECKS_PUBLIC = '1';
  h.log.length = 0;
  h.user = fw.w.ownerId;
});

const get = (id: string, query = '') =>
  GET(new Request(`https://crawlmouse.com/api/fixes/${id}/packet${query}`), {
    params: Promise.resolve({ id }),
  });
const answer = async (res: Response) => [res.status, await res.json()];

describe('GET /api/fixes/[id]/packet', () => {
  it('404 with V2_CHECKS_PUBLIC unset, before anything else runs', async () => {
    delete process.env.V2_CHECKS_PUBLIC;
    expect(await answer(await get(fw.ranked[0]!))).toEqual([404, { code: 'not_found' }]);
    expect(h.log).toEqual([]);
  });

  it('401 auth_required signed out, with no service-role client', async () => {
    h.user = null;
    expect(await answer(await get(fw.ranked[0]!))).toEqual([401, { code: 'auth_required' }]);
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('the same 404 for another account’s fix, no such fix and a malformed id, with no service-role client', async () => {
    const theirs = fw.stranger.seeded.site_fixes[0]!.pk.id as string;
    for (const id of [theirs, '6f1c2a8e-0000-4000-8000-000000000000', 'not-an-id']) {
      h.log.length = 0;
      expect(await answer(await get(id))).toEqual([404, { code: 'not_found' }]);
      expect(h.log).toEqual(['supabaseServer']);
    }
  });

  it('a developer seat reads the packet of a visible fix on its site', async () => {
    h.user = fw.w.scopedUserId;
    expect(await answer(await get(fw.ranked[0]!))).toEqual([200, ANSWER]);
  });

  it('a developer seat scoped to another site gets the 404', async () => {
    h.user = fw.w.scopedUserId;
    const onSite2 = fw.w.seeded.site_fixes.find((r) => r.scope === 'site2')!.pk.id as string;
    expect(await answer(await get(onSite2))).toEqual([404, { code: 'not_found' }]);
  });

  it('402 packets for a fix Free does not open, which Pro opens', async () => {
    const hidden = fw.ranked[3]!;
    expect(await answer(await get(hidden))).toEqual([
      402,
      { code: 'upgrade_required', gate: 'packets' },
    ]);
    const copy = (await fw.db.clone()) as PGlite;
    h.db = copy;
    try {
      await makePro(copy, fw.w.accountId);
      expect(await answer(await get(hidden))).toEqual([200, ANSWER]);
    } finally {
      h.db = fw.db;
      await copy.close();
    }
  });

  it('404 for a fix of a removed site', async () => {
    const copy = (await fw.db.clone()) as PGlite;
    h.db = copy;
    try {
      await copy.query(`update public.sites set removed_at = now() where id = $1`, [fw.w.site1]);
      expect(await answer(await get(fw.ranked[0]!))).toEqual([404, { code: 'not_found' }]);
    } finally {
      h.db = fw.db;
      await copy.close();
    }
  });

  it('404 no_packet for a visible fix no packet was written for', async () => {
    const copy = (await fw.db.clone()) as PGlite;
    h.db = copy;
    try {
      await copy.query(`update public.site_fixes set packet = null where id = $1`, [fw.ranked[1]]);
      expect(await answer(await get(fw.ranked[1]!))).toEqual([404, { code: 'no_packet' }]);
    } finally {
      h.db = fw.db;
      await copy.close();
    }
  });

  describe('?framework=', () => {
    /** The packet (written for any stack) with a WordPress and a Next.js body beside its own. */
    const SEVERAL = withBodies(PACKET, ['wordpress', 'nextjs']);
    let copy: PGlite;
    let title: string;
    beforeAll(async () => {
      copy = (await fw.db.clone()) as PGlite;
      await copy.query(`update public.site_fixes set packet = $2::jsonb where id = $1`, [
        fw.ranked[0],
        JSON.stringify(SEVERAL),
      ]);
      const row = await copy.query<{ title: string }>(
        `select title from public.site_fixes where id = $1`,
        [fw.ranked[0]],
      );
      title = row.rows[0]!.title;
    });
    afterAll(async () => {
      await copy?.close();
    });
    beforeEach(() => {
      h.db = copy;
    });
    afterEach(() => {
      h.db = fw.db;
    });

    it('without it: the stored packet and the prompt of its own framework’s body, as before', async () => {
      const [status, body] = await answer(await get(fw.ranked[0]!));
      expect(status).toBe(200);
      expect(body).toEqual({
        packet: SEVERAL,
        prompt: packetPrompt({ title }, packetBodies(SEVERAL)[0]!),
      });
    });

    it('with a framework the packet holds a body for: that body and its prompt', async () => {
      const bodies = packetBodies(SEVERAL);
      expect(bodies.map((b) => b.framework)).toEqual(['generic', 'wordpress', 'nextjs']);
      for (const b of bodies) {
        const [status, body] = await answer(await get(fw.ranked[0]!, `?framework=${b.framework}`));
        expect([status, body]).toEqual([200, { body: b, prompt: packetPrompt({ title }, b) }]);
      }
      // Independently of packetBodies: the WordPress answer is the hand-made WordPress body's.
      const [, answered] = await answer(await get(fw.ranked[0]!, '?framework=wordpress'));
      expect(answered.body).toEqual(bodyFor('wordpress'));
      expect(answered.prompt).toContain(bodyFor('wordpress').change[0]);
      expect(answered.prompt).not.toContain(PACKET.change[0]);
    });

    it('404 no_packet_for_framework for a framework the packet lists without a body, and for a value that names none', async () => {
      // The fixture's own shape on the second fix: six frameworks listed, one body held.
      expect([PACKET.frameworks.length, PACKET.packets.length]).toEqual([6, 0]);
      const listed = PACKET.frameworks.find((f) => f !== PACKET.framework)!;
      for (const [id, value] of [
        [fw.ranked[1]!, listed],
        [fw.ranked[0]!, 'webflow'],
        [fw.ranked[0]!, 'nuxt'],
        [fw.ranked[0]!, ''],
        [fw.ranked[0]!, 'WORDPRESS'],
        [fw.ranked[0]!, '__proto__'],
      ] as const) {
        expect(await answer(await get(id, `?framework=${value}`)), value).toEqual([
          404,
          { code: 'no_packet_for_framework' },
        ]);
      }
    });

    it('the tier is checked before the framework: 402 for a fix Free does not open, whatever is asked for', async () => {
      for (const value of ['wordpress', 'nuxt']) {
        expect(await answer(await get(fw.ranked[3]!, `?framework=${value}`))).toEqual([
          402,
          { code: 'upgrade_required', gate: 'packets' },
        ]);
      }
    });

    it('404 no_packet for a fix with no packet, whatever is asked for', async () => {
      await copy.query(`update public.site_fixes set packet = null where id = $1`, [fw.ranked[2]]);
      expect(await answer(await get(fw.ranked[2]!, '?framework=generic'))).toEqual([
        404,
        { code: 'no_packet' },
      ]);
    });
  });
});
