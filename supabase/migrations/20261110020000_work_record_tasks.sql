-- Tasks and Work merged into one, part 2: the write and read paths the
-- portal needs on top of 20261110000000_work_records.sql.
--
--   * work_close_record_tasks   automatic follow up on a record (a placement
--                               check-in closes its open check-in tasks). The
--                               portal team with the module of that record may
--                               do this, also when they are not the reviewer:
--                               it is the portal closing its own follow up
--                               tasks, not a person approving work.
--   * work_api_record_tasks     the task list of the portal MCP (secret key),
--                               with the filters the old portal tasks had: the
--                               rights of the token owner apply, as in
--                               work_api_list_tasks.

-- ---------------------------------------------------------------------------
-- 1. Close the open follow up tasks of a record
-- ---------------------------------------------------------------------------

create or replace function public.work_close_record_tasks(
  p_entity_type text,
  p_entity_id uuid,
  p_titles text[],
  p_due_before timestamptz default null,
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_count integer;
begin
  if not work_private.can_link(v_uid, p_entity_type) then
    raise exception 'You cannot change the tasks of this kind of record' using errcode = '42501';
  end if;

  update public.work_tasks t
  set status = 'done',
      completed_at = now()
  from public.work_task_links l
  where l.task_id = t.id
    and l.entity_type = p_entity_type
    and l.entity_id = p_entity_id
    and t.archived_at is null
    and t.status in ('todo', 'in_progress', 'review')
    and t.title = any (coalesce(p_titles, '{}'))
    and (p_due_before is null or (t.due_at is not null and t.due_at <= p_due_before))
    and work_private.can_view_task(t.id, v_uid);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.work_close_record_tasks(text, uuid, text[], timestamptz, uuid) from public, anon;
grant execute on function public.work_close_record_tasks(text, uuid, text[], timestamptz, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The task list of the portal MCP
-- ---------------------------------------------------------------------------

create or replace function public.work_api_record_tasks(
  p_user uuid,
  p_assignee uuid default null,
  p_statuses text[] default null,
  p_due_from timestamptz default null,
  p_due_to timestamptz default null,
  p_no_due boolean default false,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_limit int default 25,
  p_offset int default 0
)
returns setof public.work_tasks
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_entity_type is not null and not work_private.can_link(p_user, p_entity_type) then
    raise exception 'You cannot see the tasks of this kind of record' using errcode = '42501';
  end if;
  return query
    select t.*
    from public.work_tasks t
    where t.archived_at is null
      and (p_statuses is null or t.status = any (p_statuses))
      and (p_assignee is null or exists (
        select 1 from public.work_task_assignees a where a.task_id = t.id and a.user_id = p_assignee))
      and (not coalesce(p_no_due, false) or t.due_at is null)
      and (p_due_from is null or t.due_at >= p_due_from)
      and (p_due_to is null or t.due_at < p_due_to)
      and (p_entity_type is null or exists (
        select 1 from public.work_task_links l
        where l.task_id = t.id and l.entity_type = p_entity_type and l.entity_id = p_entity_id))
      and work_private.can_view_task(t.id, p_user)
    order by t.due_at nulls last, t.created_at
    limit least(greatest(coalesce(p_limit, 25), 1), 101)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.work_api_record_tasks(uuid, uuid, text[], timestamptz, timestamptz, boolean, text, uuid, int, int)
  from public, anon, authenticated;
grant execute on function public.work_api_record_tasks(uuid, uuid, text[], timestamptz, timestamptz, boolean, text, uuid, int, int)
  to service_role;
