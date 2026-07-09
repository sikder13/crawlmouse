export interface LogoUploadResult {
  ok: boolean;
  logoPath?: string;
  error?: 'pro_required' | 'verification_required' | 'invalid_image' | 'unavailable' | 'upload_failed' | 'network';
}

// SPEC 04.1 §3 — injectable client wrapper for the shipped logo route (multipart). Returns the stored
// logoPath, which the caller attaches via the white-label route (that route re-verifies the slug scope).
// The server byte-validation (magic bytes + decode, no SVG, ≤200KB) is the authoritative gate (U4).
export async function uploadLogo(slug: string, file: Blob, fetchImpl: typeof fetch): Promise<LogoUploadResult> {
  try {
    const fd = new FormData();
    fd.append('logo', file);
    const res = await fetchImpl(`/api/reports/${encodeURIComponent(slug)}/logo`, { method: 'POST', body: fd });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { logoPath?: string };
      return { ok: true, logoPath: data.logoPath };
    }
    if (res.status === 402) return { ok: false, error: 'pro_required' };
    if (res.status === 403) return { ok: false, error: 'verification_required' };
    if (res.status === 400) return { ok: false, error: 'invalid_image' };
    if (res.status === 503) return { ok: false, error: 'unavailable' };
    return { ok: false, error: 'upload_failed' };
  } catch {
    return { ok: false, error: 'network' };
  }
}
