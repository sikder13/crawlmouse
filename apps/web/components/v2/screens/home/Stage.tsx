import { Card } from '../../Card';
import { Grade } from '../../Grade';
import { MapSvg } from '../../map/MapSvg';
import type { HomeView } from '../../../../lib/v2/view/home';
import { count } from '../../../../lib/v2/words';
import layout from '../../layout.module.css';
import styles from './HomeScreen.module.css';

/**
 * The example audit on Home: the crawl screen's own replay, shown at its end. Still: the build
 * plays on the crawl screen, where it is a real crawl's progress (DESIGN-LOCK rule 13).
 */
export function Stage({ example }: { example: HomeView['example'] }) {
  return (
    <Card className={styles.stage}>
      <MapSvg
        nodes={example.map.nodes}
        positions={example.map.positions}
        label={example.mapLabel}
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
        {example.grades.map((g) => (
          <Card key={g.label} className={styles.lateCard}>
            <Grade
              label={g.label}
              letter={g.letter ?? undefined}
              score={g.score ?? undefined}
              tone={g.tone}
            >
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
