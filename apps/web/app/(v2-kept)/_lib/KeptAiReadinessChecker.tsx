import {
  AiReadinessCheckerLd,
  AiReadinessCheckerMain,
} from '@/app/ai-readiness-checker/AiReadinessChecker';
import { AuditForm } from '@/components/v2/screens/home/AuditForm';
import { KeptShell } from './KeptShell';

/**
 * `/ai-readiness-checker` in the v2 shell: the page's own content, with v2's audit form, which
 * starts a v2 check (`POST /api/checks`), in place of v1's, whose route answers 410 once the
 * cutover is on (questions.md Q4).
 */
export function KeptAiReadinessChecker() {
  return (
    <KeptShell>
      <AiReadinessCheckerLd />
      <AiReadinessCheckerMain
        form={<AuditForm fieldId="url" label="Start an audit" primary start />}
      />
    </KeptShell>
  );
}
