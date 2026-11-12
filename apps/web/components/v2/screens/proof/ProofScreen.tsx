import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { Table } from '../../Table';
import layout from '../../layout.module.css';
import shell from '../../PageShell.module.css';
import type { ProofBlockView, ProofSideView, ProofView } from '../../../../lib/v2/view/proof';
import styles from './ProofScreen.module.css';

/**
 * The proof page (CC-31 D6b): a report's stored document, drawn for a client to read. Each string it
 * shows is one of the view's, in an element of its own, and it has no action: no button, no form
 * and no orange element. A before-and-after pair is two columns, one under the other on a phone.
 * Built from the design system's pieces: no locked artboard draws this page.
 */
export function ProofScreen({ data }: { data: ProofView }) {
  return (
    <div className={shell.shell} data-v2-shell="" data-v2-proof="">
      <main className={`${layout.wrap} ${styles.main}`}>
        <header className={styles.head}>
          <Heading level={1} size="l">
            {data.title}
          </Heading>
          {data.lines.map((line, i) => (
            <p key={i} className={styles.line}>
              {line}
            </p>
          ))}
        </header>
        {data.sections.map((section, i) => (
          <section key={i} className={styles.section}>
            {section.heading ? (
              <Heading level={2} size="s">
                {section.heading}
              </Heading>
            ) : null}
            {section.blocks.map((block, j) => (
              <Block key={j} block={block} />
            ))}
          </section>
        ))}
        {data.notMeasured ? (
          <Card as="section" tone="sunken" className={styles.card}>
            <Heading level={2} size="s">
              {data.notMeasured.title}
            </Heading>
            <ul className={styles.sentences}>
              {data.notMeasured.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </Card>
        ) : null}
      </main>
      <footer className={`${layout.wrap} ${styles.foot}`}>
        {data.footer.href ? (
          <a href={data.footer.href}>{data.footer.text}</a>
        ) : (
          <span>{data.footer.text}</span>
        )}
      </footer>
    </div>
  );
}

function Block({ block }: { block: ProofBlockView }) {
  switch (block.type) {
    case 'text':
      return <p className={styles.text}>{block.text}</p>;
    case 'facts':
      return (
        <Card className={styles.card}>
          <dl className={styles.facts}>
            {block.rows.map((row, i) => (
              <div key={i} className={styles.fact}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      );
    case 'table':
      return (
        <Card className={styles.tableCard}>
          <Table
            label={block.label}
            heading={block.caption ? <p className={styles.caption}>{block.caption}</p> : null}
            columns={block.columns.map((header) => ({ header }))}
            rows={block.rows.map((cells, i) => ({ key: String(i), cells }))}
          />
        </Card>
      );
    case 'pair':
      return (
        <Card as="article" className={styles.card}>
          {block.title ? (
            <Heading level={3} size="s">
              {block.title}
            </Heading>
          ) : null}
          <div className={styles.pair}>
            <Side side={block.before} />
            <Side side={block.after} />
          </div>
        </Card>
      );
  }
}

function Side({ side }: { side: ProofSideView }) {
  return (
    <div className={styles.side} data-v2-proof-side="">
      <p className={styles.sideLabel}>{side.label}</p>
      <p className={styles.date}>{side.date}</p>
      <p className={styles.value}>{side.value}</p>
      {side.evidence.length ? (
        <ul className={styles.sentences}>
          {side.evidence.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
