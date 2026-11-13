-- Client roles hold exactly the declared privileges on the v2 tables.
-- anon holds nothing on any v2 table or partition. authenticated and crawl_worker hold exactly
-- the grants in this file's `declared` list, at the table or column level: a privilege held but
-- not listed, or listed on an existing table and column but not held, is a finding. The v2 tables
-- are the ones in its `v2_tables` list, every relation in the research and partitions schemas, and
-- every partition, in any schema, of a table in those schemas or public. A table, column or role
-- that does not exist yet (a migration not applied) is skipped; scripts/db/check.test.ts requires
-- every listed table to exist once the migrations have run.
--
-- A migration that changes these grants changes this list in the same pull request.
with
v2_tables(rel) as (
  values
    ('public.access_tests'), ('public.accounts'), ('public.agency_brands'), ('public.alert_events'),
    ('public.alert_rules'), ('public.api_keys'), ('public.changes'), ('public.check_ledger_links'),
    ('public.checks'), ('public.crawl_batches'), ('public.deploy_hooks'), ('public.email_sends'),
    ('public.email_suppressions'), ('public.evidence_blobs'),
    ('public.contact_requests'), ('public.fix_email_requests'), ('public.fix_events'), ('public.link_edges'), ('public.measurement_lineages'),
    ('public.operator_actions'), ('public.operators'),
    ('public.page_results'), ('public.persist_chunks'), ('public.report_schedules'),
    ('public.reports'), ('public.seat_sites'), ('public.seats'), ('public.share_links'),
    ('public.site_fixes'), ('public.sites'), ('public.slack_sends'), ('public.subscriptions'), ('public.trial_ledger'),
    ('public.usage_events')
),
-- (relation, role, privilege, columns); null columns is a grant on the whole table.
declared(rel, role, privilege, columns) as (
  values
    ('public.access_tests', 'authenticated', 'SELECT', array[
      'body_excerpt', 'byte_count', 'cause', 'check_id', 'check_month', 'evidence_class',
      'final_url', 'fly_region', 'headers', 'http_version', 'id', 'identity_role',
      'identity_sent', 'limitations', 'lineage_id', 'measurement_status', 'method',
      'page_url', 'raw_status', 'request_headers', 'request_signing', 'signature_verified',
      'source_ip_class', 'tagged', 'template_key', 'tested_at', 'timing', 'ua', 'verdict',
      'witness', 'word_count', 'worker_release']),
    ('public.accounts', 'authenticated', 'SELECT', array[
      'card_last4', 'competitor_limit', 'created_at', 'current_subscription_id',
      'deleted_at', 'disputed_at', 'email_change_notes', 'email_trial_reminder',
      'entitlement_changed_at', 'entitlement_version', 'id', 'kind', 'last_active_at',
      'name', 'past_due_since', 'past_due_tier', 'seat_limit', 'site_limit', 'state',
      'state_history', 'tier', 'timezone', 'trial_ends_at', 'trial_used_at',
      'trial_variant', 'updated_at']),
    ('public.agency_brands', 'authenticated', 'SELECT', array[
      'accent_hex', 'account_id', 'agency_name', 'created_at', 'dkim_passes',
      'dmarc_policy', 'logo_path', 'open_tracking_default', 'portal_certificate_issued_at',
      'portal_cname_found', 'portal_domain', 'portal_domain_status', 'portal_slug',
      'portal_txt_token', 'portal_txt_verified_at', 'postal_address', 'resend_domain_id',
      'sender_domain', 'sender_domain_status', 'sender_from', 'spf_passes', 'updated_at',
      'vercel_domain_added_at']),
    ('public.alert_events', 'authenticated', 'SELECT', array[
      'change_ids', 'channel', 'check_id', 'destination_hash', 'id', 'provider_message_id',
      'reason', 'rule_id', 'sent_at', 'site_id', 'status']),
    ('public.alert_rules', 'authenticated', 'DELETE', null),
    ('public.alert_rules', 'authenticated', 'SELECT', array[
      'account_id', 'channels', 'enabled', 'id', 'kind', 'last_fired_at',
      'last_fired_check_id', 'site_id', 'threshold_points']),
    ('public.alert_rules', 'authenticated', 'INSERT', array[
      'account_id', 'channels', 'enabled', 'kind', 'site_id', 'threshold_points']),
    ('public.alert_rules', 'authenticated', 'UPDATE', array[
      'channels', 'enabled', 'threshold_points']),
    ('public.api_keys', 'authenticated', 'SELECT', array[
      'account_id', 'created_at', 'created_by', 'id', 'last_used_at', 'name', 'prefix',
      'revoked_at', 'scopes']),
    ('public.changes', 'authenticated', 'SELECT', array[
      'cause', 'check_id', 'detected_at', 'grade_deltas', 'id', 'kind', 'notified',
      'pages_affected', 'previous_check_id', 'severity', 'site_id', 'summary', 'ua',
      'where']),
    ('public.checks', 'authenticated', 'SELECT', array[
      'ai_readability', 'ai_readability_status', 'check_month', 'competitors', 'content',
      'coverage', 'crawlers', 'deferred_until', 'expires_at', 'failure_reason',
      'finished_at', 'grade_version', 'id', 'lineage_id', 'previous_check_id', 'progress',
      'queued_at', 'result_email', 'signals', 'site_id', 'stack', 'started_at', 'status',
      'structure', 'technical_seo', 'technical_seo_status', 'tested_at', 'trigger',
      'without_js']),
    ('public.deploy_hooks', 'authenticated', 'SELECT', array[
      'created_at', 'fire_count', 'id', 'last_fired_at', 'provider', 'revoked_at',
      'site_id']),
    ('public.evidence_blobs', 'authenticated', 'SELECT', array[
      'bytes', 'check_id', 'contents', 'created_at', 'id', 'sha256', 'storage_path',
      'version']),
    ('public.link_edges', 'authenticated', 'SELECT', array[
      'anchor_text', 'check_id', 'check_month', 'from_hash', 'from_url',
      'is_generic_anchor', 'js_only', 'lineage_id', 'to_hash', 'to_url']),
    ('public.measurement_lineages', 'authenticated', 'SELECT', array[
      'crawler_registry_version', 'created_at', 'detector_ruleset_version', 'engine_sha',
      'id', 'population_version', 'worker_release']),
    ('public.page_results', 'authenticated', 'SELECT', array[
      'canonical_declared', 'check_id', 'check_month', 'content_failures',
      'content_simhash', 'crawlers_reached', 'crawlers_reading_text', 'depth', 'final_url',
      'found_via', 'headers', 'hreflang', 'identity_sent', 'is_html', 'is_orphan',
      'js_only', 'kind', 'lineage_id', 'links_in', 'links_out', 'links_read',
      'meta_description', 'pagerank_share', 'redirect', 'request_headers', 'robots_search',
      'sampled', 'sitemap_lastmod', 'source_ip_class', 'status_code', 'suggested_parent_url',
      'template_key', 'title', 'url', 'url_hash', 'without_js']),
    ('public.page_results', 'crawl_worker', 'INSERT', null),
    ('public.report_schedules', 'authenticated', 'SELECT', array[
      'account_id', 'cadence', 'created_at', 'iso_weekday', 'last_run_at', 'next_run_at',
      'open_tracking', 'page_slug', 'paused_by_recipient_at', 'send_when_unchanged',
      'site_id', 'time_local', 'timezone', 'updated_at']),
    ('public.reports', 'authenticated', 'SELECT', array[
      'account_id', 'byte_count', 'covers_check_ids', 'created_at', 'format', 'headline',
      'id', 'kind', 'made_by', 'open_tracking', 'opened_at', 'owner_seat_id',
      'public_slug', 'recipient_email', 'scheduled_for', 'sent_at', 'share_expires_at',
      'site_id', 'status']),
    ('public.seat_sites', 'authenticated', 'SELECT', array[
      'account_id', 'seat_id', 'site_id']),
    ('public.seats', 'authenticated', 'SELECT', array[
      'accepted_at', 'account_id', 'alert_channels', 'client_scope_all', 'created_at',
      'email_weekly_summary', 'id', 'invited_email', 'name', 'removed_at', 'role', 'status',
      'theme', 'user_id']),
    ('public.sites', 'authenticated', 'SELECT', array[
      'account_id', 'client_contact_email', 'client_contact_name', 'client_name',
      'competitor_hosts', 'created_at', 'host', 'id', 'owner_seat_id', 'paused',
      'paused_reason', 'removed_at', 'schedule_cadence', 'schedule_hour_local',
      'schedule_iso_weekday', 'slack_channel', 'staging_of_site_id', 'updated_at']),
    ('public.subscriptions', 'authenticated', 'SELECT', array[
      'account_id', 'cancel_at_period_end', 'canceled_at', 'created_at',
      'current_period_end', 'ended_at', 'extra_site_quantity', 'id', 'interval',
      'last_event_created', 'last_event_id', 'plan', 'price_ids', 'seat_quantity',
      'status', 'trial_end', 'updated_at'])
),
rels as (
  select c.oid, format('%s.%s', n.nspname, c.relname) as rel
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm')
    and (format('%s.%s', n.nspname, c.relname) in (select rel from v2_tables)
         or n.nspname in ('research', 'partitions')
         or (c.relispartition and exists (
               select 1 from pg_inherits i join pg_class pc on pc.oid = i.inhparent
                 join pg_namespace pn on pn.oid = pc.relnamespace
                where i.inhrelid = c.oid and pn.nspname in ('public', 'research', 'partitions'))))
),
roles(role) as (
  select rolname::text from pg_roles where rolname in ('anon', 'authenticated', 'crawl_worker')
),
table_held as (
  select r.rel, ro.role, p.privilege
  from rels r cross join roles ro
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
                          'TRIGGER', 'MAINTAIN']) p(privilege)
  where has_table_privilege(ro.role, r.oid, p.privilege)
),
column_held as (
  select r.rel, ro.role, p.privilege, a.attname::text as col
  from rels r cross join roles ro
  join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p(privilege)
  where has_column_privilege(ro.role, r.oid, a.attnum, p.privilege)
    and not has_table_privilege(ro.role, r.oid, p.privilege)
),
table_declared as (
  select d.rel, d.role, d.privilege from declared d where d.columns is null
),
column_declared as (
  select d.rel, d.role, d.privilege, c.col
  from declared d cross join unnest(d.columns) c(col) where d.columns is not null
)
select h.rel as object, format('%s holds %s on the table; not declared', h.role, h.privilege) as problem
from table_held h
where not exists (select 1 from table_declared d
                  where d.rel = h.rel and d.role = h.role and d.privilege = h.privilege)
union all
select d.rel, format('%s is declared to hold %s on the table and does not', d.role, d.privilege)
from table_declared d
join rels r on r.rel = d.rel
join roles ro on ro.role = d.role
where not exists (select 1 from table_held h
                  where h.rel = d.rel and h.role = d.role and h.privilege = d.privilege)
union all
select format('%s.%s', h.rel, h.col), format('%s holds %s on the column; not declared', h.role, h.privilege)
from column_held h
where not exists (select 1 from column_declared d
                  where d.rel = h.rel and d.role = h.role and d.privilege = h.privilege
                    and d.col = h.col)
union all
select format('%s.%s', d.rel, d.col),
       format('%s is declared to hold %s on the column and does not', d.role, d.privilege)
from column_declared d
join rels r on r.rel = d.rel
join roles ro on ro.role = d.role
join pg_attribute a on a.attrelid = r.oid and a.attname = d.col and not a.attisdropped
where not exists (select 1 from column_held h
                  where h.rel = d.rel and h.role = d.role and h.privilege = d.privilege
                    and h.col = d.col)
order by 1, 2;
