'use client';

import { useEffect, useState } from 'react';
import { Card } from '../../Card';
import { Grade } from '../../Grade';
import { LinkMapGraph } from '../../graph/LinkMapGraph';
import { DEMO_NODES } from '../../graph/demo-graph';
import { count, numberWord } from '../words';
import type { HomeScreenData } from '../types';
import layout from '../../layout.module.css';
import styles from './HomeScreen.module.css';

const SEEN_KEY = 'cm-stage-seen';

/** What the map shows, counted from the graph so the description cannot disagree with it. */
export function stageLabel(): string {
  const orphans = DEMO_NODES.filter((n) => n.role === 'orphan').length;
  const js = DEMO_NODES.filter((n) => n.role === 'js').length;
  return `Map of a site's internal links being built as the crawler runs: a hub, three rings of pages, ${numberWord(orphans)} orphan pages with no links in, ${numberWord(js)} pages reachable only through JavaScript`;
}

/**
 * The example audit replayed: the link map builds, then the grades appear. The build runs once
 * per session (rule 13); a later view shows the finished stage at once.
 */
export function Stage({ example }: { example: HomeScreenData['example'] }) {
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === '1';
      window.sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      seen = false;
    }
    if (seen) setInstant(true);
  }, []);

  const [seo, ai] = example.grades;
  return (
    <Card className={`${styles.stage} ${instant ? styles.instant : ''}`}>
      <LinkMapGraph
        variant="stage"
        motion={instant ? 'instant' : 'animate'}
        label={stageLabel()}
        className={styles.stageSvg}
      />
      <div className={`${styles.ov} ${styles.progress}`}>
        <div className={`${layout.row} ${styles.between}`}>
          <span className={layout.mono}>{example.domain}</span>
          <span className={`${layout.mono} ${layout.mut}`}>{example.duration}</span>
        </div>
        <div className={styles.track}>
          <div className={styles.prog} />
        </div>
        <div className={`${layout.row} ${styles.between} ${styles.counts}`}>
          <span className={layout.mut}>
            {count(example.pagesCrawled)} of {count(example.pagesTotal)} pages
          </span>
          <span className={layout.mut}>{count(example.links)} links</span>
        </div>
      </div>
      <div className={styles.late}>
        {[seo, ai].map((g) => (
          <Card key={g.label} className={styles.lateCard}>
            <Grade label={g.label} letter={g.letter} score={g.score} tone={g.tone}>
              {g.summary}
            </Grade>
          </Card>
        ))}
      </div>
      <div className={`${styles.ov} ${layout.row} ${styles.legend}`}>
        <span className={layout.row}>
          <span className={styles.keyDot} />
          reachable
        </span>
        <span className={layout.row}>
          <span className={styles.keyTriangle} />
          only through JavaScript
        </span>
        <span className={layout.row}>
          <span className={styles.keySquare} />
          orphan, no links in
        </span>
      </div>
    </Card>
  );
}
