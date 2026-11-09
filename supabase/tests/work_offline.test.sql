-- Offline sync of Work (migration 20261117000000_work_offline.sql): a create
-- with the device's id is idempotent, and the moment of an offline action
-- counts when it is recent and not in the future.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/work_offline.test.sql
--
-- One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'eva@nordavo.nl', '{"full_name": "Eva"}'),
  ('00000000-0000-0000-0000-0000000000f2', 'tom@nordavo.nl', '{"full_name": "Tom"}');
update public.profiles set role = 'admin' where email = 'eva@nordavo.nl';
update public.profiles set role = 'member' where email = 'tom@nordavo.nl';

create temporary table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;

create function pg_temp.act(p_user uuid) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000000f1');

do $$
declare
  v_ws uuid := public.work_create_workspace('Offline test', 'offline-test');
  v_project uuid;
begin
  v_project := public.work_create_project(v_ws, 'Phone');
  insert into ids values ('project', v_project);
end $$;

-- The same create twice (a retry after a time out) makes one task.
do $$
declare
  v_project uuid := (select id from ids where name = 'project');
  v_id uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_first uuid;
  v_second uuid;
begin
  v_first := public.work_create_task(v_project, 'Made on the train', p_id => v_id);
  v_second := public.work_create_task(v_project, 'Made on the train', p_id => v_id);
  if v_first <> v_id or v_second <> v_id then
    raise exception 'FAIL: the device id should be the task id (got % and %)', v_first, v_second;
  end if;
  if (select count(*) from public.work_tasks where title = 'Made on the train') <> 1 then
    raise exception 'FAIL: a repeated create should not make a second task';
  end if;
  -- Without an id it still works as before.
  if public.work_create_task(v_project, 'Online task') is null then
    raise exception 'FAIL: a create without id should return a new id';
  end if;
end $$;

-- A finished task keeps the moment it was finished on the device.
do $$
declare
  v_project uuid := (select id from ids where name = 'project');
  v_task uuid;
  v_at timestamptz := now() - interval '3 hours';
  v_done timestamptz;
begin
  v_task := public.work_create_task(v_project, 'Done offline');
  perform public.work_set_status(v_task, 'done', p_at => v_at);
  select completed_at into v_done from public.work_tasks where id = v_task;
  if v_done <> v_at then
    raise exception 'FAIL: completed_at should be the device time (% instead of %)', v_done, v_at;
  end if;

  -- In the future or older than 14 days: now.
  v_task := public.work_create_task(v_project, 'Clock ahead');
  perform public.work_set_status(v_task, 'done', p_at => now() + interval '1 hour');
  if (select completed_at from public.work_tasks where id = v_task) <> now() then
    raise exception 'FAIL: a moment in the future should become now';
  end if;
  v_task := public.work_create_task(v_project, 'Too old');
  perform public.work_set_status(v_task, 'done', p_at => now() - interval '15 days');
  if (select completed_at from public.work_tasks where id = v_task) <> now() then
    raise exception 'FAIL: a moment older than 14 days should become now';
  end if;

  -- A quick log made offline is done at the device time too.
  v_task := public.work_create_task(v_project, 'Logged on the train', p_status => 'done', p_is_log => true, p_at => v_at);
  if (select completed_at from public.work_tasks where id = v_task) <> v_at then
    raise exception 'FAIL: a log created offline should keep the device time';
  end if;

  -- The review rules still hold: back from Done needs a comment.
  begin
    perform public.work_set_status(v_task, 'todo', p_at => v_at);
    raise exception 'FAIL: reopening without a comment should be refused';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

-- Someone else cannot take over a task by sending its id.
select pg_temp.act('00000000-0000-0000-0000-0000000000f2');
do $$
begin
  perform public.work_create_task((select id from ids where name = 'project'), 'Hijack', p_id => 'aaaaaaaa-0000-4000-8000-000000000001');
  raise exception 'FAIL: an id of someone else''s task should be refused';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

reset role;
select 'work offline tests passed' as result;
rollback;
