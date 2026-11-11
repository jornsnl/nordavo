-- What Claude may do through the MCP (20261121020000_mcp_claude_rights.sql):
-- Claude's rights per module, meeting status and fee, and Work tasks per
-- project. Run against a database with every migration applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/mcp_claude.test.sql
--
-- One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a1', 'julius@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000007a2', 'intern@nordavo.nl', '{"full_name": "Intern"}'),
  ('00000000-0000-0000-0000-0000000007a3', 'caller@webpartners.nl', '{"full_name": "Carla"}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000007a1';
update public.profiles set role = 'member', modules = array['sales'] where id = '00000000-0000-0000-0000-0000000007a2';
update public.profiles set role = 'caller' where id = '00000000-0000-0000-0000-0000000007a3';
insert into public.callers (id, profile_id, name, email, fee_per_meeting) values
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007a3', 'Carla', 'caller@webpartners.nl', 75);
insert into public.companies (id, name, domain, lead_status) values
  ('00000000-0000-0000-0000-0000000007d1', 'Impaqt Software', 'impaqt.nl', 'ready');
insert into public.meetings (id, company_id, caller_id, scheduled_at) values
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-0000000007c1', now() - interval '1 day');

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
create function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
$$;
create function pg_temp.fails(p_sql text, p_what text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % should have been refused', p_what;
exception
  when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  when others then null;
end $$;
grant execute on function pg_temp.act(uuid), pg_temp.service(), pg_temp.fails(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Claude's rights per module: the team reads them, only admins change them
-- ---------------------------------------------------------------------------

do $$ begin
  if (select level from public.mcp_module_access where module = 'content') <> 'write' then
    raise exception 'FAIL: Content starts with full write rights for Claude';
  end if;
end $$;

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000007a2');
do $$ begin
  if (select count(*) from public.mcp_module_access) < 5 then
    raise exception 'FAIL: team members read the rights';
  end if;
end $$;
update public.mcp_module_access set level = 'read' where module = 'sales';
select pg_temp.act('00000000-0000-0000-0000-0000000007a1');
do $$ begin
  if (select level from public.mcp_module_access where module = 'sales') <> 'write' then
    raise exception 'FAIL: a member cannot change Claude''s rights';
  end if;
end $$;
update public.mcp_module_access set level = 'suggest' where module = 'sales';
insert into public.mcp_module_access (module, level) values ('finance', 'read');
reset role;
do $$ begin
  if (select updated_by from public.mcp_module_access where module = 'sales') <> '00000000-0000-0000-0000-0000000007a1' then
    raise exception 'FAIL: who changed the rights is kept';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Meetings: status with a note, and the fee
-- ---------------------------------------------------------------------------

select pg_temp.service();
set local role service_role;
-- The intern (sales, not admin) may mark it held, not approve or change the fee.
select public.sales_update_meeting('00000000-0000-0000-0000-0000000007e1', 'held', null, 'Good call, they want two developers',
  '00000000-0000-0000-0000-0000000007a2');
select pg_temp.fails($$select public.sales_update_meeting('00000000-0000-0000-0000-0000000007e1', 'approved', null, null, '00000000-0000-0000-0000-0000000007a2')$$,
  'approving by a non-admin');
select pg_temp.fails($$select public.sales_update_meeting('00000000-0000-0000-0000-0000000007e1', null, 120, null, '00000000-0000-0000-0000-0000000007a2')$$,
  'a fee by a non-admin');
-- Julius approves and sets the fee.
select public.sales_update_meeting('00000000-0000-0000-0000-0000000007e1', 'approved', 120, 'Approved after the call', '00000000-0000-0000-0000-0000000007a1');
reset role;
do $$ begin
  if (select status from public.meetings where id = '00000000-0000-0000-0000-0000000007e1') <> 'approved'
     or (select fee from public.meetings where id = '00000000-0000-0000-0000-0000000007e1') <> 120 then
    raise exception 'FAIL: status and fee are saved';
  end if;
  if (select decided_by from public.meetings where id = '00000000-0000-0000-0000-0000000007e1') <> '00000000-0000-0000-0000-0000000007a1' then
    raise exception 'FAIL: who approved is kept';
  end if;
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000007d1') is distinct from 'meeting_held' then
    raise exception 'FAIL: the company follows the meeting, as in the portal (got %)',
      (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000007d1');
  end if;
  if not exists (select 1 from public.activities where meeting_id = '00000000-0000-0000-0000-0000000007e1'
                 and outcome = 'meeting_held' and notes = 'Good call, they want two developers' and source = 'claude') then
    raise exception 'FAIL: the note is on the activity of the status change, with source claude';
  end if;
  if (select notes from public.meetings where id = '00000000-0000-0000-0000-0000000007e1') not like '%Approved after the call%' then
    raise exception 'FAIL: notes are kept on the meeting';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Work tasks per project
-- ---------------------------------------------------------------------------

select pg_temp.service();
set local role service_role;
do $$
declare
  v_inbox uuid := public.work_ensure_inbox('00000000-0000-0000-0000-0000000007a1');
  v_task uuid;
begin
  v_task := public.work_create_task(v_inbox, 'Dump', p_assignees => array['00000000-0000-0000-0000-0000000007a1'::uuid],
    p_actor => '00000000-0000-0000-0000-0000000007a1');
  if (select count(*) from public.work_api_record_tasks('00000000-0000-0000-0000-0000000007a1', p_project => v_inbox)) <> 1 then
    raise exception 'FAIL: tasks of one project';
  end if;
  if (select count(*) from public.work_api_record_tasks('00000000-0000-0000-0000-0000000007a2', p_project => v_inbox)) <> 0 then
    raise exception 'FAIL: someone else''s inbox stays closed';
  end if;
end $$;
reset role;

rollback;

\echo 'mcp claude tests passed'
