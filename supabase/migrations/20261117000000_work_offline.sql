-- Offline sync for Work (docs/work.md, "Offline").
--
-- A phone without a connection keeps its changes in an outbox and sends them
-- later, through the same server actions and these same functions, so the
-- rules, the activity log and the notifications stay as they are. Two things
-- change:
--   * work_create_task takes the id the device chose (crypto.randomUUID), so
--     a create sent twice makes one task (p_id).
--   * work_create_task and work_set_status take when it happened on the
--     device (p_at): a task finished offline at 10:05 is done at 10:05. Only
--     a moment that is not in the future and at most 14 days old counts;
--     anything else is now.
-- Safe to run again.

create or replace function work_private.client_time(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_at is not null and p_at <= now() and p_at >= now() - interval '14 days' then p_at
    else now()
  end;
$$;

revoke all on function work_private.client_time(timestamptz) from public;

-- New parameters at the end, so existing calls (positional ones too) keep working.
drop function if exists public.work_create_task(uuid, text, text, text, timestamptz, uuid, uuid[], uuid, text, boolean, uuid);
drop function if exists public.work_set_status(uuid, text, text, uuid);

create or replace function public.work_create_task(
  p_project uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null,
  p_reviewer uuid default null,
  p_assignees uuid[] default '{}',
  p_parent uuid default null,
  p_status text default 'todo',
  p_is_log boolean default false,
  p_actor uuid default null,
  p_id uuid default null,
  p_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_project public.work_projects;
  v_parent public.work_tasks;
  v_reviewer uuid := coalesce(p_reviewer, v_uid);
  v_id uuid;
  v_user uuid;
  v_title text;
  v_existing public.work_tasks;
begin
  -- Idempotent with an id the device chose (offline sync): the same create
  -- sent twice (a retry after a time out) returns the task it made the first
  -- time. Someone else's id is refused.
  if p_id is not null then
    select * into v_existing from public.work_tasks where id = p_id;
    if v_existing.id is not null then
      if v_existing.created_by is distinct from v_uid then
        raise exception 'This task id is already taken' using errcode = '23505';
      end if;
      return v_existing.id;
    end if;
  end if;

  select * into v_project from public.work_projects where id = p_project;
  if v_project.id is null or not work_private.can_view_project(p_project, v_uid) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_project.archived_at is not null then
    raise exception 'This project is archived';
  end if;
  if p_status not in ('todo', 'in_progress', 'done') then
    raise exception 'New tasks start as To do, In progress or Done';
  end if;
  if p_status = 'done' and v_reviewer <> v_uid
     and work_private.role_in(v_project.workspace_id, v_uid) is distinct from 'admin' then
    raise exception 'Only the reviewer can mark a task as done';
  end if;
  if p_parent is not null then
    v_parent := work_private.editable_task(p_parent, v_uid);
    if v_parent.parent_id is not null then
      raise exception 'Subtasks cannot have subtasks of their own';
    end if;
    if v_parent.project_id <> p_project then
      raise exception 'A subtask lives in the same project as its parent';
    end if;
  end if;
  perform work_private.require_project_people(p_project, array_append(coalesce(p_assignees, '{}'), v_reviewer));

  v_title := trim(p_title);
  insert into public.work_tasks (
    id, workspace_id, project_id, parent_id, title, description, status, priority, due_at,
    created_by, reviewer_id, is_log, position, completed_at
  ) values (
    coalesce(p_id, pg_catalog.gen_random_uuid()), v_project.workspace_id, p_project, p_parent, v_title, nullif(trim(p_description), ''), p_status,
    coalesce(p_priority, 'normal'), p_due_at, v_uid, v_reviewer, coalesce(p_is_log, false),
    extract(epoch from now()), case when p_status = 'done' then work_private.client_time(p_at) end
  )
  returning id into v_id;

  foreach v_user in array coalesce(p_assignees, '{}') loop
    insert into public.work_task_assignees (task_id, user_id, assigned_by)
    values (v_id, v_user, v_uid)
    on conflict do nothing;
    if p_status <> 'done' then
      perform work_private.notify(v_user, 'assigned', v_project.workspace_id, p_project, v_id, v_uid,
        jsonb_build_object('title', v_title));
    end if;
  end loop;
  return v_id;
end;
$$;

create or replace function public.work_set_status(
  p_task uuid,
  p_status text,
  p_comment text default null,
  p_actor uuid default null,
  p_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_task public.work_tasks := work_private.editable_task(p_task, v_uid);
  v_is_admin boolean := coalesce(work_private.role_in(v_task.workspace_id, v_uid) = 'admin', false);
  v_is_reviewer boolean := coalesce(v_task.reviewer_id = v_uid, false);
  v_comment text := nullif(trim(p_comment), '');
  v_going_back boolean;
  v_user uuid;
  v_at timestamptz := work_private.client_time(p_at);
begin
  if p_status not in ('todo', 'in_progress', 'review', 'done', 'cancelled') then
    raise exception 'Unknown status';
  end if;
  if p_status = v_task.status then
    return;
  end if;

  if p_status = 'done' and not (v_is_reviewer or v_is_admin) then
    raise exception 'Only the reviewer or an admin can mark this task as done' using errcode = '42501';
  end if;
  if v_task.status = 'done' and not (v_is_reviewer or v_is_admin) then
    raise exception 'Only the reviewer or an admin can reopen a finished task' using errcode = '42501';
  end if;
  if p_status = 'cancelled' and not (v_is_reviewer or v_is_admin or v_task.created_by = v_uid) then
    raise exception 'Only the maker, the reviewer or an admin can cancel this task' using errcode = '42501';
  end if;

  v_going_back := v_task.status in ('review', 'done') and p_status in ('todo', 'in_progress');
  if v_going_back and v_comment is null then
    raise exception 'Add a comment that says what still needs to happen';
  end if;
  if p_status = 'review' and v_task.reviewer_id is null then
    raise exception 'Pick a reviewer first';
  end if;

  update public.work_tasks
  set status = p_status,
      completed_at = case when p_status = 'done' then v_at else null end,
      review_requested_at = case when p_status = 'review' then v_at else review_requested_at end
  where id = p_task;

  if v_comment is not null then
    insert into public.work_comments (task_id, author_id, body, kind)
    values (p_task, v_uid, v_comment, case when v_going_back then 'returned' else 'comment' end);
  end if;

  if p_status = 'review' then
    perform work_private.notify(v_task.reviewer_id, 'review', v_task.workspace_id, v_task.project_id, p_task, v_uid,
      jsonb_build_object('title', v_task.title));
  elsif v_going_back then
    for v_user in select user_id from public.work_task_assignees where task_id = p_task loop
      perform work_private.notify(v_user, 'returned', v_task.workspace_id, v_task.project_id, p_task, v_uid,
        jsonb_build_object('title', v_task.title, 'comment', left(v_comment, 280)));
    end loop;
  end if;
end;
$$;

revoke execute on function public.work_create_task(uuid, text, text, text, timestamptz, uuid, uuid[], uuid, text, boolean, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.work_create_task(uuid, text, text, text, timestamptz, uuid, uuid[], uuid, text, boolean, uuid, uuid, timestamptz) to authenticated, service_role;
revoke execute on function public.work_set_status(uuid, text, text, uuid, timestamptz) from public, anon;
grant execute on function public.work_set_status(uuid, text, text, uuid, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
