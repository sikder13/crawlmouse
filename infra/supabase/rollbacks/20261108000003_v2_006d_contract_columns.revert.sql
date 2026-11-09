-- Reverts 20261108000003_v2_006d_contract_columns.sql: the enum CHECKs return to the values they held
-- before, and the columns, CHECKs and functions 006d added are dropped with what they hold.
--
-- The narrower CHECKs are added first, and each validates the rows already stored, so the revert
-- refuses (23514) and changes nothing while a row holds other_egress, or a ledger run records ucp,
-- rsl, agent_card or llms_full. Re-runnable.

alter table public.access_tests drop constraint if exists access_tests_source_ip_class_check;
alter table public.access_tests add constraint access_tests_source_ip_class_check
  check (source_ip_class in ('fly_egress', 'browser_rendering', 'owner_logs'));
alter table public.page_results drop constraint if exists page_results_source_ip_class_check;
alter table public.page_results add constraint page_results_source_ip_class_check
  check (source_ip_class in ('fly_egress', 'browser_rendering', 'owner_logs'));
alter table research.check_runs drop constraint if exists check_runs_signals_detected_check;
alter table research.check_runs add constraint check_runs_signals_detected_check
  check (signals_detected <@ array['schema_org', 'content_signals', 'web_bot_auth', 'llms_txt',
                                   'mcp_server_card', 'markdown_negotiation', 'agent_skills_index']);
alter table research.check_runs drop constraint if exists check_runs_signals_indeterminate_check;
alter table research.check_runs add constraint check_runs_signals_indeterminate_check
  check (signals_indeterminate <@ array['schema_org', 'content_signals', 'web_bot_auth', 'llms_txt',
                                        'mcp_server_card', 'markdown_negotiation', 'agent_skills_index']);

alter table public.access_tests
  drop column if exists identity_role,
  drop column if exists tagged,
  drop column if exists witness,
  drop column if exists fly_region,
  drop column if exists request_signing,
  drop column if exists signature_verified,
  drop column if exists worker_release,
  drop column if exists timing;

alter table public.page_results drop constraint if exists page_results_head_text_absent;
alter table public.page_results drop constraint if exists page_results_title;
alter table public.page_results drop constraint if exists page_results_meta_description;
alter table public.page_results drop column if exists title, drop column if exists meta_description;

drop function if exists public.v2_head_text_shape_ok(jsonb, integer);
drop function if exists public.v2_head_text_absent_ok(jsonb);
