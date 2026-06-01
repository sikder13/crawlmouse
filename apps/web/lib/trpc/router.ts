import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from './server';
import { asNumber } from '@/lib/numeric';
import { listMyAudits } from '@/lib/audits';

export const appRouter = router({
  audits: router({
    getById: publicProcedure
      .input(z.object({ auditId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        // Explicit columns (not select('*')) so internal fields (anonymous_session_id, settings,
        // failure_reason, CI metadata) aren't exposed via this public procedure.
        const { data, error } = await ctx.sb
          .from('audits')
          .select('id, url, status, grade, score, page_count, link_count, cms_detected, started_at, completed_at')
          .eq('id', input.auditId)
          .maybeSingle();
        // Don't leak raw PostgREST errors (schema/column names) to the client.
        if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'query_failed' });
        return data ? { ...data, score: asNumber(data.score) } : null;
      }),
    listMine: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await listMyAudits(ctx.sb);
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'query_failed' });
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
