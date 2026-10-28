import { Card, StatusPill } from '../../../../components/v2';
import { PreviewFrame, PreviewSection } from '../_preview/PreviewFrame';
import styles from '../_preview/PreviewFrame.module.css';

export default function CardPreview() {
  return (
    <PreviewFrame title="Card">
      <PreviewSection title="Raised">
        <Card className={styles.cardBody}>
          <p className={styles.note}>158 product pages share this template.</p>
        </Card>
      </PreviewSection>
      <PreviewSection title="Sunken, for the one emphasised card">
        <Card tone="sunken" className={styles.cardBody}>
          <p className={styles.note}>If you fix one thing today</p>
        </Card>
      </PreviewSection>
      <PreviewSection title="A door into a section">
        <Card href="#" className={styles.cardBody}>
          <strong>Crawler access</strong> <StatusPill state="bad">2 of 6 blocked</StatusPill>
          <p className={styles.note}>6 crawlers × 214 pages · 1 fix open · 1 on Pro</p>
        </Card>
      </PreviewSection>
    </PreviewFrame>
  );
}
