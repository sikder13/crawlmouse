/** One cookie's value from a request's Cookie header, without touching the request body. */
export function requestCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.split('=');
    if (value.length === 0 || key!.trim() !== name) continue;
    const raw = value.join('=').trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}
