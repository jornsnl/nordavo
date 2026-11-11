-- Work as the one place for all tasks (feedback Julius, 11 November 2026):
--
-- 1. Private workspaces: any team member makes their own. Only the owner is
--    in it, so nobody else sees it, other admins included (visibility in
--    Work is membership, never the portal role).
-- 2. An inbox per user: a private workspace with one project. Quick capture,
--    the MCP and the phone land there when no project is chosen; the owner
--    sorts it later by moving the task to another project, also in another
--    workspace.
-- 3. Archive a workspace: it leaves the sidebar and My overview, the data
--    stays and a workspace admin restores it under Manage.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.work_workspaces
  add column kind text not null default 'shared' check (kind in ('shared', 'private', 'inbox')),
  add column owner_id uuid references public.profiles (id) on delete cascade,
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete set null,
  add constraint work_workspaces_owner_check check ((kind = 'shared') = (owner_id is null)),
  add constraint work_workspaces_inbox_not_archived check (kind <> 'inbox' or archived_at is null);

create unique index work_workspaces_one_inbox on public.work_workspaces (owner_id) where kind = 'inbox';
create index work_workspaces_owner_idx on public.work_workspaces (owner_id) where owner_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Nobody else gets into a private workspace or an inbox
-- ---------------------------------------------------------------------------
--
-- Enforced on the tables, so no function (invite, add to project, the
-- ClickUp import, the API) can add someone else.

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
  if v_kind is distinct from 'shared' and v_kind is not null then
    if tg_table_name = 'work_invites' then
      raise exception 'A private workspace is only for you: you cannot invite anyone' using errcode = '42501';
    end if;
    if new.user_id is distinct from v_owner then
      raise exception 'A private workspace is only for you: you cannot add anyone' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger work_members_only_owner before insert or update of user_id on public.work_members
  for each row execute function work_private.only_owner_in_private();
create trigger work_project_members_only_owner before insert or update of user_id on public.work_project_members
  for each row execute function work_private.only_owner_in_private();
create trigger work_invites_only_owner before insert on public.work_invites
  for each row execute function work_private.only_owner_in_private();

-- Owners and reviewers of a task in a private workspace can only be the owner.
create or replace function work_private.only_owner_on_private_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
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
  select owner_id into v_owner from public.work_workspaces where id = v_workspace and kind <> 'shared';
  if v_owner is not null and v_user is not null and v_user <> v_owner then
    raise exception 'Tasks in a private workspace are only yours' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger work_task_assignees_private before insert or update on public.work_task_assignees
  for each row execute function work_private.only_owner_on_private_task();
create trigger work_tasks_private_reviewer before insert or update of reviewer_id, workspace_id on public.work_tasks
  for each row execute function work_private.only_owner_on_private_task();

revoke execute on function work_private.only_owner_in_private() from public, anon, authenticated;
revoke execute on function work_private.only_owner_on_private_task() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Making a private workspace and the inbox
-- ---------------------------------------------------------------------------

create or replace function work_private.unique_slug(p_base text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text := left(trim(both '-' from regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9]+', '-', 'g')), 30);
  v_slug text;
  v_n int := 1;
begin
  if v_base = '' then
    v_base := 'workspace';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.work_workspaces where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

-- A private workspace with a first project, for any team member (admin or
-- member in the portal). The slug is made unique when the asked one is taken.
create or replace function public.work_create_private_workspace(p_name text, p_slug text default null, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_name text := trim(coalesce(p_name, ''));
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role in ('admin', 'member')) then
    raise exception 'Only the Nordavo team can make a private workspace' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Give the workspace a name of at most 80 characters';
  end if;
  if (select count(*) from public.work_workspaces where owner_id = v_uid and kind = 'private' and archived_at is null) >= 20 then
    raise exception 'You have 20 private workspaces. Archive one first.';
  end if;
  insert into public.work_workspaces (name, slug, created_by, kind, owner_id)
  values (v_name, work_private.unique_slug(coalesce(nullif(p_slug, ''), v_name)), v_uid, 'private', v_uid)
  returning id into v_id;
  insert into public.work_members (workspace_id, user_id, role, invited_by)
  values (v_id, v_uid, 'admin', v_uid);
  perform work_private.log_access(v_id, null, v_uid, 'granted', 'admin', v_uid);
  insert into public.work_projects (workspace_id, name, visibility, created_by)
  values (v_id, 'Tasks', 'private', v_uid);
  return v_id;
end;
$$;

-- The inbox of a user: made the first time it is needed, returns its
-- project. Everyone with Work has one (external accounts too).
create or replace function public.work_ensure_inbox(p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_workspace uuid;
  v_project uuid;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role in ('admin', 'member', 'external', 'client')) then
    raise exception 'Your account has no Work' using errcode = '42501';
  end if;
  select id into v_workspace from public.work_workspaces where owner_id = v_uid and kind = 'inbox';
  if v_workspace is null then
    insert into public.work_workspaces (name, slug, created_by, kind, owner_id)
    values ('Inbox', work_private.unique_slug('inbox-' || left(replace(v_uid::text, '-', ''), 8)), v_uid, 'inbox', v_uid)
    on conflict (owner_id) where kind = 'inbox' do nothing
    returning id into v_workspace;
    if v_workspace is null then
      select id into v_workspace from public.work_workspaces where owner_id = v_uid and kind = 'inbox';
    else
      insert into public.work_members (workspace_id, user_id, role, invited_by)
      values (v_workspace, v_uid, 'admin', v_uid);
    end if;
  end if;
  -- The membership may have been deactivated by hand; the inbox is always yours.
  update public.work_members set deactivated_at = null, access_expires_at = null
  where workspace_id = v_workspace and user_id = v_uid and (deactivated_at is not null or access_expires_at is not null);

  select id into v_project from public.work_projects
  where workspace_id = v_workspace and archived_at is null
  order by created_at
  limit 1;
  if v_project is null then
    insert into public.work_projects (workspace_id, name, visibility, created_by)
    values (v_workspace, 'Inbox', 'private', v_uid)
    returning id into v_project;
  end if;
  return v_project;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Archive a workspace
-- ---------------------------------------------------------------------------

create or replace function public.work_archive_workspace(p_workspace uuid, p_archived boolean, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_kind text;
begin
  if work_private.role_in(p_workspace, v_uid) is distinct from 'admin' then
    raise exception 'Only workspace admins can do this' using errcode = '42501';
  end if;
  select kind into v_kind from public.work_workspaces where id = p_workspace;
  if v_kind = 'inbox' then
    raise exception 'Your inbox cannot be archived';
  end if;
  update public.work_workspaces
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
      archived_by = case when p_archived then v_uid else null end
  where id = p_workspace;
  perform work_private.log_access(p_workspace, null, v_uid, case when p_archived then 'archived' else 'restored' end, 'admin', v_uid);
end;
$$;

-- The access log gets two actions.
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.work_access_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%action%';
  if v_name is not null then
    execute format('alter table public.work_access_log drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.work_access_log add constraint work_access_log_action_check check (action in (
  'invited', 'invite_revoked', 'granted', 'revoked', 'role_changed', 'expiry_changed', 'expired',
  'deactivated', 'reactivated', 'archived', 'restored'
));

-- ---------------------------------------------------------------------------
-- 5. Moving out of your inbox or a private workspace
-- ---------------------------------------------------------------------------
--
-- Same as 20261029000000, plus: a task in your own inbox or private
-- workspace can move to a project in another workspace you can add tasks
-- to. Owners and reviewer who cannot open the new project are dropped (the
-- mover becomes reviewer). Moving into someone's private space from a shared
-- workspace stays impossible: the triggers above refuse other people there,
-- and a shared task never leaves its workspace.

create or replace function public.work_move_task(p_task uuid, p_project uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_task public.work_tasks := work_private.editable_task(p_task, v_uid);
  v_target public.work_projects;
  v_source_owner uuid;
begin
  if v_task.parent_id is not null then
    raise exception 'Move the parent task; its subtasks move with it';
  end if;
  select * into v_target from public.work_projects where id = p_project;
  if v_target.id is null or not work_private.can_view_project(p_project, v_uid) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_target.archived_at is not null then
    raise exception 'This project is archived';
  end if;

  if v_target.workspace_id <> v_task.workspace_id then
    select owner_id into v_source_owner from public.work_workspaces where id = v_task.workspace_id and kind <> 'shared';
    if v_source_owner is distinct from v_uid then
      raise exception 'Tasks can only move within their workspace';
    end if;
    if exists (select 1 from public.work_workspaces where id = v_target.workspace_id and archived_at is not null) then
      raise exception 'This workspace is archived';
    end if;

    delete from public.work_task_assignees a
    using public.work_tasks t
    where t.id = a.task_id
      and (t.id = p_task or t.parent_id = p_task)
      and a.user_id <> v_uid
      and not work_private.can_view_project(p_project, a.user_id);

    update public.work_tasks
    set workspace_id = v_target.workspace_id,
        project_id = p_project,
        reviewer_id = case
          when reviewer_id is null or reviewer_id = v_uid or work_private.can_view_project(p_project, reviewer_id) then reviewer_id
          else v_uid
        end
    where id = p_task or parent_id = p_task;

    update public.work_notifications set workspace_id = v_target.workspace_id, project_id = p_project
    where task_id in (select id from public.work_tasks where id = p_task or parent_id = p_task);
    return;
  end if;

  update public.work_tasks set project_id = p_project
  where id = p_task or parent_id = p_task;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

revoke execute on function work_private.unique_slug(text) from public, anon, authenticated;
revoke execute on function public.work_create_private_workspace(text, text, uuid) from public, anon;
revoke execute on function public.work_ensure_inbox(uuid) from public, anon;
revoke execute on function public.work_archive_workspace(uuid, boolean, uuid) from public, anon;
grant execute on function public.work_create_private_workspace(text, text, uuid) to authenticated, service_role;
grant execute on function public.work_ensure_inbox(uuid) to authenticated, service_role;
grant execute on function public.work_archive_workspace(uuid, boolean, uuid) to authenticated, service_role;
