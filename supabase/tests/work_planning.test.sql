-- Planning fields of Work (migration 20261118000000_work_planning.sql): type,
-- labels, start date and estimate go through work_update_task with the same
-- rights as the other fields, are cleaned and checked, land in the activity
-- log and are copied by work_duplicate_task.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/work_planning.test.sql
--
-- One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'julius@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'gast@freelance.dev', '{"full_name": "Gast"}');
update public.profiles set role = 'admin' where email = 'julius@nordavo.nl';

create temporary table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;

create function pg_temp.act(p_user uuid) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

create function pg_temp.fails(p_sql text, p_what text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % should have been refused', p_what;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;
grant execute on function pg_temp.fails(text, text) to authenticated;

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000000a1');

do $$
declare
  v_ws uuid := public.work_create_workspace('Planning test', 'planning-test');
  v_open uuid;
  v_private uuid;
begin
  v_open := public.work_create_project(v_ws, 'Sales');
  v_private := public.work_create_project(v_ws, 'Board', p_visibility => 'private');
  insert into ids values ('ws', v_ws), ('project', v_open), ('private', v_private);
  insert into ids values ('task', public.work_create_task(v_open, 'Call Bright Fintech'));
  insert into ids values ('secret', public.work_create_task(v_private, 'Board pack'));
end $$;

-- Setting all four fields at once.
do $$
declare
  v_task uuid := (select id from ids where name = 'task');
  v_row public.work_tasks;
begin
  perform public.work_update_task(v_task, jsonb_build_object(
    'task_type', 'call',
    'labels', jsonb_build_array(' Sales ', 'sales', '', 'Q4'),
    'start_on', '2026-11-09',
    'estimate_minutes', 90));
  select * into v_row from public.work_tasks where id = v_task;
  if v_row.task_type <> 'call' then raise exception 'FAIL: type not saved'; end if;
  if v_row.labels <> array['Sales', 'Q4'] then
    raise exception 'FAIL: labels should be trimmed, without empties or doubles, got %', v_row.labels;
  end if;
  if v_row.start_on <> date '2026-11-09' then raise exception 'FAIL: start date not saved'; end if;
  if v_row.estimate_minutes <> 90 then raise exception 'FAIL: estimate not saved'; end if;

  -- Only the keys that are sent change.
  perform public.work_update_task(v_task, jsonb_build_object('priority', 'high'));
  select * into v_row from public.work_tasks where id = v_task;
  if v_row.task_type is distinct from 'call' or v_row.labels <> array['Sales', 'Q4'] or v_row.estimate_minutes <> 90 then
    raise exception 'FAIL: fields that were not sent should stay';
  end if;

  -- The activity log has them.
  if not exists (
    select 1 from public.work_task_activity
    where task_id = v_task and action = 'updated'
      and details ? 'task_type' and details ? 'labels' and details ? 'start_on' and details ? 'estimate_minutes'
  ) then
    raise exception 'FAIL: the activity log should record the planning fields';
  end if;

  -- Empty values clear them.
  perform public.work_update_task(v_task, jsonb_build_object('task_type', '', 'labels', '[]'::jsonb, 'start_on', null, 'estimate_minutes', null));
  select * into v_row from public.work_tasks where id = v_task;
  if v_row.task_type is not null or v_row.labels <> '{}' or v_row.start_on is not null or v_row.estimate_minutes is not null then
    raise exception 'FAIL: empty values should clear the fields';
  end if;
end $$;

-- What is refused.
select pg_temp.fails($$select public.work_update_task((select id from ids where name = 'task'), '{"task_type": "party"}')$$, 'an unknown type');
select pg_temp.fails($$select public.work_update_task((select id from ids where name = 'task'), '{"estimate_minutes": 0}')$$, 'an estimate of 0');
select pg_temp.fails($$select public.work_update_task((select id from ids where name = 'task'), '{"estimate_minutes": 60001}')$$, 'an estimate over 1000 hours');
select pg_temp.fails($$select public.work_update_task((select id from ids where name = 'task'), '{"start_on": "next week"}')$$, 'a start date that is no date');
select pg_temp.fails($$select public.work_update_task((select id from ids where name = 'task'), '{"labels": "sales"}')$$, 'labels that are no list');
select pg_temp.fails(format($$select public.work_update_task((select id from ids where name = 'task'), %L)$$,
  jsonb_build_object('labels', jsonb_build_array(repeat('x', 41)))), 'a label over 40 characters');
select pg_temp.fails(format($$select public.work_update_task((select id from ids where name = 'task'), %L)$$,
  jsonb_build_object('labels', (select jsonb_agg('l' || n) from generate_series(1, 21) n))), 'more than 20 labels');

-- Nobody writes the columns directly.
select pg_temp.fails($$update public.work_tasks set labels = '{hack}'$$, 'a direct update');

-- A copy keeps the planning fields.
do $$
declare
  v_task uuid := (select id from ids where name = 'task');
  v_copy uuid;
  v_row public.work_tasks;
begin
  perform public.work_update_task(v_task, '{"task_type": "email", "labels": ["follow-up"], "start_on": "2026-11-16", "estimate_minutes": 30}');
  v_copy := public.work_duplicate_task(v_task);
  select * into v_row from public.work_tasks where id = v_copy;
  if v_row.task_type <> 'email' or v_row.labels <> array['follow-up'] or v_row.start_on <> date '2026-11-16' or v_row.estimate_minutes <> 30 then
    raise exception 'FAIL: a copy should keep type, labels, start date and estimate';
  end if;
end $$;

-- A guest in the open project only cannot plan the private task, here or through the API.
reset role;
insert into public.work_members (workspace_id, user_id, role)
values ((select id from ids where name = 'ws'), '00000000-0000-0000-0000-0000000000a2', 'guest');
insert into public.work_project_members (project_id, user_id)
values ((select id from ids where name = 'project'), '00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000000a2');
select pg_temp.fails($$select public.work_update_task((select id from ids where name = 'secret'), '{"labels": ["mine"]}')$$, 'a guest planning a task outside his projects');
-- His own project works.
select public.work_update_task((select id from ids where name = 'task'), '{"labels": ["guest"]}');

reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', false);
select pg_temp.fails($$select public.work_update_task((select id from ids where name = 'secret'), '{"task_type": "call"}', '00000000-0000-0000-0000-0000000000a2')$$,
  'the API planning a task outside the guest''s projects');

select 'work planning tests passed' as result;

rollback;
