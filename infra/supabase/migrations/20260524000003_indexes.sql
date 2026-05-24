create index on audits (user_id, started_at desc);
create index on audits (url, completed_at desc);
create index on pages (audit_id, is_orphan);
create index on links (audit_id, to_page_id);
create index on findings (audit_id, category);
