import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabaseServer } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: audits } = await sb
    .from('audits')
    .select('id, url, grade, score, status, started_at, completed_at')
    .order('started_at', { ascending: false })
    .limit(50);

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 pt-12 pb-32">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display font-bold text-4xl tracking-tight">Your audits</h1>
          <Link href={{ pathname: '/' }}><Button>+ New audit</Button></Link>
        </div>

        {(!audits || audits.length === 0) ? (
          <Card className="text-center py-12">
            <p className="text-ink/70">No audits yet. <Link href={{ pathname: '/' }} className="text-peach underline">Run your first one.</Link></p>
          </Card>
        ) : (
          <div className="space-y-3">
            {audits.map((a) => (
              <Link key={a.id} href={{ pathname: `/audit/${a.id}` } as never}>
                <Card className="hover:border-peach transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm truncate">{a.url}</div>
                      <div className="text-xs text-ink/50 mt-1">{new Date(a.started_at).toLocaleString()}</div>
                    </div>
                    {a.status === 'completed' && a.grade ? (
                      <div className="flex items-center gap-3">
                        <Badge tone={(a.score ?? 0) >= 60 ? 'sage' : 'peach'}>{Number(a.score ?? 0).toFixed(0)}</Badge>
                        <span className="font-display font-bold text-3xl">{a.grade}</span>
                      </div>
                    ) : (
                      <Badge tone="oat">{a.status}</Badge>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
