import type { Notice } from '../../../../lib/v2/copy/settings-notices';
import styles from './SettingsScreen.module.css';

/**
 * One line under a Settings page's header saying what the last form did: announced politely when it
 * went through, at once when it was refused. Nothing when there is no line.
 */
export function NoticeLine({ notice }: { notice: Notice | null }) {
  if (notice === null) return null;
  return (
    <p
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`${styles.notice} ${notice.tone === 'error' ? styles.noticeError : ''}`}
    >
      {notice.text}
    </p>
  );
}
