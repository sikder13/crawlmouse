import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from './server';

export const appRouter = router({
  audits: router({
    getById: publicProcedure
      .input(z.object({ auditId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { data, error } = await ctx.sb.from('audits').select('*').eq('id', input.auditId).maybeSingle();
        if (error) throw error;
        return data;
      }),
    listMine: protectedProcedure.query(async ({ ctx }) => {
      const { data, error } = await ctx.sb
        .from('audits')
        .select('id, url, grade, score, status, started_at, completed_at')
        .order('started_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    }),
  }),
});

export type AppRouter = typeof appRouter;
