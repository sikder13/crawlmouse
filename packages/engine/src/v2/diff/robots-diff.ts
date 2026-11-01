/**
 * The literal line diff of two robots.txt files: the lines one has that the other does not, in file
 * order. Lines are compared as written; only a line ending (`\r\n` or `\n`) is not part of a line,
 * and a final line ending does not start an empty last line.
 *
 * The lines both files share at the start and the end are kept, and the longest common subsequence of
 * the rest is kept too, so a line that moved (between user-agent groups, say) shows as removed and
 * added, as it must: in robots.txt, a rule's place decides which crawlers it applies to.
 */

/**
 * The most cells the subsequence table may have (lines left in one file times the other). Past it,
 * every line between the shared start and end is quoted as removed and added: still a true diff,
 * just not the shortest. robots.txt files that large are rare, and the row quotes 50 lines anyway.
 */
export const LCS_CELL_LIMIT = 1_000_000;

export interface LineDiff {
  removed: string[];
  added: string[];
}

export function lineDiff(before: string, after: string): LineDiff {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > LCS_CELL_LIMIT) return { removed: midA, added: midB };
  return subsequenceDiff(midA, midB);
}

function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all[all.length - 1] === '') all.pop();
  return all;
}

/** The diff that keeps a longest common subsequence: a table of suffix lengths, then one walk. */
function subsequenceDiff(a: string[], b: string[]): LineDiff {
  const width = b.length + 1;
  // keep[i * width + j]: the longest common subsequence of a[i..] and b[j..].
  const keep = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      keep[i * width + j] =
        a[i] === b[j]
          ? keep[(i + 1) * width + j + 1]! + 1
          : Math.max(keep[(i + 1) * width + j]!, keep[i * width + j + 1]!);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (keep[(i + 1) * width + j]! >= keep[i * width + j + 1]!) {
      removed.push(a[i++]!);
    } else {
      added.push(b[j++]!);
    }
  }
  return { removed: [...removed, ...a.slice(i)], added: [...added, ...b.slice(j)] };
}
