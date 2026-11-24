import { parentPort } from 'node:worker_threads';
import { readMeasure } from './measure.js';
import { readPage, readWords } from './read.js';
import type { ReadMessage, ReadReply, ReadyMessage } from './thread-reader.js';

/**
 * The reader thread's entry, bundled as dist/reader.mjs. It answers each message in turn. The body
 * arrives as UTF-8 bytes in an ArrayBuffer made for that send and transferred here (thread-reader.ts). A read
 * that throws is answered with the error's message, and the thread goes on to the next.
 */

const port = parentPort!;
const decoder = new TextDecoder();

port.on('message', (m: ReadMessage) => {
  let reply: ReadReply;
  try {
    const bytes = new Uint8Array(m.body);
    if (m.kind === 'measure') {
      reply = { id: m.id, result: readMeasure(bytes) };
    } else {
      const body = decoder.decode(bytes);
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
    }
  } catch (e) {
    reply = { id: m.id, error: e instanceof Error ? e.message : String(e) };
  }
  port.postMessage(reply);
});

// Loaded and listening: ThreadReader.start waits for this, so a missing or broken bundle fails startup.
port.postMessage({ ready: true } satisfies ReadyMessage);
