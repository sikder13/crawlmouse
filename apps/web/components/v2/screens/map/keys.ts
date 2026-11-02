/**
 * The explorer's keyboard model, as data: the list of drawn pages holds the focus, and each key
 * below moves the selection or the focus. Explorer.tsx acts on it and SPEC 24 renders it.
 */
export type KeyMove = 'next' | 'previous' | 'first' | 'last' | 'details';

export const EXPLORER_KEYS: { key: string; move: KeyMove; does: string }[] = [
  { key: 'ArrowDown', move: 'next', does: 'Selects the next page in the list' },
  { key: 'ArrowRight', move: 'next', does: 'Selects the next page in the list' },
  { key: 'ArrowUp', move: 'previous', does: 'Selects the previous page' },
  { key: 'ArrowLeft', move: 'previous', does: 'Selects the previous page' },
  { key: 'Home', move: 'first', does: 'Selects the first page in the list' },
  { key: 'End', move: 'last', does: 'Selects the last page' },
  { key: 'Enter', move: 'details', does: 'Moves the focus to the selected page’s details' },
];
