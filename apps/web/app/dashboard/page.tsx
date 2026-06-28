import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { buttonClasses } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LocalTime } from '@/components/ui/LocalTime';
import { PlanStatusCard } from '@/components/billing/PlanStatusCard';
import { ActivatingPro } from '@/components/billing/ActivatingPro';
import { supabaseServer } from '@/lib/supabase/server';
import { listMyAudits } from '@/lib/audits';
import { isProActive } from '@/lib/pro';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ upgraded?: string }> }) {
  const { upgraded } = await searchParams;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const [audits, { data: planRow }] = await Promise.all([
    listMyAudits(sb),
    sb.from('users').select('pro_until').eq('id', user.id).maybeSingle(),
  ]);
  const proUntil = planRow?.pro_until ?? null;
  // Just paid but the entitlement webhook hasn't landed yet → show an activating state that
  // polls, instead of flashing the "Free" card to someone who just upgraded.
  const activating = upgraded === '1' && !isProActive(proUntil);

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 pt-12 pb-32">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display font-bold text-4xl tracking-tight">Your audits</h1>
          <Link href={{ pathname: '/' }} className={buttonClasses()}>+ New audit</Link>
        </div>

        <div className="mb-8">
          {activating ? <ActivatingPro /> : <PlanStatusCard proUntil={proUntil} />}
        </div>

        {(!audits || audits.length === 0) ? (
          <Card className="text-center py-12">
            <p className="text-ink/70">No audits yet. <Link href={{ pathname: '/' }} className="text-peach underline">Run your first one.</Link></p>
          </Card>
        ) : (
          <div className="space-y-3">
            {audits.map((a) => (
              <Link key={a.id} href={`/audit/${a.id}`}>
                <Card className="hover:border-peach transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm truncate">{a.url}</div>
                      <div className="text-xs text-ink/50 mt-1"><LocalTime iso={a.started_at} /></div>
                    </div>
                    {a.status === 'completed' && a.grade ? (
                      <div className="flex items-center gap-3">
                        <Badge tone={(a.score ?? 0) >= 60 ? 'sage' : 'peach'}>{(a.score ?? 0).toFixed(0)}</Badge>
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
