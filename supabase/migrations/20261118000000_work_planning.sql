-- Planning fields for Work tasks, taken over from the task board of Athmium
-- (feedback Julius: "alle functies die Jorn heeft voor zijn takenoverzicht").
-- See docs/work.md, "Planning: type, labels, start date and estimate".
--
--   * task_type: what kind of work it is (call, programming, design, ...), so
--     someone can pick up all tasks of one kind.
--   * labels: free tags, at most 20 per task, each at most 40 characters.
--   * start_on: the day the work starts (a calendar day, no time zone). With
--     the deadline it gives the bar on the timeline.
--   * estimate_minutes: how long the work takes. A task with only one date
--     gets its other end from the estimate on the timeline.
--
-- Writes stay with the work_* functions: work_update_task takes the four new
-- keys, work_duplicate_task copies them, and the activity log records them.
-- Safe to run again.

alter table public.work_tasks
  add column if not exists task_type text,
  add column if not exists labels text[] not null default '{}',
  add column if not exists start_on date,
  add column if not exists estimate_minutes integer;

alter table public.work_tasks drop constraint if exists work_tasks_task_type_check;
alter table public.work_tasks add constraint work_tasks_task_type_check check (
  task_type is null or task_type in (
    'call', 'schedule', 'meeting', 'teams', 'brainstorm', 'programming',
    'design', 'writing', 'email', 'research', 'review', 'admin'
  )
);

alter table public.work_tasks drop constraint if exists work_tasks_labels_check;
alter table public.work_tasks add constraint work_tasks_labels_check check (cardinality(labels) <= 20);

alter table public.work_tasks drop constraint if exists work_tasks_estimate_check;
alter table public.work_tasks add constraint work_tasks_estimate_check check (
  estimate_minutes is null or estimate_minutes between 1 and 60000
);

create index if not exists work_tasks_type_idx on public.work_tasks (task_type) where archived_at is null;
create index if not exists work_tasks_labels_idx on public.work_tasks using gin (labels);
create index if not exists work_tasks_start_idx on public.work_tasks (start_on) where archived_at is null;

-- Labels as the user typed them, trimmed, without empties or doubles (case
-- does not make a different label: the first spelling stays).
create or replace function work_private.clean_labels(p_labels jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text[] := '{}';
  v_label text;
begin
  if p_labels is null or jsonb_typeof(p_labels) = 'null' then
    return '{}';
  end if;
  if jsonb_typeof(p_labels) <> 'array' then
    raise exception 'Labels are a list';
  end if;
  for v_label in select trim(value) from jsonb_array_elements_text(p_labels) loop
    continue when v_label = '';
    if char_length(v_label) > 40 then
      raise exception 'A label is at most 40 characters';
    end if;
    continue when exists (select 1 from unnest(v_out) l where lower(l) = lower(v_label));
    v_out := array_append(v_out, v_label);
  end loop;
  if cardinality(v_out) > 20 then
    raise exception 'A task has at most 20 labels';
  end if;
  return v_out;
end;
$$;

revoke all on function work_private.clean_labels(jsonb) from public;

-- Partial update: only the keys present in p_fields change.
-- Keys: title, description, priority, due_at, reviewer_id, and now also
-- task_type, labels, start_on and estimate_minutes.
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

  update public.work_tasks
  set title = case when p_fields ? 'title' then trim(p_fields ->> 'title') else title end,
      description = case when p_fields ? 'description' then nullif(trim(p_fields ->> 'description'), '') else description end,
      priority = case when p_fields ? 'priority' then p_fields ->> 'priority' else priority end,
      due_at = case when p_fields ? 'due_at' then nullif(p_fields ->> 'due_at', '')::timestamptz else due_at end,
      reviewer_id = case when p_fields ? 'reviewer_id' then v_reviewer else reviewer_id end,
      task_type = case when p_fields ? 'task_type' then nullif(p_fields ->> 'task_type', '') else task_type end,
      labels = case when p_fields ? 'labels' then work_private.clean_labels(p_fields -> 'labels') else labels end,
      start_on = case when p_fields ? 'start_on' then nullif(p_fields ->> 'start_on', '')::date else start_on end,
      estimate_minutes = case when p_fields ? 'estimate_minutes' then v_estimate else estimate_minutes end
  where id = p_task;

  -- A new reviewer of a task that already waits for review hears about it.
  if p_fields ? 'reviewer_id' and v_task.status = 'review' and v_reviewer is distinct from v_task.reviewer_id then
    perform work_private.notify(v_reviewer, 'review', v_task.workspace_id, v_task.project_id, p_task, v_uid,
      jsonb_build_object('title', v_task.title));
  end if;
end;
$$;

-- A copy keeps the planning fields too (not the dates of course: those stay
-- as they were, like the deadline).
create or replace function public.work_duplicate_task(p_task uuid, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_task public.work_tasks := work_private.editable_task(p_task, v_uid);
  v_new uuid;
  v_child public.work_tasks;
  v_child_new uuid;
begin
  if v_task.parent_id is not null then
    raise exception 'Duplicate the parent task instead';
  end if;
  insert into public.work_tasks (workspace_id, project_id, title, description, priority, due_at,
    created_by, reviewer_id, position, task_type, labels, start_on, estimate_minutes)
  values (v_task.workspace_id, v_task.project_id, left(v_task.title || ' (copy)', 300), v_task.description,
    v_task.priority, v_task.due_at, v_uid, coalesce(v_task.reviewer_id, v_uid), extract(epoch from now()),
    v_task.task_type, v_task.labels, v_task.start_on, v_task.estimate_minutes)
  returning id into v_new;
  insert into public.work_task_assignees (task_id, user_id, assigned_by)
  select v_new, user_id, v_uid from public.work_task_assignees where task_id = p_task;

  for v_child in
    select * from public.work_tasks
    where parent_id = p_task and archived_at is null and status <> 'cancelled'
    order by position, created_at
  loop
    insert into public.work_tasks (workspace_id, project_id, parent_id, title, description, priority,
      due_at, created_by, reviewer_id, position, task_type, labels, start_on, estimate_minutes)
    values (v_child.workspace_id, v_child.project_id, v_new, v_child.title, v_child.description,
      v_child.priority, v_child.due_at, v_uid, coalesce(v_child.reviewer_id, v_uid), v_child.position,
      v_child.task_type, v_child.labels, v_child.start_on, v_child.estimate_minutes)
    returning id into v_child_new;
    insert into public.work_task_assignees (task_id, user_id, assigned_by)
    select v_child_new, user_id, v_uid from public.work_task_assignees where task_id = v_child.id;
  end loop;
  return v_new;
end;
$$;

-- The activity log also records the planning fields.
create or replace function work_private.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}';
  v_key text;
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.work_task_activity (task_id, actor_id, action, details)
    values (new.id, work_private.current_actor(),
      case when new.external_source is not null then 'imported' else 'created' end,
      jsonb_build_object('status', new.status, 'title', new.title));
    return null;
  end if;

  v_new := to_jsonb(new);
  v_old := to_jsonb(old);
  foreach v_key in array array[
    'title', 'status', 'priority', 'due_at', 'reviewer_id', 'project_id', 'archived_at', 'parent_id',
    'task_type', 'labels', 'start_on', 'estimate_minutes'
  ] loop
    if (v_new -> v_key) is distinct from (v_old -> v_key) then
      v_changes := v_changes || jsonb_build_object(
        v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
    end if;
  end loop;
  -- Descriptions can be long; only record that it changed.
  if new.description is distinct from old.description then
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('changed', true));
  end if;

  if v_changes <> '{}'::jsonb then
    insert into public.work_task_activity (task_id, actor_id, action, details)
    values (new.id, work_private.current_actor(), 'updated', v_changes);
  end if;
  return null;
end;
$$;
