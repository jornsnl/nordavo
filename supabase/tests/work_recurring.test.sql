-- Repeating tasks of Work (migration 20261124600000_work_recurring.sql): the
-- next deadline, the rules on setting a repeat, and the next task made when
-- one is done (once, with owners and the record link).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/work_recurring.test.sql
--
-- One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'julius@nordavo.nl', '{"full_name": "Julius"}');
update public.profiles set role = 'admin' where email = 'julius@nordavo.nl';

create function pg_temp.act(p_user uuid) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

-- 1. The next deadline (Europe/Amsterdam; the wall clock time stays the same).
do $$
declare
  v timestamptz;
begin
  -- Daily: tomorrow, same time.
  v := work_private.next_due('2026-11-16 16:00+01', 'daily', 1, '2026-11-16 10:00+01');
  if v <> '2026-11-17 16:00+01' then raise exception 'FAIL: daily gave %', v; end if;

  -- Done late: the next one is after the moment it was finished, not a pile of old ones.
  v := work_private.next_due('2026-11-01 16:00+01', 'daily', 1, '2026-11-16 10:00+01');
  if v <> '2026-11-16 16:00+01' then raise exception 'FAIL: late daily gave %', v; end if;

  -- Workdays skip the weekend (Fri 20 Nov 2026 -> Mon 23 Nov).
  v := work_private.next_due('2026-11-20 09:00+01', 'weekdays', 1, '2026-11-20 08:00+01');
  if v <> '2026-11-23 09:00+01' then raise exception 'FAIL: weekdays gave %', v; end if;

  -- Weekly keeps the weekday, every 2 weeks.
  v := work_private.next_due('2026-11-16 09:00+01', 'weekly', 2, '2026-11-16 10:00+01');
  if v <> '2026-11-30 09:00+01' then raise exception 'FAIL: weekly gave %', v; end if;

  -- Monthly keeps the day; the 31st falls back to the end of a short month, and returns.
  v := work_private.next_due('2026-01-31 09:00+01', 'monthly', 1, '2026-01-31 10:00+01');
  if v <> '2026-02-28 09:00+01' then raise exception 'FAIL: monthly Jan 31 gave %', v; end if;
  v := work_private.next_due('2026-01-31 09:00+01', 'monthly', 1, '2026-03-01 10:00+01');
  if v <> '2026-03-31 09:00+02' then raise exception 'FAIL: monthly Mar 31 gave % (summer time: 09:00 stays 09:00)', v; end if;

  -- Summer time: 09:00 on the wall clock stays 09:00.
  v := work_private.next_due('2026-03-27 09:00+01', 'weekly', 1, '2026-03-27 10:00+01');
  if v <> '2026-04-03 09:00+02' then raise exception 'FAIL: dst weekly gave %', v; end if;
end $$;

-- 2. Setting a repeat, and finishing the task.
select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;

do $$
declare
  v_ws uuid;
  v_project uuid;
  v_task uuid;
  v_sub uuid;
  v_next uuid;
  v_row public.work_tasks;
  v_count integer;
begin
  v_ws := public.work_create_workspace('Recurring test', 'recurring-test');
  v_project := public.work_create_project(v_ws, 'Main');

  v_task := public.work_create_task(v_project, 'Weekly report', p_priority => 'high');

  -- A repeat needs a deadline.
  begin
    perform public.work_update_task(v_task, jsonb_build_object('recurrence', 'weekly'));
    raise exception 'FAIL: a repeat without a deadline should be refused';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- Unknown rules are refused.
  begin
    perform public.work_update_task(v_task, jsonb_build_object('due_at', '2026-11-16T09:00:00+01:00', 'recurrence', 'yearly'));
    raise exception 'FAIL: an unknown rule should be refused';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- Deadline and rule in one call.
  perform public.work_update_task(v_task, jsonb_build_object(
    'due_at', '2026-11-16T09:00:00+01:00', 'recurrence', 'weekly', 'recurrence_every', 1));
  select * into v_row from public.work_tasks where id = v_task;
  if v_row.recurrence <> 'weekly' then raise exception 'FAIL: rule not saved'; end if;

  -- The deadline cannot go while it repeats.
  begin
    perform public.work_update_task(v_task, jsonb_build_object('due_at', null));
    raise exception 'FAIL: removing the deadline of a repeating task should be refused';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- A subtask cannot repeat.
  v_sub := public.work_create_task(v_project, 'Sub', p_due_at => '2026-11-20T09:00:00+01:00', p_parent => v_task);
  begin
    perform public.work_update_task(v_sub, jsonb_build_object('recurrence', 'daily'));
    raise exception 'FAIL: a subtask cannot repeat';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- Done makes the next one, once.
  perform public.work_set_status(v_task, 'done');
  select * into v_row from public.work_tasks where id = v_task;
  v_next := v_row.recurrence_next_id;
  if v_next is null then raise exception 'FAIL: no next task made'; end if;
  select * into v_row from public.work_tasks where id = v_next;
  if v_row.status <> 'todo' or v_row.title <> 'Weekly report' or v_row.priority <> 'high' or v_row.recurrence <> 'weekly' then
    raise exception 'FAIL: the next task should be a To do copy that repeats, got % / % / %', v_row.status, v_row.title, v_row.recurrence;
  end if;
  if v_row.due_at <= now() then raise exception 'FAIL: the next deadline should be in the future'; end if;
  if (v_row.due_at at time zone 'Europe/Amsterdam')::time <> time '09:00' or extract(isodow from v_row.due_at at time zone 'Europe/Amsterdam') <> 1 then
    raise exception 'FAIL: the next deadline should be a Monday at 09:00, got %', v_row.due_at;
  end if;

  -- Opening it again and finishing it again makes no second copy.
  perform public.work_set_status(v_task, 'todo', 'Not finished after all');
  perform public.work_set_status(v_task, 'done');
  select count(*) into v_count from public.work_tasks where title = 'Weekly report' and workspace_id = v_ws;
  if v_count <> 2 then raise exception 'FAIL: expected 2 tasks, got %', v_count; end if;

  -- Stopping the repeat: done makes nothing.
  perform public.work_update_task(v_next, jsonb_build_object('recurrence', ''));
  perform public.work_set_status(v_next, 'done');
  select count(*) into v_count from public.work_tasks where title = 'Weekly report' and workspace_id = v_ws;
  if v_count <> 2 then raise exception 'FAIL: a task that does not repeat made a copy'; end if;
end $$;

rollback;
