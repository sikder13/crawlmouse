import { parentPort } from 'node:worker_threads';
import { readPage, readWords } from './read.js';
import type { ReadMessage, ReadReply, ReadyMessage } from './thread-reader.js';

/**
 * The reader thread's entry, bundled as dist/reader.mjs. It answers each message in turn. The body
 * arrives as UTF-8 bytes in a transferred ArrayBuffer, so the main thread keeps no copy of it. A read
 * that throws is answered with the error's message, and the thread goes on to the next.
 */

const port = parentPort!;
const decoder = new TextDecoder();

port.on('message', (m: ReadMessage) => {
  let reply: ReadReply;
  try {
    const body = decoder.decode(new Uint8Array(m.body));
    reply =
      m.kind === 'words'
        ? { id: m.id, result: readWords({ body, bodyCut: m.bodyCut }) }
        : {
            id: m.id,
            result: readPage({
              body,
              bodyCut: m.bodyCut,
              finalUrl: m.finalUrl,
              stackHeaders: m.stackHeaders,
            }),
          };
  } catch (e) {
    reply = { id: m.id, error: e instanceof Error ? e.message : String(e) };
  }
  port.postMessage(reply);
});

// Loaded and listening: ThreadReader.start waits for this, so a missing or broken bundle fails startup.
port.postMessage({ ready: true } satisfies ReadyMessage);
