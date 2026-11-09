/**
 * A check's evidence in the private `evidence` bucket (D7): batch results, seeds, the render outcome,
 * the built check and the map drawing, each as gzipped JSON at `evidencePath`. Steps write and read
 * them here so their outputs to Inngest stay small.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EVIDENCE_BUCKET, type EvidenceStore } from './types';

export const gzipJson = (value: unknown): Uint8Array =>
  gzipSync(Buffer.from(JSON.stringify(value), 'utf8'));

export const gunzipJson = (gzipped: Uint8Array): unknown =>
  JSON.parse(gunzipSync(gzipped).toString('utf8'));

export async function putJson(store: EvidenceStore, path: string, value: unknown): Promise<void> {
  await store.put(path, gzipJson(value));
}

export async function getJson(store: EvidenceStore, path: string): Promise<unknown> {
  return gunzipJson(await store.get(path));
}

/** The bucket through the service-role client. A put replaces an object at the same path. */
export function supabaseEvidenceStore(sb: SupabaseClient): EvidenceStore {
  const bucket = () => sb.storage.from(EVIDENCE_BUCKET);
  return {
    async put(path, gzipped) {
      const { error } = await bucket().upload(path, gzipped, {
        upsert: true,
        contentType: 'application/gzip',
      });
      if (error) throw new Error(`evidence: put ${path}: ${error.message}`);
    },
    async get(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) throw new Error(`evidence: get ${path}: ${error?.message ?? 'no data'}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket().remove([...paths]);
      if (error) throw new Error(`evidence: remove: ${error.message}`);
    },
  };
}
