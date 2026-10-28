/**
 * The v2 primitives. docs/specs/v2/21-design-system.md lists these exports, generated from this
 * file and the components' own props by apps/web/__tests__/v2/generate-spec.ts.
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export {
  StatusPill,
  Glyph,
  glyphShape,
  PILL_STATES,
  type StatusPillProps,
  type PillState,
  type GlyphChar,
} from './StatusPill';
export { Grade, GRADE_LETTERS, type GradeProps } from './Grade';
export { VerdictCell, type VerdictCellProps } from './VerdictCell';
export {
  VERDICTS,
  EVIDENCE_CLASSES,
  type Verdict,
  type VerdictStyle,
  type EvidenceClass,
} from './verdicts';
export { CoverageLine, coverageText, type Coverage } from './CoverageLine';
export { Card, type CardProps } from './Card';
export { Table, type TableProps, type TableColumn, type TableRow } from './Table';
export { Field, type FieldProps } from './Field';
export { Heading, type HeadingProps } from './Heading';
export { PageShell, type PageShellProps } from './PageShell';
export { BrandLink } from './BrandLink';
export { NavMenu } from './NavMenu';
export { SiteFooter, type SiteFooterProps, type ServiceStatus } from './SiteFooter';
export { CopyEmail } from './CopyEmail';
export { CookieSettings } from './CookieSettings';
export {
  FOOTER_COLUMNS,
  FOOTER_COPY,
  LOG_IN,
  MARKETING_NAV,
  SUPPORT_EMAIL,
  isGroup,
  type FooterColumn,
  type FooterControl,
  type FooterItem,
  type LiveLink,
  type NavEntry,
  type NavGroup,
  type PlannedLink,
  type SiteLink,
  type StatusLink,
} from './footer-links';
export { VisuallyHidden } from './VisuallyHidden';
