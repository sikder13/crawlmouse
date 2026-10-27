import { describe, it, expect } from 'vitest';
import { CompletionRoute, eventIdFor, type DoneEvent } from './completion.js';
import { signJwt } from './auth.js';

const JWT_SECRET = 'unit-test-jwt-value-not-a-credential';
const NOW = 1_800_000_000_000;
const counters = { fetched: 5, newUrls: 2, blocked: 0, bytes: 1000, partial: false };

function setup() {
  const events: DoneEvent[] = [];
  const route = new CompletionRoute({
    jwtSecret: JWT_SECRET,
    now: () => NOW,
    emit: async (e) => {
      // A real send awaits the network; the yield is what a race would exploit.
      await new Promise((r) => setTimeout(r, 5));
      events.push(e);
    },
  });
  route.openBatch({ checkId: 'chk1', batch: 2, nonce: 'nonce-two-aaaa' });
  route.openBatch({ checkId: 'chk1', batch: 3, nonce: 'nonce-three-bbb' });
  const jwt = (batch: number, nonce: string, exp = NOW / 1000 + 900) =>
    signJwt({ check_id: 'chk1', batch, nonce, role: 'crawl_worker', iat: NOW / 1000, exp }, JWT_SECRET);
  return { route, events, jwt };
}

describe('completion route (spike spec 2.7)', () => {
  it('accepts a valid JWT once and emits the event with the documented id', async () => {
    const { route, events, jwt } = setup();
    const r = await route.handle({ jwt: jwt(2, 'nonce-two-aaaa'), checkId: 'chk1', batch: 2, nonce: 'nonce-two-aaaa', counters });
    expect(r.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe('batch:chk1:2:nonce-two-aaaa');
    expect(eventIdFor('chk1', 2, 'nonce-two-aaaa')).toBe(events[0]!.id);
    expect(route.stateOf('chk1', 2)).toBe('done');
  });

  it('refuses a replay of the same valid JWT and sends no second event', async () => {
    const { route, events, jwt } = setup();
    const req = { jwt: jwt(2, 'nonce-two-aaaa'), checkId: 'chk1', batch: 2, nonce: 'nonce-two-aaaa', counters };
    expect((await route.handle(req)).status).toBe(200);
    const again = await route.handle(req);
    expect(again.status).toBe(409);
    expect(events).toHaveLength(1);
  });

  it('refuses an expired JWT and leaves the batch open', async () => {
    const { route, events, jwt } = setup();
    const r = await route.handle({ jwt: jwt(2, 'nonce-two-aaaa', NOW / 1000 - 1), checkId: 'chk1', batch: 2, nonce: 'nonce-two-aaaa', counters });
    expect(r.status).toBe(401);
    expect(route.stateOf('chk1', 2)).toBe('open');
    expect(events).toHaveLength(0);
  });

  it('refuses the JWT minted for batch 2 when it is presented for batch 3', async () => {
    const { route, events, jwt } = setup();
    const r = await route.handle({ jwt: jwt(2, 'nonce-two-aaaa'), checkId: 'chk1', batch: 3, nonce: 'nonce-three-bbb', counters });
    expect(r.status).toBe(403);
    expect(route.stateOf('chk1', 3)).toBe('open');
    expect(events).toHaveLength(0);
  });

  it('applies exactly once when two completions arrive together', async () => {
    const { route, events, jwt } = setup();
    const req = { jwt: jwt(2, 'nonce-two-aaaa'), checkId: 'chk1', batch: 2, nonce: 'nonce-two-aaaa', counters };
    const results = await Promise.all([route.handle(req), route.handle(req)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(events).toHaveLength(1);
  });

  it('refuses a batch that was never opened, and a nonce that does not match the open row', async () => {
    const { route, jwt } = setup();
    const unknown = await route.handle({ jwt: jwt(9, 'n'), checkId: 'chk1', batch: 9, nonce: 'n', counters });
    expect(unknown.status).toBe(404);
    const wrongNonce = await route.handle({ jwt: jwt(2, 'not-the-nonce-1'), checkId: 'chk1', batch: 2, nonce: 'not-the-nonce-1', counters });
    expect(wrongNonce.status).toBe(403);
  });

  it('records the state change before the event is sent', async () => {
    const seen: string[] = [];
    const route = new CompletionRoute({
      jwtSecret: JWT_SECRET,
      now: () => NOW,
      emit: async () => {
        seen.push(route.stateOf('chk1', 2) ?? 'missing');
      },
    });
    route.openBatch({ checkId: 'chk1', batch: 2, nonce: 'nonce-two-aaaa' });
    const jwt = signJwt({ check_id: 'chk1', batch: 2, nonce: 'nonce-two-aaaa', role: 'crawl_worker', exp: NOW / 1000 + 60 }, JWT_SECRET);
    await route.handle({ jwt, checkId: 'chk1', batch: 2, nonce: 'nonce-two-aaaa', counters });
    expect(seen).toEqual(['done']);
  });
});
