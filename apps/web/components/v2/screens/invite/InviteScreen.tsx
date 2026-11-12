import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import type { InviteView } from '../../../../lib/v2/view/seats';
import { AcceptForm } from './AcceptForm';
import styles from './InviteScreen.module.css';

/**
 * Where an invitation's link lands: what the invitation is, and its one action. A signed-in reader
 * accepts with a POST; a signed-out one is sent to sign in first; a link that cannot be used says so
 * and offers nothing. Built from the design system's pieces: no locked artboard draws this page.
 */
export function InviteScreen({ data }: { data: InviteView }) {
  return (
    <PageShell>
      <Card as="section" className={styles.card}>
        <Heading level={1} size="m">
          {data.title}
        </Heading>
        {data.notice ? (
          <p className={styles.notice} role="status">
            {data.notice}
          </p>
        ) : null}
        {data.lines.map((line) => (
          <p key={line} className={styles.line}>
            {line}
          </p>
        ))}
        {data.state === 'invite' && data.act.kind === 'accept' ? (
          <AcceptForm action={data.act.action} label={data.act.label} />
        ) : null}
        {data.state === 'invite' && data.act.kind === 'sign_in' ? (
          <>
            <div>
              <Button href={data.act.href} variant="primary">
                {data.act.label}
              </Button>
            </div>
            <p className={styles.note}>{data.act.note}</p>
          </>
        ) : null}
      </Card>
    </PageShell>
  );
}
