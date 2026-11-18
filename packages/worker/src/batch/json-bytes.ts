/**
 * A string's size as the result store holds it: the UTF-8 bytes of its JSON, without the two
 * enclosing quotes (store.ts sizes a result as Buffer.from(JSON.stringify(result))). A `"` or `\`
 * costs two bytes there, a control character two or six, and a lone surrogate six, so UTF-8 bytes
 * understate it. Counted without building the JSON, so a page's text is not copied to be measured;
 * json-bytes.test.ts holds it equal to JSON.stringify on any string.
 */
export function jsonBytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22 || c === 0x5c) n += 2;
    else if (c < 0x20)
      n += c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d ? 2 : 6;
    else if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 6;
    } else if (c >= 0xdc00 && c <= 0xdfff) n += 6;
    else n += 3;
  }
  return n;
}
