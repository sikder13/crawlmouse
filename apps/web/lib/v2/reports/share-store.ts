/**
 * Share links over the database and the reports bucket (CC-31 D7), with the service-role client.
 * A route makes these only after it has established who is asking: the caller's own session for
 * making and revoking a link, the link's token for opening one.
 *
 * A token is hashed here (`hashShareToken`); the SQL functions take and compare the hash, and the
 * token itself is passed to nothing else.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { REPORTS_BUCKET } from './generate';
import { hashShareToken, type LinkAnswer, type ShareFiles, type ShareStore } from './share';

const CreateAnswerRow = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('created'), expires_at: z.string() }),
  z.strictObject({ outcome: z.enum(['not_found', 'not_ready']) }),
]);

const LinkAnswerRow = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('open'),
    report_id: z.uuid(),
    account_id: z.uuid(),
    site_id: z.uuid(),
    kind: z.enum([
      'audit_pdf',
      'compare',
      'raw_export',
      'public_link',
      'client_report',
      'prospect_one_pager',
    ]),
    format: z.enum(['pdf', 'csv', 'json', 'edge_list', 'html']),
    storage_path: z.string().min(1),
  }),
  z.strictObject({ outcome: z.enum(['gone', 'unknown']) }),
]);

async function call<T>(admin: SupabaseClient, fn: string, args: object, schema: z.ZodType<T>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return schema.parse(data);
}

async function link(
  admin: SupabaseClient,
  fn: 'open_share_link' | 'read_share_link',
  token: string,
  now: Date,
): Promise<LinkAnswer> {
  const a = await call(
    admin,
    fn,
    { p_token_hash: hashShareToken(token), p_now: now.toISOString() },
    LinkAnswerRow,
  );
  return a.outcome === 'open'
    ? {
        outcome: 'open',
        reportId: a.report_id,
        accountId: a.account_id,
        siteId: a.site_id,
        kind: a.kind,
        format: a.format,
        storagePath: a.storage_path,
      }
    : a;
}

export function supabaseShareStore(admin: SupabaseClient): ShareStore {
  return {
    async create(reportId, token, userId, now) {
      const a = await call(
        admin,
        'create_share_link',
        {
          p_report: reportId,
          p_token_hash: hashShareToken(token),
          p_user: userId,
          p_now: now.toISOString(),
        },
        CreateAnswerRow,
      );
      return a.outcome === 'created'
        ? { outcome: 'created', expiresAt: new Date(a.expires_at).toISOString() }
        : a;
    },
    open: (token, now) => link(admin, 'open_share_link', token, now),
    read: (token, now) => link(admin, 'read_share_link', token, now),
    async revoke(reportId, now) {
      const { error } = await admin.rpc('revoke_share_links', {
        p_report: reportId,
        p_now: now.toISOString(),
      });
      if (error) throw new Error(`revoke_share_links failed: ${error.message}`);
    },
  };
}

/** The private reports bucket, through the service-role client. */
export function supabaseShareFiles(admin: SupabaseClient): ShareFiles {
  const bucket = () => admin.storage.from(REPORTS_BUCKET);
  return {
    async signedUrl(path, seconds) {
      // A download, as the member's own is (generate-run.ts): the object is not opened in place.
      const { data, error } = await bucket().createSignedUrl(path, seconds, { download: true });
      if (error || !data) throw new Error(`reports: sign failed: ${error?.message ?? 'no data'}`);
      return data.signedUrl;
    },
    async read(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) throw new Error(`reports: read failed: ${error?.message ?? 'no data'}`);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
