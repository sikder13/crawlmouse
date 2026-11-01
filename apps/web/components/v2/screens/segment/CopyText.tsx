'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '../../Button';
import styles from './SegmentScreen.module.css';

/** How long the "Copied" notice stays before the status region empties again. */
const NOTICE_MS = 3000;

/**
 * A button that copies `text` (a fix packet, a raw response) and says so in a status region.
 * Where the clipboard API is missing or refuses, it says so rather than pretending.
 */
export function CopyText({
  text,
  children,
  variant = 'quiet',
  size = 'sm',
}: {
  text: string;
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [notice, setNotice] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const say = (words: string) => {
    setNotice(words);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(''), NOTICE_MS);
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard API');
      await navigator.clipboard.writeText(text);
      say('Copied');
    } catch {
      say('This browser did not allow copying; select the text to copy it.');
    }
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => void copy()}>
        {children}
      </Button>
      <span role="status" className={styles.notice}>
        {notice}
      </span>
    </>
  );
}
