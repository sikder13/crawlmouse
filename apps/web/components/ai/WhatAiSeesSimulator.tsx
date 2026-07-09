import type { WhatAiSeesPage } from '@crawlmouse/types';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { pageClassMeta } from './ai-view-logic';

const EMPTY_EXCERPT = '(An AI crawler sees no readable text on this page.)';

// PRO — the whole-site simulator: every page's static, non-rendered read. Server-populated only for the
// entitled owner (`whatAiSees` is null for everyone else, so the controller never mounts this). Every url,
// title and excerpt is crawled attacker-controlled text (A14/§12): JSX text children only (React escapes),
// the url rendered as TEXT never an href, no dangerouslySetInnerHTML.
export function WhatAiSeesSimulator({ pages }: { pages: WhatAiSeesPage[] }) {
  return (
    <Card variant="raised">
      <div className="text-overline uppercase text-ink-muted">What AI sees across your site</div>
      <p className="mt-2 text-body text-ink-muted">
        This is what a non-rendering AI crawler sees across your whole site — the static HTML only, with no
        JavaScript run.
      </p>
      <ul className="mt-4 space-y-4">
        {pages.map((p, i) => {
          const meta = pageClassMeta(p.pageClass);
          const isEmpty = p.excerpt.trim().length === 0;
          return (
            <li
              key={`${p.url}:${i}`}
              className="border-t border-oat pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <span className="font-mono text-caption text-ink-muted">
                  {p.mainTextChars.toLocaleString()} chars
                </span>
              </div>
              {p.title ? <p className="mt-1 text-body font-medium text-ink">{p.title}</p> : null}
              <p className="mt-1 break-words font-mono text-caption text-ink-muted">{p.url}</p>
              <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-card bg-oat p-3 text-caption leading-relaxed text-ink">
                {isEmpty ? EMPTY_EXCERPT : p.excerpt}
              </pre>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
