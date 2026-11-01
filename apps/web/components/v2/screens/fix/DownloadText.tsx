'use client';

import { Button } from '../../Button';

/** A button that saves `text` as a file, made in the browser; nothing is fetched or sent. */
export function DownloadText({
  text,
  filename,
  children,
}: {
  text: string;
  filename: string;
  children: string;
}) {
  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="quiet" size="sm" onClick={save}>
      {children}
    </Button>
  );
}
