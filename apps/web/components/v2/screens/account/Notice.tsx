import shared from './AccountScreen.module.css';

export interface NoticeView {
  code: string;
  text: string;
}

/** Why a form posted from this page was refused (an addition: lib/v2/copy/notices.ts). */
export function Notice({ notice }: { notice: NoticeView | null | undefined }) {
  if (!notice) return null;
  return (
    <p className={shared.note} role="status" data-v2-addition="" data-v2-notice={notice.code}>
      {notice.text}
    </p>
  );
}
