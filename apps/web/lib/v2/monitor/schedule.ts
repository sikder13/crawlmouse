/**
 * The scheduler's ports (CC-28 D4; inngest/schedule.ts runs them): the claim and the release over
 * migration 20261113000001's section B, the request through the pipeline's `requestCheck`, and the
 * Sentry report of a released claim. Production's go through the service-role client.
 */
import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import { z } from 'zod';
import { inngest } from '../../../../../inngest/client';
import {
  createScheduleTickFn,
  type Claim,
  type ScheduleDeps,
} from '../../../../../inngest/schedule';
import { isCrawlPaused } from '../../crawl-pause';
import { globalSlot } from '../account/sites-store';
import { requestCheck, type RequestDeps } from '../pipeline/request';
import { supabasePipelineStore, type PipelineStore } from '../pipeline/store';

type Env = Readonly<Record<string, string | undefined>>;

export interface SchedulePorts {
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  pipeline: Pick<PipelineStore, 'requestSite' | 'insertQueued'>;
  send: RequestDeps['send'];
  /** Milliseconds since the epoch. */
  now(): number;
  newId(): string;
  /** A Sentry message with ids only. */
  capture(message: string, extra: Record<string, string>): void;
  env: Env;
}

const instant = z.string().refine((s) => !Number.isNaN(Date.parse(s)));
const Claimed = z.array(z.object({ site_id: z.uuid(), slot: instant, next_at: instant }));

const Released = z.strictObject({ restored: z.boolean(), slot_released: z.boolean() });

const iso = (s: string): string => new Date(s).toISOString();

export function scheduleDeps(p: SchedulePorts): ScheduleDeps {
  return {
    paused: () => isCrawlPaused(p.env),

    // The slot is the one add_site and request_capped_check take (sites-store.ts globalSlot), so a
    // scheduled start counts into the same global:audits:day row as every other start.
    async claim(limit): Promise<Claim> {
      const nowMs = p.now();
      const slot = globalSlot(nowMs);
      const rows = Claimed.parse(
        await p.rpc('claim_due_sites', {
          p_now: new Date(nowMs).toISOString(),
          p_limit: limit,
          p_global: slot,
        }),
      );
      return {
        global: { bucket: slot.bucket, window_start: slot.window_start },
        sites: rows.map((r) => ({ siteId: r.site_id, slot: iso(r.slot), next: iso(r.next_at) })),
      };
    },

    // The claim has already moved next_check_at on, so the site row is read for its host and
    // account and answered with the slot it was claimed at: the key is the slot's on every retry.
    request: (site) =>
      requestCheck(
        {
          store: {
            requestSite: async (id) => ({
              ...(await p.pipeline.requestSite(id)),
              next_check_at: site.slot,
            }),
            insertQueued: (row) => p.pipeline.insertQueued(row),
          },
          send: p.send,
          now: p.now,
          newId: p.newId,
        },
        { siteId: site.siteId, trigger: 'scheduled' },
      ),

    async release(site, global) {
      return Released.parse(
        await p.rpc('release_scheduled_claim', {
          p_site: site.siteId,
          p_slot: site.slot,
          p_claimed_next: site.next,
          p_global: global,
          p_now: new Date(p.now()).toISOString(),
        }),
      );
    },

    report: (site) =>
      p.capture('schedule.claim_released', { siteId: site.siteId, slot: site.slot }),
  };
}

/** The ports over the service-role client, Inngest and Sentry, built when a step asks for them. */
export function serviceSchedulePorts(env: Env): SchedulePorts {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });
  return {
    async rpc(fn, args) {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw new Error(`${fn} failed: ${error.message}`);
      return data;
    },
    pipeline: supabasePipelineStore(sb),
    send: (event) => inngest.send(event),
    now: Date.now,
    newId: randomUUID,
    capture: (message, extra) =>
      Sentry.captureMessage(message, {
        level: 'error',
        tags: { signal: 'schedule-claim-released' },
        extra,
      }),
    env,
  };
}

/** The scheduler's function, registered by inngestFunctions with V2_PIPELINE=1 and V2_CHECKS_PUBLIC=1. */
export function scheduleFunctions(env: Env): InngestFunction.Like[] {
  return [createScheduleTickFn(() => scheduleDeps(serviceSchedulePorts(env)))];
}
