/**
 * The AI readability grade from its four components: given only when every component has a score,
 * as their sum on the engine's letter scale; otherwise withheld, naming each component that has none.
 */
import type { AiReadability, GradeLetter, WithheldReason } from '@crawlmouse/types/v2';
import { scoreToLetter } from '../../grade.js';
import type { AccessMeasure } from './access.js';
import { round, type Measure } from './numbers.js';
import { AI_WEIGHTS } from './weights.js';

export interface AiComponents {
  access: AccessMeasure;
  readable: Measure;
  quotable: Measure;
  signals: Measure;
}

export function aiReadability(c: AiComponents): AiReadability {
  const component = <M extends number, H extends boolean>(m: Measure, max: M, heuristic: H) => ({
    score: m.score,
    max,
    heuristic,
    range: m.range,
  });
  const reasons: WithheldReason[] = [
    ...(c.access.reason ? [c.access.reason] : []),
    ...(c.readable.score === null ? (['readable_unmeasured'] as const) : []),
    ...(c.quotable.score === null ? (['quotable_unmeasured'] as const) : []),
    ...(c.signals.score === null ? (['signals_unmeasured'] as const) : []),
  ];
  const components = {
    access: component(c.access, AI_WEIGHTS.access, false),
    readable: component(c.readable, AI_WEIGHTS.readable, false),
    quotable: component(c.quotable, AI_WEIGHTS.quotable, true),
    signals: component(c.signals, AI_WEIGHTS.signals, false),
  };
  if (reasons.length > 0) {
    return {
      withheld: true,
      withheld_reasons: reasons,
      total: null,
      grade: null,
      components,
      access_range: c.access.range,
    };
  }
  const total = round(c.access.score! + c.readable.score! + c.quotable.score! + c.signals.score!);
  return {
    withheld: false,
    withheld_reasons: [],
    total,
    grade: scoreToLetter(total) as GradeLetter,
    components: components as Extract<AiReadability, { withheld: false }>['components'],
    access_range: null,
  };
}
