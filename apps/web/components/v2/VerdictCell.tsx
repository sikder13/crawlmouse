import { StatusPill } from './StatusPill';
import { VisuallyHidden } from './VisuallyHidden';
import { EVIDENCE_CLASSES, VERDICTS, type EvidenceClass, type Verdict } from './verdicts';
import styles from './VerdictCell.module.css';

export interface VerdictCellProps {
  verdict: Verdict;
  evidence: EvidenceClass;
}

/** One crawler's verdict as a status pill, with how we know it: declared, simulated or observed. */
export function VerdictCell({ verdict, evidence }: VerdictCellProps) {
  if (!Object.hasOwn(VERDICTS, verdict)) throw new Error(`Unknown verdict: ${verdict}`);
  if (!Object.hasOwn(EVIDENCE_CLASSES, evidence)) {
    throw new Error(`Unknown evidence class: ${evidence}`);
  }
  const v = VERDICTS[verdict];
  return (
    <span className={styles.cell} data-v2-verdict={verdict}>
      <StatusPill state={v.state}>{v.label}</StatusPill>
      <span className={styles.evidence} data-v2-evidence={evidence}>
        <VisuallyHidden>Evidence: </VisuallyHidden>
        {evidence}
      </span>
    </span>
  );
}
