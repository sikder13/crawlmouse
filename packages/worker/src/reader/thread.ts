import { parentPort } from 'node:worker_threads';
import { readPage, readWords } from './read.js';
import type { ReadMessage, ReadReply, ReadyMessage } from './thread-reader.js';

/**
 * The reader thread's entry, bundled as dist/reader.mjs. It answers each message in turn. The body
 * arrives as UTF-8 bytes in a transferred ArrayBuffer, so the main thread keeps no copy of it.
 */

const port = parentPort!;
const decoder = new TextDecoder();

port.on('message', (m: ReadMessage) => {
  const body = decoder.decode(new Uint8Array(m.body));
  const reply: ReadReply =
    m.kind === 'words'
      ? { id: m.id, result: readWords({ body, bodyCut: m.bodyCut }) }
      : { id: m.id, result: readPage({ body, bodyCut: m.bodyCut, finalUrl: m.finalUrl }) };
  port.postMessage(reply);
});

// Loaded and listening: ThreadReader.start waits for this, so a missing or broken bundle fails startup.
port.postMessage({ ready: true } satisfies ReadyMessage);
