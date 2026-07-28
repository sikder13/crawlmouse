import type { WhatAiSeesPage } from '@crawlmouse/types';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { pageClassMeta } from './ai-view-logic';

const EMPTY_EXCERPT = '(An AI crawler sees no readable text on this page.)';

// PRO — the whole-site simulator: every page's static, non-rendered read. Server-populated only for the
// entitled owner (`whatAiSees` is null for everyone else, so the controller never mounts this). Every url,
// title and excerpt is crawled attacker-controlled text (A14/§12): JSX text children only (React escapes),
// the url rendered as TEXT never an href, no dangerouslySetInnerHTML.
export function WhatAiSeesSimulator({ pages, totalPages }: { pages: WhatAiSeesPage[]; totalPages: number }) {
  // The list is CAPPED (WHAT_AI_SEES_MAX_PAGES), worst-first. Saying "your whole site" over a capped
  // subset would be false, so the count is stated whenever anything was left out. `totalPages` is the
  // honest pre-cap figure from the projection; without rendering it this component would silently
  // imply a 2000-page site is 100 pages.
  const shown = pages.length;
  const capped = totalPages > shown;
  return (
    <Card variant="raised">
      <div className="text-overline uppercase text-ink-muted">What AI sees across your site</div>
      <p className="mt-2 text-body text-ink-muted">
        {capped ? (
          <>
            This is what a non-rendering AI crawler sees — the static HTML only, with no JavaScript run.
            Showing the {shown.toLocaleString()} pages least readable to AI, of{' '}
            {totalPages.toLocaleString()} crawled.
          </>
        ) : (
          <>
            This is what a non-rendering AI crawler sees across your whole site — the static HTML only, with
            no JavaScript run.
          </>
        )}
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
