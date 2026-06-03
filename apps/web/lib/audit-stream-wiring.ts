// The audit SSE event wiring, extracted from the component/hook so its riskiest semantics — the
// terminal `done` and the named-`error`-vs-native-transport-error distinction — are unit-testable
// without a DOM/EventSource. Shared by AuditView and useAuditStream so the two consumers can never
// drift apart.

/** The slice of EventSource this wiring needs (so a fake can stand in under Vitest). */
export interface EventSourceLike {
  addEventListener(type: string, listener: (e: Event) => void): void;
  close(): void;
}

export interface AuditStreamHandlers {
  /** A snapshot/progress/done payload arrived — pass the parsed object up to the consumer. */
  onSnapshot(payload: unknown): void;
  /** The terminal `done` event landed (results are final). */
  onDone(): void;
  /** A NAMED stream `error` event (server-side result finalization failed) landed — terminal. */
  onTerminalError(): void;
}

/**
 * Register the audit-stream listeners on `es`:
 *  - `snapshot` / `progress` → onSnapshot(parsed)
 *  - `done` → onSnapshot(parsed), onDone(), then close (results are final)
 *  - `error` WITH data → a server-emitted terminal error: onTerminalError(), then close
 *  - `error` WITHOUT data → a native transport error: IGNORED so EventSource can reconnect to a
 *    still-running crawl (closing here would abort a recoverable connection)
 */
export function wireAuditStream(es: EventSourceLike, handlers: AuditStreamHandlers): void {
  const onData = (e: Event) => handlers.onSnapshot(JSON.parse((e as MessageEvent).data));
  es.addEventListener('snapshot', onData);
  es.addEventListener('progress', onData);
  es.addEventListener('done', (e) => {
    handlers.onSnapshot(JSON.parse((e as MessageEvent).data));
    handlers.onDone();
    es.close();
  });
  es.addEventListener('error', (e) => {
    if ((e as MessageEvent).data) {
      handlers.onTerminalError();
      es.close();
    }
  });
}
