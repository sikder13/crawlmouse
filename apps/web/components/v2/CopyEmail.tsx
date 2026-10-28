'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import styles from './SiteFooter.module.css';

/** How long the "Copied" notice stays before the status region empties again. */
const NOTICE_MS = 3000;

/**
 * An email address as selectable text, with a button that copies it. Where the clipboard API is
 * missing or refuses, the address is selected instead, for the reader to copy with the keyboard.
 */
export function CopyEmail({ address }: { address: string }) {
  const [notice, setNotice] = useState('');
  const text = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const say = (words: string) => {
    setNotice(words);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(''), NOTICE_MS);
  };

  const select = () => {
    const node = text.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard API');
      await navigator.clipboard.writeText(address);
      say('Copied');
    } catch {
      select();
      say('Selected. Press Ctrl+C (⌘C on a Mac) to copy it.');
    }
  };

  return (
    <div className={styles.email}>
      <span ref={text} className={styles.address}>
        {address}
      </span>
      <Button size="sm" onClick={() => void copy()}>
        Copy address
      </Button>
      <span role="status" className={styles.notice}>
        {notice}
      </span>
    </div>
  );
}
