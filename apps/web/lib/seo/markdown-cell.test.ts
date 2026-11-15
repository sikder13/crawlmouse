import { describe, expect, it } from 'vitest';
import { markdownCell } from './markdown-cell';

describe('markdownCell', () => {
  it('escapes a pipe, and a backslash before it, so neither ends the cell', () => {
    expect(markdownCell('a | b')).toBe('a \\| b');
    expect(markdownCell('ends in \\')).toBe('ends in \\\\');
    // A backslash before a pipe stays a backslash and the pipe stays escaped: `\\\|`.
    expect(markdownCell('x\\|y')).toBe('x\\\\\\|y');
  });
  it('joins lines with one space', () => {
    expect(markdownCell('one\n   two\nthree')).toBe('one two three');
  });
});
