import type { ReactNode } from 'react';
import { Heading, PageShell } from '../../../../components/v2';
import styles from './PreviewFrame.module.css';

/** The frame every primitive preview sits in: one heading, then labelled sections. */
export function PreviewFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PageShell header="app" footer={false}>
      <main className={styles.main}>
        <Heading level={1} size="m">
          {title}
        </Heading>
        {children}
      </main>
    </PageShell>
  );
}

export function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <Heading level={2} size="s">
        {title}
      </Heading>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** Items laid out in a wrapping row. */
export function PreviewRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}
