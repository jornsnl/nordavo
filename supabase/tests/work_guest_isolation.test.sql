-- People invited into Work (guests and members of a workspace) never reach the
-- Nordavo portal: not its clients, candidates, leads or vacancies, and not
-- another workspace. Run against a database with every migration applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/work_guest_isolation.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@nordavo.test', '{"full_name": "Admin"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'guest@freelance.test', '{"full_name": "Guest"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'member@freelance.test', '{"full_name": "Member"}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;

-- Portal data, one row in each table a freelancer must never see.
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Secret client');
insert into public.candidates (id, full_name) values ('00000000-0000-0000-0000-0000000000c2', 'Secret candidate');
insert into public.vacancies (id, title, client_id) values ('00000000-0000-0000-0000-0000000000c3', 'Secret vacancy', '00000000-0000-0000-0000-0000000000c1');
insert into public.companies (id, name, domain) values ('00000000-0000-0000-0000-0000000000c4', 'Secret lead', 'secret.test');
insert into public.contacts (company_id) values ('00000000-0000-0000-0000-0000000000c4');
insert into public.notes (entity_type, entity_id, body) values ('client', '00000000-0000-0000-0000-0000000000c1', 'Secret note');
insert into public.applications (vacancy_id, candidate_id) values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c2');
insert into public.placements (candidate_id, client_id, start_date) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1', current_date);

-- Two workspaces. The guest gets one project in "Freelance", the member the
-- whole of "Freelance"; neither is in "Internal".
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values ('freelance', public.work_create_workspace('Freelance', 'freelance'));
insert into ids values ('internal', public.work_create_workspace('Internal', 'internal'));
insert into ids select 'job', public.work_create_project((select id from ids where name = 'freelance'), 'Job', null, 'private', false);
insert into ids select 'other', public.work_create_project((select id from ids where name = 'freelance'), 'Other', null, 'private', false);
insert into ids select 'hidden', public.work_create_project((select id from ids where name = 'internal'), 'Hidden', null, 'open', false);
reset role;
insert into public.work_members (workspace_id, user_id, role) values
  ((select id from ids where name = 'freelance'), '00000000-0000-0000-0000-0000000000a2', 'guest'),
  ((select id from ids where name = 'freelance'), '00000000-0000-0000-0000-0000000000a3', 'member');
set local role authenticated;
select public.work_add_project_member((select id from ids where name = 'job'), '00000000-0000-0000-0000-0000000000a2', null);
-- A task in the guest's project that hangs on a client (tasks merged into Work).
insert into ids select 'linked', public.work_create_record_task(
  'client', '00000000-0000-0000-0000-0000000000c1', 'Prepare intake', null, 'high', null,
  array['00000000-0000-0000-0000-0000000000a2'::uuid], (select id from ids where name = 'job'));
reset role;

-- Being invited into Work never gives portal access.
do $$ begin
  if exists (select 1 from public.profiles where id in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3') and role <> 'external') then
    raise exception 'FAIL: Work people should stay external in the portal';
  end if;
end $$;

-- For each of them: every portal table looks empty, and portal functions refuse.
create function pg_temp.assert_no_portal(p_who text) returns void language plpgsql as $$
declare
  t text;
  n bigint;
begin
  for t in
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and c.relname not like 'work\_%'
      and c.relname not in ('profiles', 'passkeys', 'mcp_tokens', 'webauthn_challenges')
  loop
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when insufficient_privilege then
      n := 0;
    end;
    if n > 0 then
      raise exception 'FAIL: % can read % rows of portal table %', p_who, n, t;
    end if;
  end loop;
  if public.is_staff() or public.is_admin() or public.current_client_id() is not null then
    raise exception 'FAIL: % counts as portal staff or client', p_who;
  end if;
  begin
    perform public.admin_update_profile((select auth.uid()), 'admin', null);
    raise exception 'FAIL: % could change their own portal role', p_who;
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end;
$$;

grant execute on function pg_temp.act(uuid), pg_temp.assert_no_portal(text) to authenticated;
set local role authenticated;

select pg_temp.act('00000000-0000-0000-0000-0000000000a2');
select pg_temp.assert_no_portal('the guest');
do $$ begin
  -- The guest works on the task, but never sees which record it is about.
  if not exists (select 1 from public.work_tasks where id = (select id from ids where name = 'linked')) then
    raise exception 'FAIL: the guest should see the task they own';
  end if;
  if exists (select 1 from public.work_task_links) then
    raise exception 'FAIL: the guest can see which record a task is linked to';
  end if;
  begin
    perform public.work_set_task_link((select id from ids where name = 'linked'), null, null);
    raise exception 'FAIL: the guest could remove the record link';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.work_create_record_task('client', '00000000-0000-0000-0000-0000000000c1', 'Peek', null, 'normal', null,
      '{}', (select id from ids where name = 'job'));
    raise exception 'FAIL: the guest could link a task to a client';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  if (select count(*) from public.work_workspaces) <> 1 then
    raise exception 'FAIL: the guest should see only their own workspace';
  end if;
  if (select array_agg(name order by name) from public.work_projects) is distinct from array['Job'] then
    raise exception 'FAIL: the guest should see only the project they are in';
  end if;
end $$;

select pg_temp.act('00000000-0000-0000-0000-0000000000a3');
select pg_temp.assert_no_portal('the workspace member');
do $$ begin
  if exists (select 1 from public.work_task_links) then
    raise exception 'FAIL: the workspace member can see which record a task is linked to';
  end if;
  if (select array_agg(slug) from public.work_workspaces) is distinct from array['freelance'] then
    raise exception 'FAIL: the member should see only their own workspace';
  end if;
  if exists (select 1 from public.work_projects where name = 'Hidden') then
    raise exception 'FAIL: the member should not see projects of another workspace';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Follow up tasks on records (20261110020000_work_record_tasks.sql)
-- ---------------------------------------------------------------------------

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a4', 'recruiter@nordavo.test', '{"full_name": "Recruiter"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'seller@nordavo.test', '{"full_name": "Seller"}');
update public.profiles set role = 'member', modules = '{recruitment}' where id = '00000000-0000-0000-0000-0000000000a4';
update public.profiles set role = 'member', modules = '{sales}' where id = '00000000-0000-0000-0000-0000000000a5';
insert into ids select 'placement', id from public.placements limit 1;
grant execute on function pg_temp.act(uuid) to authenticated;
set local role authenticated;

-- The admin plans a check-in on the placement; the admin is its reviewer.
select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'checkin', public.work_create_record_task(
  'placement', (select id from ids where name = 'placement'), 'Client check-in', null, 'normal',
  now() + interval '2 days', array['00000000-0000-0000-0000-0000000000a4'::uuid]);
insert into ids select 'later', public.work_create_record_task(
  'placement', (select id from ids where name = 'placement'), 'Client check-in', null, 'normal',
  now() + interval '40 days', '{}');

do $$ begin
  -- The guest and a team member without recruitment cannot close them.
  perform pg_temp.act('00000000-0000-0000-0000-0000000000a2');
  begin
    perform public.work_close_record_tasks('placement', (select id from ids where name = 'placement'), array['Client check-in'], now() + interval '7 days');
    raise exception 'FAIL: the guest could close follow up tasks of a placement';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform pg_temp.act('00000000-0000-0000-0000-0000000000a5');
  begin
    perform public.work_close_record_tasks('placement', (select id from ids where name = 'placement'), array['Client check-in'], now() + interval '7 days');
    raise exception 'FAIL: a team member without recruitment could close placement tasks';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  if exists (select 1 from public.work_task_links) then
    raise exception 'FAIL: a team member without recruitment sees placement links';
  end if;

  -- A recruiter who is not the reviewer may: the check-in happened.
  perform pg_temp.act('00000000-0000-0000-0000-0000000000a4');
  if (select count(*) from public.work_task_links where entity_type = 'placement') < 2 then
    raise exception 'FAIL: the recruiter should see the placement tasks';
  end if;
  if public.work_close_record_tasks('placement', (select id from ids where name = 'placement'), array['Client check-in'], now() + interval '7 days') <> 1 then
    raise exception 'FAIL: exactly the check-in due within the week should close';
  end if;
  if (select status from public.work_tasks where id = (select id from ids where name = 'checkin')) <> 'done'
     or (select status from public.work_tasks where id = (select id from ids where name = 'later')) <> 'todo' then
    raise exception 'FAIL: the wrong check-in tasks were closed';
  end if;
  if not exists (
    select 1 from public.work_task_activity
    where task_id = (select id from ids where name = 'checkin') and actor_id = '00000000-0000-0000-0000-0000000000a4'
      and details ? 'status'
  ) then
    raise exception 'FAIL: closing should be in the task log with the recruiter as actor';
  end if;
end $$;

-- The MCP task list is for the secret key only, with the rights of p_user.
do $$ begin
  begin
    perform public.work_api_record_tasks('00000000-0000-0000-0000-0000000000a4');
    raise exception 'FAIL: signed in users could call work_api_record_tasks';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.work_api_record_tasks('00000000-0000-0000-0000-0000000000a4', null, null, null, null, false,
        'placement', (select id from ids where name = 'placement'))) <> 2 then
    raise exception 'FAIL: the recruiter should get both placement tasks';
  end if;
  if (select count(*) from public.work_api_record_tasks('00000000-0000-0000-0000-0000000000a4',
        '00000000-0000-0000-0000-0000000000a4', array['todo', 'in_progress', 'review'])) <> 0 then
    raise exception 'FAIL: the closed check-in should not be open for its owner';
  end if;
  begin
    perform public.work_api_record_tasks('00000000-0000-0000-0000-0000000000a2', null, null, null, null, false,
      'client', '00000000-0000-0000-0000-0000000000c1');
    raise exception 'FAIL: a guest could list tasks by client';
  exception when insufficient_privilege then
    null;
  end;
  -- Without a record filter the guest gets only the tasks they can open, never placement tasks.
  if exists (select 1 from public.work_api_record_tasks('00000000-0000-0000-0000-0000000000a2') t
             where t.id in (select id from ids where name in ('checkin', 'later'))) then
    raise exception 'FAIL: the guest sees tasks of the records project';
  end if;
end $$;

-- Deleting the placement deletes its Work tasks (trigger placements_work_tasks).
delete from public.placements where id = (select id from ids where name = 'placement');
do $$ begin
  if exists (select 1 from public.work_tasks where id in (select id from ids where name in ('checkin', 'later'))) then
    raise exception 'FAIL: tasks of a deleted placement should go with it';
  end if;
end $$;

reset role;
rollback;

\echo 'work guest isolation tests passed'
