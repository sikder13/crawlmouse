'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { siteUrl } from '@/lib/site-url';

export function EmbedSnippet({ domain }: { domain: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<iframe src="${siteUrl(`/embed/${encodeURIComponent(domain)}`)}" width="220" height="60" frameborder="0" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Crawlmouse grade"></iframe>`;
  return (
    <Card>
      <div className="font-display font-bold text-xl mb-2">Embed your grade</div>
      <p className="text-ink/70 text-sm mb-3">Paste this iframe into your site to show your grade.</p>
      <pre className="bg-ink text-cream font-mono text-xs p-3 rounded overflow-x-auto whitespace-pre">{snippet}</pre>
      <Button size="sm" className="mt-3" onClick={() => { navigator.clipboard.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); }}>{copied ? 'Copied!' : 'Copy snippet'}</Button>
    </Card>
  );
}
