'use client';

import { useEffect } from 'react';
import type { AiFinding, AiReadinessClient } from '@crawlmouse/types';
import { track } from '@/lib/analytics';
import { Card } from '../ui/Card';
import { Badge, type BadgeTone } from '../ui/Badge';
import { bandMeta, componentBars, evidenceLabel, blockedRetrievalBots } from './ai-view-logic';
import { HomepageAiView } from './HomepageAiView';
import { WhatAiSeesSimulator } from './WhatAiSeesSimulator';
import { AiPacketList } from './AiPacketList';
import { LlmsTxtGenerator } from './LlmsTxtGenerator';
import { TrackedDetails } from './TrackedDetails';

const SEVERITY_TONE: Record<AiFinding['severity'], BadgeTone> = { high: 'warning', medium: 'info', info: 'neutral' };

/**
 * SPEC 05 §9 — the sibling AI/agent-readiness section on the result page. FREE: score + band + four
 * LOCKED-weight component bars + the full findings ledger + the access matrix / §2 disclosures + llms.txt
 * status + the homepage "What AI Sees". PRO (the entitled owner): the whole-site simulator + AI fix packets
 * + the llms.txt generator. Gating is BY DATA PRESENCE — `whatAiSees`/`aiPackets` are server-populated only
 * for the entitled owner (Stage 4), so this renders the Pro artifacts iff they exist. It NEVER reads a
 * client entitlement flag. All crawled text (excerpt/title/plainLanguage/url/notes) renders as escaped JSX
 * text (A14/§12) — no dangerouslySetInnerHTML. Never a ranking/citation claim (A16).
 */
export function AiReadinessSection({ aiReadiness, auditId }: { aiReadiness: AiReadinessClient; auditId: string }) {
  const { score, homepageView, whatAiSees, aiPackets, hasMoreAiPackets } = aiReadiness;
  const band = bandMeta(score.band);
  const bars = componentBars(score);
  const blockedBots = blockedRetrievalBots(score.accessMatrix.bots);
  // The reliable server-set OWNER signal: whatAiSees is populated only for the entitled owner (Stage 4).
  const isEntitledOwner = whatAiSees != null;

  useEffect(() => {
    track('ai_score_revealed', { score: score.score, band: score.band, confidence: score.confidence });
  }, [score.score, score.band, score.confidence]);

  return (
    <section aria-labelledby="ai-readiness-heading" className="space-y-4">
      <Card variant="raised">
        <div className="text-overline uppercase text-ink-muted">AI &amp; agent readiness</div>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <span id="ai-readiness-heading" className="font-display text-h1 text-ink">{score.score}</span>
          <span className="text-body text-ink-muted">/ 100</span>
          <Badge tone={band.tone}>{band.label}</Badge>
        </div>
        <p className="mt-2 text-caption text-ink-muted">
          How well a non-rendering AI crawler (ChatGPT, Claude, Perplexity) can read and reach this site.
          {score.isEstimate ? ' This is an estimate — the crawl was partial or low-confidence.' : ''}
        </p>

        <ul className="mt-4 space-y-3">
          {bars.map((b) => (
            <li key={b.key}>
              <div className="flex items-center justify-between text-caption text-ink-muted">
                <span>{b.label}</span>
                <span className="font-mono">
                  {b.pct}% <span className="text-ink-muted">· weight {b.weight}</span>
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-oat">
                <div className="h-full rounded-full bg-accent-fill" style={{ width: `${b.pct}%` }} />
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-caption text-ink-muted">Crawler behavior verified as of {score.asOf}.</p>
      </Card>

      <Card variant="raised">
        <div className="text-overline uppercase text-ink-muted">Who can reach your content</div>
        {blockedBots.length > 0 ? (
          <ul className="mt-2 space-y-1 text-body text-ink">
            {blockedBots.map((b) => (
              <li key={b.token}>
                <span className="font-medium">
                  {b.operator} ({b.token})
                </span>
                : {b.note}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-body text-ink-muted">Search and citation AI crawlers can reach your pages.</p>
        )}
        {!score.accessMatrix.robotsTxtFound ? (
          <p className="mt-2 text-caption text-ink-muted">No robots.txt was found — all crawlers are allowed by default.</p>
        ) : null}
        {score.accessMatrix.wafDetected && score.accessMatrix.wafNote ? (
          <p className="mt-2 text-caption text-ink-muted">{score.accessMatrix.wafNote}</p>
        ) : null}
      </Card>

      <Card variant="raised">
        <div className="flex items-center justify-between gap-2">
          <div className="text-overline uppercase text-ink-muted">llms.txt</div>
          <Badge tone={score.llmsTxt.present ? 'success' : 'neutral'}>{score.llmsTxt.present ? 'Present' : 'Not found'}</Badge>
        </div>
        <p className="mt-2 text-caption text-ink-muted">{score.llmsTxt.note}</p>
      </Card>

      {score.findings.length > 0 ? (
        <Card variant="raised">
          <div className="text-overline uppercase text-ink-muted">What to fix for AI readiness</div>
          <ul className="mt-3 space-y-2">
            {score.findings.map((f) => (
              <li key={f.id}>
                <TrackedDetails
                  event="ai_finding_expanded"
                  props={{ kind: f.kind }}
                  summary={
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                      <span className="text-body text-ink">{f.targetTitle ?? f.targetUrl ?? 'Site-wide'}</span>
                    </span>
                  }
                >
                  <p className="mt-2 text-body text-ink">{f.plainLanguage}</p>
                  {f.targetUrl ? <p className="mt-1 break-words font-mono text-caption text-ink-muted">{f.targetUrl}</p> : null}
                  <p className="mt-1 text-caption text-ink-muted">{evidenceLabel(f.evidence)}</p>
                </TrackedDetails>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {homepageView ? (
        <TrackedDetails
          event="ai_homepage_view_opened"
          summary={<span className="text-overline uppercase text-ink-muted">See what AI reads on your homepage</span>}
        >
          <div className="mt-3">
            <HomepageAiView view={homepageView} />
          </div>
        </TrackedDetails>
      ) : null}

      {isEntitledOwner ? (
        <div className="space-y-4">
          <TrackedDetails
            event="ai_whataisees_opened"
            summary={<span className="text-overline uppercase text-ink-muted">See what AI reads across your whole site</span>}
          >
            <div className="mt-3">
              <WhatAiSeesSimulator pages={whatAiSees} />
            </div>
          </TrackedDetails>
          {aiPackets && aiPackets.length > 0 ? <AiPacketList packets={aiPackets} /> : null}
          <Card variant="raised">
            <div className="text-overline uppercase text-ink-muted">Generate your llms.txt</div>
            <div className="mt-2">
              <LlmsTxtGenerator auditId={auditId} />
            </div>
          </Card>
        </div>
      ) : hasMoreAiPackets ? (
        <Card variant="raised">
          <div className="text-overline uppercase text-ink-muted">Unlock with Pro</div>
          <p className="mt-2 text-body text-ink-muted">
            Pro adds the whole-site &ldquo;What AI Sees&rdquo; simulator, copy-paste AI fix packets, and the
            llms.txt generator for this site.
          </p>
        </Card>
      ) : null}
    </section>
  );
}
