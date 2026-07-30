import type { WhatAiSeesPage } from '@crawlmouse/types';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { pageClassMeta } from './ai-view-logic';

// The honest empty-state when a page has no readable static text (e.g. a JavaScript-blind page).
const EMPTY_EXCERPT = '(An AI crawler sees no readable text on this page.)';

// FREE — the "wow": exactly what a non-rendering AI crawler reads on the homepage. The excerpt, title and
// url are attacker-controlled crawled text (A14/§12): rendered ONLY as JSX text children (React escapes),
// the url is never an href, and there is no dangerouslySetInnerHTML anywhere.
export function HomepageAiView({ view }: { view: WhatAiSeesPage }) {
  const meta = pageClassMeta(view.pageClass);
  const isEmpty = view.excerpt.trim().length === 0;
  return (
    <Card variant="raised">
      <div className="text-overline uppercase text-ink-muted">What AI sees on your homepage</div>
      <div className="mt-2">
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <p className="mt-2 text-body text-ink-muted">{meta.meaning}</p>
      <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-card bg-oat p-3 text-caption leading-relaxed text-ink">
        {isEmpty ? EMPTY_EXCERPT : view.excerpt}
      </pre>
      <p className="mt-2 font-mono text-caption text-ink-muted">
        {view.mainTextChars.toLocaleString()} characters of readable text.
      </p>
    </Card>
  );
}
