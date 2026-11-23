import { signRead, SIGNATURE_HEADER, TS_HEADER } from './auth/hmac.js';

/**
 * The worker's one call to the app: "this batch has ended", so a run waiting on it can read it now
 * rather than at its next poll (PR 5a). It is a hint. The result is still read from the worker, and a
 * signal that never arrives costs the run one wait's timeout, never a check.
 *
 * The address comes from the worker's own setting (APP_SIGNAL_URL), never from a batch. The body holds
 * ids and a batch number only. It is sent when the batch ends and once more SIGNAL_REPEAT_MS later,
 * because a wait hears only events sent after it starts listening.
 */

export const SIGNAL_REQUEST_MS = 3_000;
export const SIGNAL_REPEAT_MS = 5_000;

export interface BatchEnded {
  check_id: string;
  batch: number;
  status: 'done' | 'failed';
}

export type SignalPost = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<unknown>;

/** Its own context, so a signature here is not one for a batch post or a read. */
export const signSignal = (secret: string, ts: string, raw: string): string =>
  signRead(secret, ts, `signal:${raw}`);

export interface DoneSignalDeps {
  url: string;
  secret: string;
  now(): number;
  post?: SignalPost;
  log(e: Record<string, string | number>): void;
}

export function createDoneSignal(deps: DoneSignalDeps): (ended: BatchEnded) => void {
  const post: SignalPost = deps.post ?? ((url, init) => fetch(url, init));
  const once = async (ended: BatchEnded): Promise<void> => {
    const raw = JSON.stringify(ended);
    const ts = String(deps.now());
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), SIGNAL_REQUEST_MS);
    timer.unref?.();
    try {
      await post(deps.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [TS_HEADER]: ts,
          [SIGNATURE_HEADER]: signSignal(deps.secret, ts, raw),
        },
        body: raw,
        signal: deadline.signal,
      });
    } catch {
      // Never the error's text: it can hold the address.
      deps.log({ event: 'signal_failed', check_id: ended.check_id, batch: ended.batch });
    } finally {
      clearTimeout(timer);
    }
  };
  return (ended) => {
    void once(ended);
    // Unref'd, so a pending repeat holds neither a shutdown nor `idle()`.
    setTimeout(() => void once(ended), SIGNAL_REPEAT_MS).unref?.();
  };
}
