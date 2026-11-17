-- Repeating tasks in Work (feedback Julius: "terugkerende taken").
-- See docs/work.md, "Terugkerende taken".
--
-- A task can repeat: every day, every workday, every week or every month
-- (with an interval: every 2 weeks). The rule hangs on the deadline: weekly
-- repeats on the weekday of the deadline, monthly on its day of the month
-- (the 31st falls back to the last day of a shorter month).
--
-- When a repeating task is marked as done, the next one is made at once: same
-- title, description, priority, owners, reviewer, type, labels, estimate, project
-- and linked record, status To do, and the next deadline AFTER the moment it was
-- finished (a task finished three weeks late does not leave a pile of overdue
-- copies). The finished task keeps its rule and points at the next one
-- (recurrence_next_id), so reopening and finishing it again makes no second copy.
-- Subtasks are not copied. Only top-level tasks can repeat, and they need a deadline.
--
-- Writes stay with the work_* functions: work_update_task takes `recurrence`
-- (daily, weekdays, weekly, monthly or '' to stop) and `recurrence_every`.
-- NOT executed anywhere yet: run it through the Supabase MCP after review.
-- Safe to run again.

alter table public.work_tasks
  add column if not exists recurrence text,
  add column if not exists recurrence_every smallint not null default 1,
  add column if not exists recurrence_next_id uuid references public.work_tasks (id) on delete set null;

alter table public.work_tasks drop constraint if exists work_tasks_recurrence_check;
alter table public.work_tasks add constraint work_tasks_recurrence_check check (
  (recurrence is null or recurrence in ('daily', 'weekdays', 'weekly', 'monthly'))
  and recurrence_every between 1 and 52
  and (recurrence is null or (due_at is not null and parent_id is null))
);

-- ---------------------------------------------------------------------------
-- The next deadline: the first occurrence after `p_after`, in the time zone of
-- the person (the wall clock time stays the same through summer and winter time).
-- ---------------------------------------------------------------------------

create or replace function work_private.next_due(
  p_due timestamptz,
  p_freq text,
  p_every integer,
  p_after timestamptz,
  p_tz text default 'Europe/Amsterdam'
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_due at time zone p_tz;
  v_day integer := extract(day from p_due at time zone p_tz)::integer;
  v_month_start date;
  v_candidate timestamp := v_local;
  v_every integer := greatest(coalesce(p_every, 1), 1);
  v_step integer := 0;
begin
  loop
    v_step := v_step + 1;
    if v_step > 5000 then
      raise exception 'Could not work out the next deadline';
    end if;
    if p_freq = 'daily' then
      v_candidate := v_candidate + make_interval(days => v_every);
    elsif p_freq = 'weekdays' then
      v_candidate := v_candidate + interval '1 day';
      while extract(isodow from v_candidate) > 5 loop
        v_candidate := v_candidate + interval '1 day';
      end loop;
    elsif p_freq = 'weekly' then
      v_candidate := v_candidate + make_interval(weeks => v_every);
    elsif p_freq = 'monthly' then
      -- Counted from the original day, so Jan 31 gives Feb 28 and then Mar 31 again.
      v_month_start := (date_trunc('month', v_local) + make_interval(months => v_every * v_step))::date;
      v_candidate := (v_month_start
        + (least(v_day, extract(day from (v_month_start + interval '1 month - 1 day'))::integer) - 1))::timestamp
        + (v_local::time);
    else
      raise exception 'Unknown repeat rule';
    end if;
    exit when (v_candidate at time zone p_tz) > p_after;
  end loop;
  return v_candidate at time zone p_tz;
end;
$$;

-- ---------------------------------------------------------------------------
-- work_update_task: the two new keys (rest as in 20261118000000_work_planning.sql).
-- ---------------------------------------------------------------------------

create or replace function public.work_update_task(p_task uuid, p_fields jsonb, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_task public.work_tasks := work_private.editable_task(p_task, v_uid);
  v_reviewer uuid;
  v_estimate integer;
  v_recurrence text := v_task.recurrence;
  v_every smallint := v_task.recurrence_every;
  v_due timestamptz := v_task.due_at;
begin
  if p_fields ? 'reviewer_id' then
    v_reviewer := nullif(p_fields ->> 'reviewer_id', '')::uuid;
    if v_reviewer is null then
      raise exception 'A task needs a reviewer';
    end if;
    perform work_private.require_project_people(v_task.project_id, array[v_reviewer]);
  end if;
  if p_fields ? 'title' and coalesce(trim(p_fields ->> 'title'), '') = '' then
    raise exception 'A task needs a title';
  end if;
  if p_fields ? 'estimate_minutes' then
    v_estimate := nullif(p_fields ->> 'estimate_minutes', '')::integer;
    if v_estimate is not null and v_estimate not between 1 and 60000 then
      raise exception 'An estimate is between 1 minute and 1000 hours';
    end if;
  end if;
  if p_fields ? 'due_at' then
    v_due := nullif(p_fields ->> 'due_at', '')::timestamptz;
  end if;
  if p_fields ? 'recurrence' then
    v_recurrence := nullif(p_fields ->> 'recurrence', '');
    if v_recurrence is not null and v_recurrence not in ('daily', 'weekdays', 'weekly', 'monthly') then
      raise exception 'Choose daily, weekdays, weekly or monthly';
    end if;
  end if;
  if p_fields ? 'recurrence_every' then
    v_every := coalesce(nullif(p_fields ->> 'recurrence_every', '')::integer, 1);
    if v_every not between 1 and 52 then
      raise exception 'Repeat every 1 to 52 days, weeks or months';
    end if;
  end if;
  if v_recurrence is not null then
    if v_task.parent_id is not null then
      raise exception 'Only a task, not a subtask, can repeat';
    end if;
    if v_due is null then
      raise exception 'A repeating task needs a deadline';
    end if;
  end if;

  update public.work_tasks
  set title = case when p_fields ? 'title' then trim(p_fields ->> 'title') else title end,
      description = case when p_fields ? 'description' then nullif(trim(p_fields ->> 'description'), '') else description end,
      priority = case when p_fields ? 'priority' then p_fields ->> 'priority' else priority end,
      due_at = case when p_fields ? 'due_at' then v_due else due_at end,
      reviewer_id = case when p_fields ? 'reviewer_id' then v_reviewer else reviewer_id end,
      task_type = case when p_fields ? 'task_type' then nullif(p_fields ->> 'task_type', '') else task_type end,
      labels = case when p_fields ? 'labels' then work_private.clean_labels(p_fields -> 'labels') else labels end,
      start_on = case when p_fields ? 'start_on' then nullif(p_fields ->> 'start_on', '')::date else start_on end,
      estimate_minutes = case when p_fields ? 'estimate_minutes' then v_estimate else estimate_minutes end,
      recurrence = case when p_fields ? 'recurrence' then v_recurrence else recurrence end,
      recurrence_every = case when p_fields ? 'recurrence_every' then v_every else recurrence_every end
  where id = p_task;

  -- A new reviewer of a task that already waits for review hears about it.
  if p_fields ? 'reviewer_id' and v_task.status = 'review' and v_reviewer is distinct from v_task.reviewer_id then
    perform work_private.notify(v_reviewer, 'review', v_task.workspace_id, v_task.project_id, p_task, v_uid,
      jsonb_build_object('title', v_task.title));
  end if;
end;
$$;

revoke execute on function public.work_update_task(uuid, jsonb, uuid) from public, anon;
grant execute on function public.work_update_task(uuid, jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Finishing a repeating task makes the next one.
-- ---------------------------------------------------------------------------

create or replace function work_private.spawn_next_recurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_due timestamptz;
  v_new uuid;
  v_start date;
begin
  select coalesce(max(pr.time_zone), 'Europe/Amsterdam') into v_tz
  from public.work_task_assignees a
  join public.profiles pr on pr.id = a.user_id
  where a.task_id = new.id;
  v_tz := coalesce(v_tz, 'Europe/Amsterdam');

  v_due := work_private.next_due(new.due_at, new.recurrence, new.recurrence_every::integer,
    coalesce(new.completed_at, now()), v_tz);
  v_start := case when new.start_on is null then null
    else new.start_on + ((v_due at time zone v_tz)::date - (new.due_at at time zone v_tz)::date) end;

  insert into public.work_tasks (workspace_id, project_id, title, description, priority, due_at, created_by,
    reviewer_id, position, task_type, labels, start_on, estimate_minutes, recurrence, recurrence_every)
  values (new.workspace_id, new.project_id, new.title, new.description, new.priority, v_due, new.created_by,
    new.reviewer_id, extract(epoch from now()), new.task_type, new.labels, v_start, new.estimate_minutes,
    new.recurrence, new.recurrence_every)
  returning id into v_new;

  insert into public.work_task_assignees (task_id, user_id, assigned_by)
  select v_new, user_id, assigned_by from public.work_task_assignees where task_id = new.id;

  insert into public.work_task_links (task_id, entity_type, entity_id, created_by)
  select v_new, entity_type, entity_id, created_by from public.work_task_links where task_id = new.id;

  update public.work_tasks set recurrence_next_id = v_new where id = new.id;
  return null;
end;
$$;

drop trigger if exists work_tasks_spawn_next on public.work_tasks;
create trigger work_tasks_spawn_next
  after update of status on public.work_tasks
  for each row
  when (new.status = 'done' and old.status is distinct from 'done'
    and new.recurrence is not null and new.recurrence_next_id is null
    and new.due_at is not null and new.archived_at is null)
  execute function work_private.spawn_next_recurrence();

notify pgrst, 'reload schema';
