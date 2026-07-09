import { describe, it, expect } from 'vitest';
import type { AiReadinessScore, AiBotAccess } from '@crawlmouse/types';
import { bandMeta, pageClassMeta, evidenceLabel, componentBars, blockedRetrievalBots } from './ai-view-logic';

describe('ai-view-logic', () => {
  it('maps each band to a label + tone (no ranking claim)', () => {
    expect(bandMeta('ready')).toEqual({ label: 'AI-ready', tone: 'success' });
    expect(bandMeta('partial').tone).toBe('info');
    expect(bandMeta('at_risk').tone).toBe('warning');
    for (const b of ['ready', 'partial', 'at_risk'] as const) {
      expect(bandMeta(b).label.toLowerCase()).not.toMatch(/rank|cited|guaranteed/);
    }
  });

  it('maps each page class to label + tone + honest meaning', () => {
    expect(pageClassMeta('readable').tone).toBe('success');
    expect(pageClassMeta('js_blind').label).toBe('JavaScript-blind');
    expect(pageClassMeta('js_blind').meaning.toLowerCase()).toContain('javascript');
    expect(pageClassMeta('thin').tone).toBe('neutral');
  });

  it('labels evidence honestly', () => {
    expect(evidenceLabel('strong')).toBe('Strong evidence');
    expect(evidenceLabel('contested')).toContain('Contested');
  });

  it('renders the four LOCKED-weight component bars with percentages rounded at the boundary', () => {
    const score = {
      components: {
        access: { score: 1, weight: 25 },
        contentWithoutJs: { score: 0.5, weight: 40 },
        machineLegibility: { score: 0.666, weight: 20 },
        retrievalPath: { score: 0.5, weight: 15 },
      },
    } as AiReadinessScore;
    const bars = componentBars(score);
    expect(bars.map((b) => [b.key, b.pct, b.weight])).toEqual([
      ['access', 100, 25],
      ['content', 50, 40],
      ['legibility', 67, 20], // 0.666 -> 67
      ['retrieval', 50, 15],
    ]);
  });

  it('selects only retrieval-class bots that cannot reach the whole site', () => {
    const bots: AiBotAccess[] = [
      { token: 'PerplexityBot', operator: 'Perplexity', botClass: 'retrieval', allowedPageRatio: 0.5, fullyBlocked: false, note: 'x' },
      { token: 'OAI-SearchBot', operator: 'OpenAI', botClass: 'retrieval', allowedPageRatio: 1, fullyBlocked: false, note: 'x' },
      { token: 'GPTBot', operator: 'OpenAI', botClass: 'training', allowedPageRatio: 0, fullyBlocked: true, note: 'x' },
    ];
    expect(blockedRetrievalBots(bots).map((b) => b.token)).toEqual(['PerplexityBot']);
  });
});
