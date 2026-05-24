'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface Props {
  id: string;
  domain: string;
  method: 'dns_txt' | 'meta_tag';
  token: string;
  alreadyVerified: boolean;
}

export function VerifyClient({ id, domain, method, token, alreadyVerified }: Props) {
  const [verified, setVerified] = useState(alreadyVerified);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function check() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/verify/check/${id}`, { method: 'POST' });
      const data = await res.json();
      if (data.verified) {
        setVerified(true);
        setTimeout(() => router.refresh(), 1500);
      } else {
        setError(`We couldn't find the ${method === 'dns_txt' ? 'DNS TXT record' : 'meta tag'} yet. Double-check it's published and try again. DNS can take a few minutes to propagate.`);
      }
    } catch {
      setError('Network error');
    } finally {
      setChecking(false);
    }
  }

  if (verified) {
    return (
      <Card className="border-sage border-2">
        <Badge tone="sage">Verified</Badge>
        <p className="mt-3 text-ink/80">You own <strong>{domain}</strong>. You can now mint public report URLs for this domain.</p>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <h2 className="font-display font-bold text-xl mb-2">{method === 'dns_txt' ? 'DNS TXT record' : 'Meta tag'}</h2>
        {method === 'dns_txt' ? (
          <>
            <p className="text-ink/70 text-sm mb-3">Add this TXT record to your DNS:</p>
            <pre className="bg-ink text-cream font-mono text-sm p-4 rounded-lg overflow-x-auto">{`Type:  TXT
Host:  _crawlmouse.${domain}
Value: crawlmouse-verify=${token}`}</pre>
          </>
        ) : (
          <>
            <p className="text-ink/70 text-sm mb-3">Add this meta tag to your homepage&rsquo;s <code className="font-mono text-sm bg-oat px-1 py-0.5 rounded">&lt;head&gt;</code>:</p>
            <pre className="bg-ink text-cream font-mono text-sm p-4 rounded-lg overflow-x-auto">{`<meta name="crawlmouse-verification" content="${token}" />`}</pre>
          </>
        )}
      </Card>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={check} disabled={checking}>{checking ? 'Checking...' : 'Check now'}</Button>
        {error && <div className="text-warning text-sm">{error}</div>}
      </div>
    </>
  );
}
