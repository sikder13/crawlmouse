import { Card, Grade } from '../../../../components/v2';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';
import styles from '../_preview/PreviewFrame.module.css';
import { previewOnly } from '../_preview/guard';

export default function GradePreview() {
  previewOnly();
  return (
    <PreviewFrame title="Grade">
      <PreviewSection title="Letter and score">
        <PreviewRow>
          <Card className={styles.cardBody}>
            <Grade label="Technical SEO" letter="B" score={79}>
              7 orphan pages. Three fixes take it to A-.
            </Grade>
          </Card>
          <Card className={styles.cardBody}>
            <Grade label="AI visibility" letter="D" score={41} tone="bad" size="lg">
              Two AI crawlers never get past Cloudflare&apos;s bot defences.
            </Grade>
          </Card>
        </PreviewRow>
      </PreviewSection>
      <PreviewSection title="Withheld">
        <PreviewRow>
          <Card className={styles.cardBody}>
            <Grade label="AI visibility" withheld size="lg">
              Fewer than two scored crawlers were measured, so no grade is given.
            </Grade>
          </Card>
        </PreviewRow>
      </PreviewSection>
    </PreviewFrame>
  );
}
