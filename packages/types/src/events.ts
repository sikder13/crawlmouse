export type AuditEvent =
  | { type: 'audit.started'; auditId: string; url: string; timestamp: number }
  | { type: 'audit.progress'; auditId: string; phase: 'sitemap' | 'crawl' | 'analyze' | 'score'; pct: number; timestamp: number }
  | { type: 'page.discovered'; auditId: string; url: string; title?: string; depth?: number; timestamp: number }
  | { type: 'link.found'; auditId: string; from: string; to: string; anchor: string; timestamp: number }
  | { type: 'audit.completed'; auditId: string; grade: string; score: number; timestamp: number }
  | { type: 'audit.failed'; auditId: string; reason: string; timestamp: number }
  | { type: 'grade.changed'; auditId: string; previousGrade: string; newGrade: string; timestamp: number }
  | { type: 'suggestions.ready'; auditId: string; count: number; timestamp: number };

export type AuditEventType = AuditEvent['type'];
