import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_HEADER as WORKER_SIGNATURE_HEADER,
  TS_HEADER as WORKER_TS_HEADER,
  verifyBatchSignature,
  verifyReadSignature,
} from '../../../../packages/worker/src/auth/hmac';
import { SIGNATURE_HEADER, TS_HEADER, signBody, signRead } from './sign';

const SECRET = 'planted-signing-secret-0123456789abcdef';
const TS = '1700000000000';
const NOW = 1_700_000_000_000;

describe('signRead', () => {
  it('is hex HMAC-SHA256 over `${ts}.${purpose}` (known answer from openssl)', () => {
    // printf '%s' '1700000000000.batch:00000000-0000-4000-8000-0000000000c9:3' | openssl dgst -sha256 -hmac '<SECRET>'
    expect(signRead(SECRET, TS, 'batch:00000000-0000-4000-8000-0000000000c9:3')).toBe(
      '70607528dafc3d1f511446f175a6b8177725a940f94afdd06a08b0a4edd819a4',
    );
  });

  it("passes the worker's own check for both read purposes", () => {
    for (const purpose of ['metrics', 'batch:00000000-0000-4000-8000-0000000000c9:0']) {
      expect(
        verifyReadSignature(SECRET, TS, purpose, signRead(SECRET, TS, purpose), NOW),
      ).toBeNull();
    }
  });
});

describe('signBody', () => {
  const raw = '{"a":"café"}';

  it('is hex HMAC-SHA256 over `${ts}.` and the UTF-8 bytes (known answer from openssl)', () => {
    // printf '1700000000000.{"a":"caf\xc3\xa9"}' | openssl dgst -sha256 -hmac '<SECRET>'
    const expected = '5e93e98520cf959e049975e9f274f1f0269fe2d65faf5087787b8e4a24baf081';
    expect(signBody(SECRET, TS, raw)).toBe(expected);
    expect(signBody(SECRET, TS, Buffer.from(raw, 'utf8'))).toBe(expected);
    expect(signBody(SECRET, TS, new TextEncoder().encode(raw))).toBe(expected);
  });

  it("passes the worker's own check on the bytes it receives, and fails it on any other bytes", () => {
    const bytes = Buffer.from(raw, 'utf8');
    const signature = signBody(SECRET, TS, bytes);
    expect(verifyBatchSignature(SECRET, TS, bytes, signature, NOW)).toBeNull();
    expect(verifyBatchSignature(SECRET, TS, Buffer.from('{"a":"cafe"}'), signature, NOW)).toBe(
      'bad_signature',
    );
  });
});

describe('headers', () => {
  it("are the worker's header names", () => {
    expect(TS_HEADER).toBe(WORKER_TS_HEADER);
    expect(SIGNATURE_HEADER).toBe(WORKER_SIGNATURE_HEADER);
  });
});
