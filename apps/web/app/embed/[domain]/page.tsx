import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function generateMetadata() {
  return { robots: { index: false, follow: false } };
}

export default async function EmbedPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const sb = supabaseAdmin();

  // Find most recent completed public report for this domain
  const { data: report } = await sb
    .from('public_reports')
    .select('slug, audit_id, domain')
    .eq('domain', domain)
    .is('takedown_requested_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report) {
    return (
      <div style={{ fontFamily: 'system-ui', padding: 16, color: '#1a1a18', background: '#fdfaf5' }}>
        No public Crawlmouse report yet for <strong>{domain}</strong>. <a href={`https://crawlmouse.com/?url=${encodeURIComponent('https://' + domain)}`} target="_blank" rel="noreferrer" style={{ color: '#ff7849' }}>Run one →</a>
      </div>
    );
  }

  const { data: audit } = await sb.from('audits').select('grade, score').eq('id', report.audit_id).maybeSingle();
  const grade = audit?.grade ?? '?';
  const score = audit?.score != null ? Number(audit.score).toFixed(0) : '—';
  const passing = audit?.score != null && Number(audit.score) >= 60;

  // Increment view count (fire-and-forget)
  void sb.from('embed_badges').update({ view_count: 1 }).eq('domain', domain).then();

  return (
    <html lang="en">
      <head>
        <style>{`*{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,sans-serif}body{background:transparent}`}</style>
      </head>
      <body>
        <a
          href={`https://crawlmouse.com/r/${report.slug}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: '#fdfaf5',
            border: '1px solid #e8e2d4',
            borderRadius: 12,
            textDecoration: 'none',
            color: '#1a1a18',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 28, color: passing ? '#7a9b7e' : '#ff7849', lineHeight: 1 }}>{grade}</span>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#5c5a52' }}>Crawlmouse</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Score {score} / 100</span>
          </span>
        </a>
      </body>
    </html>
  );
}
