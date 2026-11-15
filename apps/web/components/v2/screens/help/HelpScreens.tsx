import type { ReactNode } from 'react';
import { Button } from '../../Button';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import type { HelpSentence } from '../../../../lib/v2/help/articles';
import type {
  HelpArticleView,
  HelpBlockView,
  HelpIndexView,
  HelpSupport,
} from '../../../../lib/v2/help/view';
import { Capability, ComingMark } from '../agencies/Capability';
import layout from '../../layout.module.css';
import styles from './Help.module.css';

/**
 * The help centre (CC-33 D4). No artboard exists: one column of reading text in the public shell,
 * with the marketing header as the /check pages have it. Nothing on it is orange: it asks the reader
 * to do nothing.
 */
function HelpShell({
  footerComing,
  children,
}: {
  footerComing: string | null;
  children: ReactNode;
}) {
  return (
    <PageShell
      nav={MARKETING_NAV}
      actions={
        <Button variant="quiet" href={LOG_IN.href}>
          {LOG_IN.label}
        </Button>
      }
      footerLineMark={footerComing ? <ComingMark label={footerComing} /> : null}
    >
      <main className={`${layout.wrap} ${styles.main}`}>
        <div className={styles.column}>{children}</div>
      </main>
    </PageShell>
  );
}

function Support({ support }: { support: HelpSupport }) {
  return (
    <p className={styles.more}>
      {support.lead} <a href={support.href}>{support.label}</a>
    </p>
  );
}

/** A sentence as text, or, when it names a capability, carrying it and its "coming" mark. */
function Sentence({ sentence, comingLabel }: { sentence: HelpSentence; comingLabel: string }) {
  if (sentence.capabilities.length === 0) return <>{sentence.text}</>;
  return <Capability item={sentence} comingLabel={comingLabel} />;
}

function Sentences({ sentences, comingLabel }: { sentences: HelpSentence[]; comingLabel: string }) {
  return sentences.map((s, i) => (
    <span key={s.text}>
      {i > 0 ? ' ' : null}
      <Sentence sentence={s} comingLabel={comingLabel} />
    </span>
  ));
}

function Block({ block, comingLabel }: { block: HelpBlockView; comingLabel: string }) {
  switch (block.kind) {
    case 'heading':
      return (
        <Heading level={2} size="s" className={styles.heading}>
          {block.text}
        </Heading>
      );
    case 'paragraph':
      return (
        <p className={styles.p}>
          <Sentences sentences={block.sentences} comingLabel={comingLabel} />
        </p>
      );
    case 'list':
      return (
        <ul className={styles.list}>
          {block.items.map((item) => (
            <li key={item.text}>
              <Sentence sentence={item} comingLabel={comingLabel} />
            </li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre className={styles.code}>
          <code>{block.lines.join('\n')}</code>
        </pre>
      );
    case 'see':
      return (
        <p className={styles.see}>
          {block.label} <a href={block.href}>{block.question}</a>
        </p>
      );
  }
}

export function HelpIndexScreen({ data }: { data: HelpIndexView }) {
  return (
    <HelpShell footerComing={data.footerComing}>
      <Heading level={1} size="l">
        {data.h1}
      </Heading>
      <p className={styles.lead}>{data.lead}</p>
      <ul className={styles.index}>
        {data.entries.map((e) => (
          <li key={e.href}>
            <a href={e.href}>{e.question}</a>
            <p>{e.description}</p>
          </li>
        ))}
      </ul>
      <Support support={data.support} />
    </HelpShell>
  );
}

export function HelpArticleScreen({ data }: { data: HelpArticleView }) {
  return (
    <HelpShell footerComing={data.footerComing}>
      <p className={styles.crumb}>
        <a href={data.index.href}>{data.index.label}</a>
      </p>
      <Heading level={1} size="l" className={styles.title}>
        {data.h1}
      </Heading>
      {data.blocks.map((block, i) => (
        <Block key={i} block={block} comingLabel={data.comingLabel} />
      ))}
      <Support support={data.support} />
    </HelpShell>
  );
}
