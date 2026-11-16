/**
 * Writes a rendered file as the repository's Prettier would format it, so a re-render is what CI's
 * changed-file Prettier check accepts. The parser is chosen from the file name.
 */
import { writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';

export async function writeFormatted(path: string, text: string): Promise<void> {
  const options = (await resolveConfig(path)) ?? {};
  writeFileSync(path, await format(text, { ...options, filepath: path }));
}
