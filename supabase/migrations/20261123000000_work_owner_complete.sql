-- Owners finish their own tasks (feedback Julius, docs/work.md "Statussen en review").
--
-- Before, only the reviewer or a workspace admin could mark a task as done,
-- so an owner always had to send it to review. Now the owner chooses: finish
-- it directly, or send it to review. From Review the reviewer still decides
-- (Approve or Send back); an owner who finished a task directly can open it
-- again (with a comment, as before).
-- Same signature as 20261117000000_work_offline.sql. Safe to run again.

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
  v_is_owner boolean := exists (
    select 1 from public.work_task_assignees where task_id = p_task and user_id = v_uid
  );
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

  if p_status = 'done' and not (
    v_is_reviewer or v_is_admin or (v_is_owner and v_task.status in ('todo', 'in_progress'))
  ) then
    raise exception 'Only an owner, the reviewer or an admin can mark this task as done' using errcode = '42501';
  end if;
  if v_task.status = 'done' and not (v_is_reviewer or v_is_admin or v_is_owner) then
    raise exception 'Only an owner, the reviewer or an admin can reopen a finished task' using errcode = '42501';
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
    for v_user in select user_id from public.work_task_assignees where task_id = p_task and user_id <> v_uid loop
      perform work_private.notify(v_user, 'returned', v_task.workspace_id, v_task.project_id, p_task, v_uid,
        jsonb_build_object('title', v_task.title, 'comment', left(v_comment, 280)));
    end loop;
  end if;
end;
$$;

revoke execute on function public.work_set_status(uuid, text, text, uuid, timestamptz) from public, anon;
grant execute on function public.work_set_status(uuid, text, text, uuid, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
