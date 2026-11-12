'use client';

import { useEffect, useRef } from 'react';

/**
 * One email's HTML as a mail client shows it: its own document in a frame, so its styles apply to it
 * alone, and the frame as tall as the message, so the page (and a screenshot of it) holds all of it.
 */
export function MailFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const fit = () => {
      const doc = frame.contentDocument;
      if (doc?.documentElement) frame.style.height = `${doc.documentElement.scrollHeight}px`;
    };
    fit();
    frame.addEventListener('load', fit);
    window.addEventListener('resize', fit);
    return () => {
      frame.removeEventListener('load', fit);
      window.removeEventListener('resize', fit);
    };
  }, [html]);
  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={html}
      style={{ display: 'block', width: '100%', border: 0, height: 600 }}
      data-mail-frame
    />
  );
}
