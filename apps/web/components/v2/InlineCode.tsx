import { Fragment } from 'react';

/**
 * Prose the engine writes in Markdown, read on a page (D-30): each span between a pair of backticks
 * is drawn as code, without the backticks. With an odd number of backticks the last one has no
 * pair, so the text is drawn as it is, backticks and all, rather than guessing where a span ends.
 * The packet itself keeps its Markdown: it is shown as written in a <pre> and copied as written.
 */
export function InlineCode({ text }: { text: string }) {
  const parts = text.split('`');
  if (parts.length < 3 || parts.length % 2 === 0) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <code key={i}>{p}</code> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}
