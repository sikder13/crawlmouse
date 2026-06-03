import { describe, it, expect, vi } from 'vitest';
import { wireAuditStream, type EventSourceLike } from './audit-stream-wiring';

// A fake EventSource: records the listeners wireAuditStream registers so a test can dispatch
// synthetic named events (with or without `.data`) and assert the terminal/data semantics —
// no DOM, no real network, just the wiring contract.
function fakeEs() {
  const listeners = new Map<string, (e: Event) => void>();
  let closed = false;
  const es: EventSourceLike = {
    addEventListener: (type, fn) => listeners.set(type, fn as (e: Event) => void),
    close: () => { closed = true; },
  };
  const dispatch = (type: string, data?: string) => {
    const fn = listeners.get(type);
    if (!fn) throw new Error(`no listener for "${type}"`);
    fn({ data } as unknown as Event);
  };
  return { es, dispatch, isClosed: () => closed };
}

describe('wireAuditStream', () => {
  it('routes snapshot + progress events through onSnapshot with the parsed payload', () => {
    const onSnapshot = vi.fn();
    const { es, dispatch } = fakeEs();
    wireAuditStream(es, { onSnapshot, onDone: vi.fn(), onTerminalError: vi.fn() });

    dispatch('snapshot', JSON.stringify({ id: 'a', status: 'pending' }));
    dispatch('progress', JSON.stringify({ id: 'a', status: 'crawling' }));

    expect(onSnapshot).toHaveBeenNthCalledWith(1, { id: 'a', status: 'pending' });
    expect(onSnapshot).toHaveBeenNthCalledWith(2, { id: 'a', status: 'crawling' });
  });

  it('on `done`: delivers the final snapshot, fires onDone, and CLOSES the stream', () => {
    const onSnapshot = vi.fn();
    const onDone = vi.fn();
    const { es, dispatch, isClosed } = fakeEs();
    wireAuditStream(es, { onSnapshot, onDone, onTerminalError: vi.fn() });

    dispatch('done', JSON.stringify({ id: 'a', status: 'completed', grade: 'A', score: 92, orphanCount: 3, avgDepth: 2.1 }));

    expect(onSnapshot).toHaveBeenCalledWith({ id: 'a', status: 'completed', grade: 'A', score: 92, orphanCount: 3, avgDepth: 2.1 });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(isClosed()).toBe(true);
  });

  it('on a NAMED `error` event WITH data: terminal — fires onTerminalError and closes', () => {
    const onTerminalError = vi.fn();
    const { es, dispatch, isClosed } = fakeEs();
    wireAuditStream(es, { onSnapshot: vi.fn(), onDone: vi.fn(), onTerminalError });

    dispatch('error', JSON.stringify({ message: 'Could not load results.' }));

    expect(onTerminalError).toHaveBeenCalledTimes(1);
    expect(isClosed()).toBe(true);
  });

  it('on a NATIVE transport `error` (NO data): NOT terminal — does not close, lets EventSource reconnect', () => {
    const onTerminalError = vi.fn();
    const onDone = vi.fn();
    const { es, dispatch, isClosed } = fakeEs();
    wireAuditStream(es, { onSnapshot: vi.fn(), onDone, onTerminalError });

    dispatch('error', undefined); // native error carries no data

    expect(onTerminalError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(isClosed()).toBe(false); // stream stays open for reconnection
  });
});
