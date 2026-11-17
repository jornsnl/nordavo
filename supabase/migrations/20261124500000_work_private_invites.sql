-- Invite people into a private workspace (feedback Julius, 16 November 2026).
--
-- Before: a private workspace was only for its owner; the triggers of
-- 20261121000000 refused every invite, member and assignee. Now the owner can
-- invite people (a VA, for example) into their private workspace or a project
-- in it. The workspace stays private for everyone else: only the owner and
-- the people the owner invited are in it, other portal admins included
-- (visibility in Work is membership, never the portal role).
--
-- Rules for kind = 'private':
--  * only the owner invites, and nobody else becomes admin (the owner keeps
--    control: archive, roles, access);
--  * members, project members and invites for others are allowed;
--  * tasks and reviews can go to the owner and to active members.
-- The inbox (kind = 'inbox') stays strictly personal: nobody else gets in.
--
-- Not run on production by this file; run it through the Supabase MCP.

create or replace function work_private.only_owner_in_private()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_owner uuid;
begin
  if tg_table_name = 'work_project_members' then
    select w.kind, w.owner_id into v_kind, v_owner
    from public.work_projects p join public.work_workspaces w on w.id = p.workspace_id
    where p.id = new.project_id;
  else
    select kind, owner_id into v_kind, v_owner from public.work_workspaces where id = new.workspace_id;
  end if;

  if v_kind is null or v_kind = 'shared' then
    return new;
  end if;

  -- The inbox is only for its owner.
  if v_kind = 'inbox' then
    if tg_table_name = 'work_invites' then
      raise exception 'Your inbox is only for you: you cannot invite anyone' using errcode = '42501';
    end if;
    if new.user_id is distinct from v_owner then
      raise exception 'Your inbox is only for you: you cannot add anyone' using errcode = '42501';
    end if;
    return new;
  end if;

  -- A private workspace: the owner decides who comes in, and stays the only admin.
  if tg_table_name = 'work_invites' then
    if new.invited_by is distinct from v_owner then
      raise exception 'Only the owner of a private workspace can invite people' using errcode = '42501';
    end if;
    if new.role = 'admin' then
      raise exception 'Nobody else can be admin of a private workspace' using errcode = '42501';
    end if;
  elsif tg_table_name = 'work_members' then
    if new.user_id is distinct from v_owner and new.role = 'admin' then
      raise exception 'Nobody else can be admin of a private workspace' using errcode = '42501';
    end if;
  elsif tg_table_name = 'work_project_members' then
    -- Someone is first invited into the workspace (or accepts an invite into a
    -- project, which adds both); a project never adds a stranger by itself.
    if new.user_id is distinct from v_owner and not exists (
      select 1 from public.work_projects p
      join public.work_members m on m.workspace_id = p.workspace_id
      where p.id = new.project_id and m.user_id = new.user_id
    ) then
      raise exception 'Invite people into the private workspace first' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Role changes must be checked as well (a member promoted to admin).
drop trigger if exists work_members_only_owner on public.work_members;
create trigger work_members_only_owner before insert or update of user_id, role on public.work_members
  for each row execute function work_private.only_owner_in_private();

-- Tasks and reviews in a private workspace: the owner and active members.
create or replace function work_private.only_owner_on_private_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_kind text;
  v_user uuid;
  v_workspace uuid;
begin
  if tg_table_name = 'work_task_assignees' then
    v_user := new.user_id;
    select workspace_id into v_workspace from public.work_tasks where id = new.task_id;
  else
    v_user := new.reviewer_id;
    v_workspace := new.workspace_id;
  end if;
  select owner_id, kind into v_owner, v_kind from public.work_workspaces where id = v_workspace and kind <> 'shared';
  if v_owner is not null and v_user is not null and v_user <> v_owner then
    if v_kind = 'inbox' then
      raise exception 'Tasks in your inbox are only yours' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.work_members
      where workspace_id = v_workspace and user_id = v_user and deactivated_at is null
    ) then
      raise exception 'Tasks in a private workspace can only go to people you invited' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function work_private.only_owner_in_private() from public, anon, authenticated;
revoke execute on function work_private.only_owner_on_private_task() from public, anon, authenticated;
