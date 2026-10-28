import { Button } from '../../../../components/v2';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';
import styles from '../_preview/PreviewFrame.module.css';

export default function ButtonPreview() {
  return (
    <PreviewFrame title="Button">
      <PreviewSection title="Primary: the one orange element on a screen">
        <PreviewRow>
          <Button variant="primary">Open the fix</Button>
        </PreviewRow>
      </PreviewSection>
      <PreviewSection title="Default and quiet">
        <PreviewRow>
          <Button>Create a free account</Button>
          <Button variant="quiet">Log in</Button>
          <Button size="sm">Open</Button>
          <Button variant="quiet" size="sm">
            Re-run, free
          </Button>
          <Button size="lg">Start the audit</Button>
        </PreviewRow>
      </PreviewSection>
      <PreviewSection title="Links and disabled">
        <PreviewRow>
          <Button href="#">What Pro includes</Button>
          <Button disabled>Keep it</Button>
          <Button href="#" disabled>
            See with Pro
          </Button>
        </PreviewRow>
      </PreviewSection>
      <PreviewSection title="Inverse, on the keep bar">
        <div className={styles.bar}>
          <PreviewRow>
            <Button variant="inverse">Keep it</Button>
          </PreviewRow>
        </div>
      </PreviewSection>
      <PreviewSection title="Presentational, inside a link or an illustration">
        <PreviewRow>
          <Button presentational size="sm">
            Open the diff
          </Button>
        </PreviewRow>
      </PreviewSection>
    </PreviewFrame>
  );
}
