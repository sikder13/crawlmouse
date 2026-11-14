import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AuditForm } from '@/components/v2/screens/home/AuditForm';
import { KeptAiReadinessChecker } from './KeptAiReadinessChecker';

/** Every element in `node`'s props tree (children and element-valued props), depth first. */
function elements(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap(elements) : [];
  const props = node.props as Record<string, unknown>;
  return [node, ...Object.values(props).flatMap((v) => elements(v as ReactNode))];
}

describe('/ai-readiness-checker in the v2 shell (questions.md Q4)', () => {
  it("draws v2's audit form, posting: without `start` it would only preview", () => {
    const forms = elements(KeptAiReadinessChecker()).filter((e) => e.type === AuditForm);
    expect(forms).toHaveLength(1);
    expect((forms[0]!.props as { start?: boolean }).start).toBe(true);
  });
});
