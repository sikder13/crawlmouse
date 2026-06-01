import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from './server';

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
        if (error) throw error;
        return data;
      }),
    listMine: protectedProcedure.query(async ({ ctx }) => {
      const { data, error } = await ctx.sb
        .from('audits')
        .select('id, url, grade, score, status, started_at, completed_at')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('started_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    }),
  }),
});

export type AppRouter = typeof appRouter;
