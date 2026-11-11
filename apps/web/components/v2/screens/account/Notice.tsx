'use client';

import { useEffect, useRef } from 'react';
import shared from './AccountScreen.module.css';

export interface NoticeView {
  code: string;
  text: string;
}

/**
 * Why a form posted from this page was refused, or what it did (an addition:
 * lib/v2/copy/notices.ts). It is on the page when the page loads, so a live region would say
 * nothing; focus moves to it instead, and a screen reader reads it.
 */
export function Notice({ notice }: { notice: NoticeView | null | undefined }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [notice?.code]);
  if (!notice) return null;
  return (
    <p
      ref={ref}
      tabIndex={-1}
      className={shared.note}
      role="status"
      data-v2-addition=""
      data-v2-notice={notice.code}
    >
      {notice.text}
    </p>
  );
}
