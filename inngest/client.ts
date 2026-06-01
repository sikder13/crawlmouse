import { Inngest, EventSchemas } from 'inngest';

type Events = {
  'audit.requested': {
    data: {
      auditId: string;
      url: string;
      pageCap?: number;
      perHostConcurrency?: number;
      basicAuth?: { username: string; password: string };
      extraHeaders?: Record<string, string>;
      commitSha?: string;
      environment?: string;
      branch?: string;
      deploymentId?: string;
    };
  };
  'audit.completed': { data: { auditId: string; grade: string; score: number } };
  'audit.failed': { data: { auditId: string; reason: string } };
};

export const inngest = new Inngest({
  id: 'crawlmouse',
  schemas: new EventSchemas().fromRecord<Events>(),
});
