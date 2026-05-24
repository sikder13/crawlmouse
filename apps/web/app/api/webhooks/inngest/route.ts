import { serve } from 'inngest/next';
import { inngest as workerInngest } from '@crawlmouse/inngest';
import { auditFn } from '@crawlmouse/inngest/audit';

export const { GET, POST, PUT } = serve({
  client: workerInngest,
  functions: [auditFn],
});
