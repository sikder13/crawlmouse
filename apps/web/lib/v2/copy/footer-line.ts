/**
 * What the shared footer's line ("…and tells you when that changes", components/v2/footer-links.ts)
 * names, as keys of `CAPABILITIES` (lib/v2/view/agencies.ts, whose `footerComing` refuses a key it
 * does not hold): checking again and the change email (SEO R2-N2). Plain strings with no imports, so
 * the footer, which renders it as `data-capability`, imports nothing of the capability table.
 */
export const FOOTER_LINE_CAPABILITIES: readonly string[] = ['weekly_checks', 'change_emails'];
