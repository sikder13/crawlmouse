import { describe, it, expect, vi } from 'vitest';
import { wireAuditStream, type EventSourceLike } from './audit-stream-wiring';

// SPEC 04 §2 — the ADDITIVE `activity` SSE event. Existing consumers pass no handler and are
// untouched; a consumer that opts in receives each activity batch parsed. The handler is optional
// so the wiring contract (done/error semantics) is byte-compatible with every existing caller.

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
  return { es, dispatch, isClosed: () => closed, hasListener: (t: string) => listeners.has(t) };
}

describe('wireAuditStream — activity events (additive)', () => {
  it('routes activity batches to onActivity when the consumer opts in', () => {
    const onActivity = vi.fn();
    const { es, dispatch } = fakeEs();
    wireAuditStream(es, { onSnapshot: vi.fn(), onDone: vi.fn(), onTerminalError: vi.fn(), onActivity });
    const batch = [{ kind: 'fetch_ok', label: '/a', at: 't', seq: 1 }];
    dispatch('activity', JSON.stringify(batch));
    expect(onActivity).toHaveBeenCalledWith(batch);
  });

  it('keeps the legacy 3-handler call working with NO activity listener registered', () => {
    const { es, hasListener } = fakeEs();
    wireAuditStream(es, { onSnapshot: vi.fn(), onDone: vi.fn(), onTerminalError: vi.fn() });
    expect(hasListener('activity')).toBe(false); // additive: absent unless opted into
    expect(hasListener('done')).toBe(true);
  });
});
