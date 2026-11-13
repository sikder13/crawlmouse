import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import type { RecipientLinkPageView } from '../../../../lib/v2/agency/schedules-link-view';
import { AcceptForm } from '../invite/AcceptForm';
import styles from './RecipientLinkScreen.module.css';

/**
 * Where a client report's confirmation link and pause link land: what the button will do, and the
 * one button. Once pressed, or for a link that cannot be used, it says so and offers nothing. Built
 * from the design system's pieces: no locked artboard draws this page.
 */
export function RecipientLinkScreen({ data }: { data: RecipientLinkPageView }) {
  return (
    <PageShell>
      <Card as="section" className={styles.card}>
        <Heading level={1} size="m">
          {data.title}
        </Heading>
        {data.lines.map((line) => (
          <p key={line} className={styles.line} role={data.state === 'done' ? 'status' : undefined}>
            {line}
          </p>
        ))}
        {data.act ? <AcceptForm action={data.act.action} label={data.act.label} /> : null}
      </Card>
    </PageShell>
  );
}
