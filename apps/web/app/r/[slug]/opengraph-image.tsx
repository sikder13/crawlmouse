import { ImageResponse } from 'next/og';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Crawlmouse audit report';

export default async function Image({ params }: { params: { slug: string } }) {
  const sb = supabaseAdmin();
  const { data: report } = await sb
    .from('public_reports')
    .select('audit_id, domain')
    .eq('slug', params.slug)
    .maybeSingle();
  if (!report) {
    return new ImageResponse(<div style={{ fontSize: 48 }}>Crawlmouse</div>, size);
  }
  const { data: audit } = await sb
    .from('audits')
    .select('grade, score')
    .eq('id', report.audit_id)
    .maybeSingle();

  const grade = audit?.grade ?? '?';
  const score = audit?.score ? Number(audit.score).toFixed(0) : '—';
  const passing = audit?.score != null && Number(audit.score) >= 60;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#fdfaf5',
          display: 'flex',
          flexDirection: 'column',
          padding: 60,
          fontFamily: 'serif',
        }}
      >
        <div style={{ color: '#5c5a52', fontSize: 22, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>
          crawlmouse audit
        </div>
        <div style={{ color: '#1a1a18', fontSize: 36, fontWeight: 600, marginBottom: 40, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {report.domain}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 30 }}>
          <div style={{ fontSize: 280, fontWeight: 800, lineHeight: 1, color: passing ? '#7a9b7e' : '#ff7849' }}>{grade}</div>
          <div style={{ fontSize: 64, color: '#1a1a18', marginBottom: 30 }}>{score} / 100</div>
        </div>
        <div style={{ marginTop: 'auto', color: '#5c5a52', fontSize: 24 }}>
          crawlmouse.com
        </div>
      </div>
    ),
    size,
  );
}
