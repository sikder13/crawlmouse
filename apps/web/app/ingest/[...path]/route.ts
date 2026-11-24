import { proxyIngest } from '../../../lib/analytics/ingest-proxy';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => proxyIngest(req);
export const POST = (req: Request) => proxyIngest(req);
