import { TrialCard } from '../../../../components/v2';
import { ActionControl } from '../../../../components/v2/screens/account/ActionControl';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';
import { shellPreview } from '../_preview/accounts';
import { previewOnly } from '../_preview/guard';

/** bad-site's trial card on day 0 and on day 9, as the rail shows it. */
export default function TrialCardPreview() {
  previewOnly();
  const cards = [
    { title: 'Day 0: the first run', trial: shellPreview('day0').trial! },
    { title: 'Day 9: after the first weekly check', trial: shellPreview('home').trial! },
  ];
  return (
    <PreviewFrame title="TrialCard">
      {cards.map(({ title, trial }) => (
        <PreviewSection key={title} title={title}>
          <PreviewRow>
            <div style={{ width: 200 }}>
              <TrialCard
                title={trial.title}
                left={trial.left}
                note={trial.note}
                aside={
                  trial.billing ? <a href={trial.billing.href}>{trial.billing.label}</a> : null
                }
              >
                {trial.keep ? <ActionControl action={trial.keep} size="md" /> : null}
              </TrialCard>
            </div>
          </PreviewRow>
        </PreviewSection>
      ))}
    </PreviewFrame>
  );
}
