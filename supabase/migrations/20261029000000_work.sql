-- Work: the task tool that replaces ClickUp (docs/work.md).
--
-- Structure: workspace -> project -> task -> subtask (one level).
--
-- Roles per workspace (work_members.role):
--   admin   manages members, projects and settings, sees every project
--   member  sees every open project and the private projects they are in
--   guest   freelancer or external, sees only the projects they were added to
--           and does not learn which other projects exist
--
-- Project visibility: open (every admin and member of the workspace) or
-- private (admins and the people added to the project). A project can also
-- show guests only the tasks they are involved in.
--
-- How rights are enforced:
--   * Reads go through RLS. The rules live once, in work_private.*, and the
--     policies call thin wrappers that always use auth.uid().
--   * Writes only go through the security definer functions below (work_*).
--     Signed-in users have no insert, update or delete grant on the work
--     tables, so the rules in those functions cannot be bypassed.
--   * The API (/api/work) runs with the secret key and passes the acting
--     user as p_actor; that parameter is ignored for every other caller.
--   * Files live in the private bucket "work" under task/<task id>/ and
--     follow the rights of their task.

-- ---------------------------------------------------------------------------
-- Profiles: a role for people who only use the task tool, and a time zone
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'member', 'client', 'external'));

-- New accounts start without access to the Nordavo portal. Staff invites set
-- the role explicitly; freelancers and other workspaces stay "external".
alter table public.profiles alter column role set default 'external';

alter table public.profiles
  add column if not exists time_zone text not null default 'Europe/Amsterdam'
  check (char_length(time_zone) between 1 and 64);

grant update (full_name, time_zone) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email, 'external');
  return new;
end;
$$;

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_role text,
  p_client_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Alleen beheerders kunnen rollen aanpassen';
  end if;
  if p_role not in ('admin', 'member', 'client', 'external') then
    raise exception 'Ongeldige rol';
  end if;
  if p_role = 'client' and p_client_id is null then
    raise exception 'Een klantaccount moet aan een klant gekoppeld zijn';
  end if;
  if p_user_id = (select auth.uid()) and p_role <> 'admin' then
    raise exception 'Je kunt je eigen beheerdersrol niet intrekken';
  end if;

  update public.profiles
  set role = p_role,
      client_id = case when p_role = 'client' then p_client_id else null end
  where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create schema if not exists work_private;
revoke all on schema work_private from public, anon, authenticated;
grant usage on schema work_private to service_role;

create table public.work_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 40),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.work_members (
  workspace_id uuid not null references public.work_workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'member', 'guest')),
  -- After this moment the membership no longer counts (mostly for guests).
  access_expires_at timestamptz,
  -- Set when someone leaves; the row stays so history keeps their name.
  deactivated_at timestamptz,
  expiry_warned_at timestamptz,
  expiry_logged_at timestamptz,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index work_members_user_idx on public.work_members (user_id);

create table public.work_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.work_workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 5000),
  visibility text not null default 'open' check (visibility in ('open', 'private')),
  guests_see_assigned_only boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (external_source, external_id)
);

create index work_projects_workspace_idx on public.work_projects (workspace_id);

create table public.work_project_members (
  project_id uuid not null references public.work_projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  access_expires_at timestamptz,
  expiry_warned_at timestamptz,
  expiry_logged_at timestamptz,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index work_project_members_user_idx on public.work_project_members (user_id);

create table public.work_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.work_workspaces (id) on delete cascade,
  project_id uuid not null,
  parent_id uuid references public.work_tasks (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 50000),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'review', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  -- Stored in UTC, shown in the time zone of the viewer.
  due_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  reviewer_id uuid references public.profiles (id) on delete set null,
  -- Logged as finished work in one step ("quick log").
  is_log boolean not null default false,
  position double precision not null default 0,
  review_requested_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, workspace_id)
    references public.work_projects (id, workspace_id) on delete cascade on update cascade,
  unique (external_source, external_id)
);

create index work_tasks_project_idx on public.work_tasks (project_id) where archived_at is null;
create index work_tasks_parent_idx on public.work_tasks (parent_id);
create index work_tasks_reviewer_idx on public.work_tasks (reviewer_id) where status = 'review';
create index work_tasks_due_idx on public.work_tasks (due_at) where archived_at is null;
create index work_tasks_archived_idx on public.work_tasks (archived_at) where archived_at is not null;

create table public.work_task_assignees (
  task_id uuid not null references public.work_tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index work_task_assignees_user_idx on public.work_task_assignees (user_id);

create table public.work_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 20000),
  -- "returned": the comment that came with sending a task back from review.
  kind text not null default 'comment' check (kind in ('comment', 'returned')),
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  unique (external_source, external_id)
);

create index work_comments_task_idx on public.work_comments (task_id, created_at);

create table public.work_comment_mentions (
  comment_id uuid not null references public.work_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (comment_id, user_id)
);

create table public.work_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles (id) on delete set null,
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  unique (external_source, external_id)
);

create index work_attachments_task_idx on public.work_attachments (task_id);

-- Who changed what on a task, and when. Written by triggers only.
create table public.work_task_activity (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.work_tasks (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index work_task_activity_task_idx on public.work_task_activity (task_id, created_at);

-- Who got or lost access to a workspace or project, and when.
create table public.work_access_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.work_workspaces (id) on delete cascade,
  project_id uuid references public.work_projects (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  email text,
  action text not null check (action in (
    'invited', 'invite_revoked', 'granted', 'revoked', 'role_changed',
    'expiry_changed', 'expired', 'deactivated', 'reactivated'
  )),
  role text,
  actor_id uuid references public.profiles (id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index work_access_log_workspace_idx on public.work_access_log (workspace_id, created_at desc);

create table public.work_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.work_workspaces (id) on delete cascade,
  project_id uuid references public.work_projects (id) on delete cascade,
  email text not null check (email = lower(email) and email like '%@%'),
  role text not null check (role in ('admin', 'member', 'guest')),
  access_expires_at timestamptz,
  -- SHA-256 of the token in the invite link; the token itself is never stored.
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz
);

create index work_invites_workspace_idx on public.work_invites (workspace_id);

-- Outbox for e-mail notifications; the app and the scheduled job send them.
create table public.work_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'assigned', 'comment', 'mention', 'review', 'returned',
    'due_soon', 'overdue', 'project_added', 'access_expiring'
  )),
  workspace_id uuid references public.work_workspaces (id) on delete cascade,
  project_id uuid references public.work_projects (id) on delete cascade,
  task_id uuid references public.work_tasks (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  data jsonb not null default '{}',
  delivery text not null check (delivery in ('instant', 'digest')),
  dedupe_key text unique,
  attempts int not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  skipped boolean not null default false,
  created_at timestamptz not null default now()
);

create index work_notifications_pending_idx
  on public.work_notifications (delivery, id) where sent_at is null;

-- Per user, per kind: "instant", "digest" or "off". Missing kinds use the defaults.
create table public.work_notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  prefs jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Personal API tokens for /api/work. Only a SHA-256 hash is stored.
create table public.work_api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique,
  token_prefix text not null,
  access text not null default 'read' check (access in ('read', 'write')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index work_api_tokens_user_idx on public.work_api_tokens (user_id);

create trigger work_workspaces_set_updated_at before update on public.work_workspaces
  for each row execute function public.set_updated_at();
create trigger work_members_set_updated_at before update on public.work_members
  for each row execute function public.set_updated_at();
create trigger work_projects_set_updated_at before update on public.work_projects
  for each row execute function public.set_updated_at();
create trigger work_tasks_set_updated_at before update on public.work_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access rules (work_private): one definition, used by RLS, the write
-- functions and the API. Never granted to signed-in users directly.
-- ---------------------------------------------------------------------------

-- The user a write is done for: auth.uid() for a signed-in user, p_actor for
-- the API (secret key). Remembered for the rest of the transaction so the
-- activity triggers can name the actor.
create or replace function work_private.actor(p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  if (select auth.role()) = 'service_role' then
    v_uid := p_actor;
  else
    v_uid := (select auth.uid());
  end if;
  if v_uid is null then
    raise exception 'You need to be signed in' using errcode = '42501';
  end if;
  perform set_config('work.actor', v_uid::text, true);
  return v_uid;
end;
$$;

create or replace function work_private.current_actor()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('work.actor', true), '')::uuid, (select auth.uid()));
$$;

create or replace function work_private.role_in(p_workspace uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.work_members m
  where m.workspace_id = p_workspace
    and m.user_id = p_user
    and m.deactivated_at is null
    and (m.access_expires_at is null or m.access_expires_at > now());
$$;

create or replace function work_private.in_project(p_project uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.work_project_members pm
    where pm.project_id = p_project
      and pm.user_id = p_user
      and (pm.access_expires_at is null or pm.access_expires_at > now())
  );
$$;

create or replace function work_private.can_view_project(p_project uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case work_private.role_in(p.workspace_id, p_user)
      when 'admin' then true
      when 'member' then p.visibility = 'open' or work_private.in_project(p.id, p_user)
      when 'guest' then work_private.in_project(p.id, p_user)
      else false
    end
    from public.work_projects p
    where p.id = p_project
  ), false);
$$;

-- Add people, change settings: admins, and members who are in the project.
create or replace function work_private.can_manage_project(p_project uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case work_private.role_in(p.workspace_id, p_user)
      when 'admin' then true
      when 'member' then p.created_by = p_user or work_private.in_project(p.id, p_user)
      else false
    end
    from public.work_projects p
    where p.id = p_project
  ), false);
$$;

create or replace function work_private.can_view_task(p_task uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      work_private.can_view_project(t.project_id, p_user)
      -- Archived tasks sit in the trash: only admins and their maker see them.
      and (
        t.archived_at is null
        or t.created_by = p_user
        or work_private.role_in(t.workspace_id, p_user) = 'admin'
      )
      and (
        not p.guests_see_assigned_only
        or work_private.role_in(t.workspace_id, p_user) is distinct from 'guest'
        or t.created_by = p_user
        or t.reviewer_id = p_user
        or exists (
          select 1 from public.work_task_assignees a
          where a.user_id = p_user and (a.task_id = t.id or a.task_id = t.parent_id)
        )
        or exists (
          select 1
          from public.work_tasks c
          join public.work_task_assignees a on a.task_id = c.id
          where c.parent_id = t.id and a.user_id = p_user
        )
      )
    from public.work_tasks t
    join public.work_projects p on p.id = t.project_id
    where t.id = p_task
  ), false);
$$;

-- Whether p_viewer may see p_target's name in some workspace. Admins and
-- members see everyone in their workspace; guests only the people in their
-- projects (admins included, and every member when the project is open).
create or replace function work_private.can_see_user(p_viewer uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer = p_target or exists (
    select 1
    from public.work_members v
    join public.work_members t
      on t.workspace_id = v.workspace_id and t.user_id = p_target
    where v.user_id = p_viewer
      and v.deactivated_at is null
      and (v.access_expires_at is null or v.access_expires_at > now())
      and (
        v.role in ('admin', 'member')
        or t.role = 'admin'
        or exists (
          select 1
          from public.work_projects pr
          where pr.workspace_id = v.workspace_id
            and work_private.in_project(pr.id, p_viewer)
            and (
              work_private.in_project(pr.id, p_target)
              or (pr.visibility = 'open' and t.role = 'member')
            )
        )
      )
  );
$$;

create or replace function work_private.can_see_member(p_workspace uuid, p_viewer uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer = p_target or (
    select case
      when work_private.role_in(p_workspace, p_viewer) in ('admin', 'member') then true
      when work_private.role_in(p_workspace, p_viewer) = 'guest' then exists (
        select 1
        from public.work_members t
        where t.workspace_id = p_workspace
          and t.user_id = p_target
          and (
            t.role = 'admin'
            or exists (
              select 1
              from public.work_projects pr
              where pr.workspace_id = p_workspace
                and work_private.in_project(pr.id, p_viewer)
                and (
                  work_private.in_project(pr.id, p_target)
                  or (pr.visibility = 'open' and t.role = 'member')
                )
            )
          )
      )
      else false
    end
  );
$$;

-- The task row, if p_user may change it; raises otherwise.
create or replace function work_private.editable_task(p_task uuid, p_user uuid)
returns public.work_tasks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.work_tasks;
begin
  select * into v_task from public.work_tasks where id = p_task;
  if v_task.id is null or not work_private.can_view_task(p_task, p_user) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if v_task.archived_at is not null then
    raise exception 'This task is in the trash. Restore it first.';
  end if;
  return v_task;
end;
$$;

-- Default delivery per kind: review requests and mentions right away,
-- everything else in the daily digest.
create or replace function work_private.default_delivery(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_kind in ('review', 'mention') then 'instant' else 'digest' end;
$$;

create or replace function work_private.notify(
  p_user uuid,
  p_kind text,
  p_workspace uuid,
  p_project uuid,
  p_task uuid,
  p_actor uuid,
  p_data jsonb default '{}',
  p_dedupe text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery text;
begin
  if p_user is null or p_user is not distinct from p_actor then
    return;
  end if;
  select coalesce(prefs ->> p_kind, work_private.default_delivery(p_kind))
  into v_delivery
  from public.work_notification_prefs
  where user_id = p_user;
  v_delivery := coalesce(v_delivery, work_private.default_delivery(p_kind));
  if v_delivery not in ('instant', 'digest') then
    return; -- "off"
  end if;
  insert into public.work_notifications
    (user_id, kind, workspace_id, project_id, task_id, actor_id, data, delivery, dedupe_key)
  values
    (p_user, p_kind, p_workspace, p_project, p_task, p_actor, coalesce(p_data, '{}'), v_delivery, p_dedupe)
  on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function work_private.log_access(
  p_workspace uuid,
  p_project uuid,
  p_user uuid,
  p_action text,
  p_role text,
  p_actor uuid,
  p_details jsonb default '{}',
  p_email text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.work_access_log (workspace_id, project_id, user_id, email, action, role, actor_id, details)
  values (p_workspace, p_project, p_user, p_email, p_action, p_role, p_actor, coalesce(p_details, '{}'));
$$;

-- People who may be owner or reviewer of a task: anyone who can open its project.
create or replace function work_private.require_project_people(p_project uuid, p_users uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  foreach v_user in array coalesce(p_users, '{}') loop
    if v_user is not null and not work_private.can_view_project(p_project, v_user) then
      raise exception 'Everyone on a task must have access to its project';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Wrappers for RLS policies: always about the signed-in user.
-- ---------------------------------------------------------------------------

create or replace function public.work_my_role(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.role_in(p_workspace, (select auth.uid()));
$$;

create or replace function public.work_can_view_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.can_view_project(p_project, (select auth.uid()));
$$;

create or replace function public.work_can_view_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.can_view_task(p_task, (select auth.uid()));
$$;

create or replace function public.work_can_see_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.can_see_user((select auth.uid()), p_user);
$$;

create or replace function public.work_can_see_member(p_workspace uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.can_see_member(p_workspace, (select auth.uid()), p_user);
$$;

-- Storage paths look like task/<task id>/<random>-<file name>.
create or replace function public.work_file_task(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) = 'task'
     and split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 2)::uuid
  end;
$$;

-- ---------------------------------------------------------------------------
-- Integrity: subtasks are one level deep and live in their parent's project.
-- Deferred, so moving a task together with its subtasks is one statement.
-- ---------------------------------------------------------------------------

create or replace function work_private.check_task_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.work_tasks;
begin
  if new.parent_id is null then
    return null;
  end if;
  select * into v_parent from public.work_tasks where id = new.parent_id;
  if v_parent.id is null then
    return null; -- parent deleted in the same transaction; the cascade removes this row
  end if;
  if v_parent.parent_id is not null then
    raise exception 'Subtasks cannot have subtasks of their own';
  end if;
  if v_parent.project_id <> new.project_id then
    raise exception 'A subtask lives in the same project as its parent';
  end if;
  return null;
end;
$$;

create constraint trigger work_tasks_check_parent
  after insert or update of parent_id, project_id on public.work_tasks
  deferrable initially deferred
  for each row execute function work_private.check_task_parent();

-- ---------------------------------------------------------------------------
-- Activity log per task (triggers, so imports and every write path count)
-- ---------------------------------------------------------------------------

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
    'title', 'status', 'priority', 'due_at', 'reviewer_id', 'project_id', 'archived_at', 'parent_id'
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

create trigger work_tasks_activity after insert or update on public.work_tasks
  for each row execute function work_private.log_task_activity();

create or replace function work_private.log_assignee_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.work_task_activity (task_id, actor_id, action, details)
    values (new.task_id, work_private.current_actor(), 'owner_added', jsonb_build_object('user_id', new.user_id));
    return null;
  end if;
  -- Skip when the whole task is being deleted.
  if exists (select 1 from public.work_tasks where id = old.task_id) then
    insert into public.work_task_activity (task_id, actor_id, action, details)
    values (old.task_id, work_private.current_actor(), 'owner_removed', jsonb_build_object('user_id', old.user_id));
  end if;
  return null;
end;
$$;

create trigger work_task_assignees_activity after insert or delete on public.work_task_assignees
  for each row execute function work_private.log_assignee_activity();

create or replace function work_private.log_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.work_task_activity (task_id, actor_id, action, details)
  values (new.task_id, coalesce(work_private.current_actor(), new.author_id), 'commented',
    jsonb_build_object('comment_id', new.id, 'kind', new.kind));
  return null;
end;
$$;

create trigger work_comments_activity after insert on public.work_comments
  for each row execute function work_private.log_comment_activity();

create or replace function work_private.log_attachment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.work_task_activity (task_id, actor_id, action, details)
    values (new.task_id, coalesce(work_private.current_actor(), new.uploaded_by), 'file_added',
      jsonb_build_object('file_name', new.file_name));
  elsif exists (select 1 from public.work_tasks where id = old.task_id) then
    insert into public.work_task_activity (task_id, actor_id, action, details)
    values (old.task_id, work_private.current_actor(), 'file_removed',
      jsonb_build_object('file_name', old.file_name));
  end if;
  return null;
end;
$$;

create trigger work_attachments_activity after insert or delete on public.work_attachments
  for each row execute function work_private.log_attachment_activity();

-- ---------------------------------------------------------------------------
-- Row Level Security: reads only. Writes go through the functions below.
-- ---------------------------------------------------------------------------

alter table public.work_workspaces enable row level security;
alter table public.work_members enable row level security;
alter table public.work_projects enable row level security;
alter table public.work_project_members enable row level security;
alter table public.work_tasks enable row level security;
alter table public.work_task_assignees enable row level security;
alter table public.work_comments enable row level security;
alter table public.work_comment_mentions enable row level security;
alter table public.work_attachments enable row level security;
alter table public.work_task_activity enable row level security;
alter table public.work_access_log enable row level security;
alter table public.work_invites enable row level security;
alter table public.work_notifications enable row level security;
alter table public.work_notification_prefs enable row level security;
alter table public.work_api_tokens enable row level security;

revoke all on
  public.work_workspaces, public.work_members, public.work_projects,
  public.work_project_members, public.work_tasks, public.work_task_assignees,
  public.work_comments, public.work_comment_mentions, public.work_attachments,
  public.work_task_activity, public.work_access_log, public.work_invites,
  public.work_notifications, public.work_notification_prefs, public.work_api_tokens
from anon, authenticated;

grant select on
  public.work_workspaces, public.work_members, public.work_projects,
  public.work_project_members, public.work_tasks, public.work_task_assignees,
  public.work_comments, public.work_comment_mentions, public.work_attachments,
  public.work_task_activity, public.work_access_log, public.work_invites,
  public.work_notifications, public.work_notification_prefs, public.work_api_tokens
to authenticated;

-- Own settings and tokens are plain rows.
grant insert, update on public.work_notification_prefs to authenticated;
grant insert on public.work_api_tokens to authenticated;
grant update (revoked_at) on public.work_api_tokens to authenticated;

create policy "Workspaces are visible to their members"
  on public.work_workspaces for select to authenticated
  using (public.work_my_role(id) is not null);

create policy "Members are visible to who may see them"
  on public.work_members for select to authenticated
  using (public.work_can_see_member(workspace_id, user_id));

create policy "Projects are visible to who may open them"
  on public.work_projects for select to authenticated
  using (public.work_can_view_project(id));

create policy "Project members are visible inside the project"
  on public.work_project_members for select to authenticated
  using (public.work_can_view_project(project_id) and public.work_can_see_member(
    (select p.workspace_id from public.work_projects p where p.id = project_id), user_id));

create policy "Tasks are visible to who may open them"
  on public.work_tasks for select to authenticated
  using (public.work_can_view_task(id));

create policy "Task owners follow their task"
  on public.work_task_assignees for select to authenticated
  using (public.work_can_view_task(task_id));

create policy "Comments follow their task"
  on public.work_comments for select to authenticated
  using (public.work_can_view_task(task_id));

create policy "Mentions follow their comment"
  on public.work_comment_mentions for select to authenticated
  using (exists (
    select 1 from public.work_comments c
    where c.id = comment_id and public.work_can_view_task(c.task_id)
  ));

create policy "Attachments follow their task"
  on public.work_attachments for select to authenticated
  using (public.work_can_view_task(task_id));

create policy "Activity follows its task"
  on public.work_task_activity for select to authenticated
  using (public.work_can_view_task(task_id));

create policy "Access log is for workspace admins"
  on public.work_access_log for select to authenticated
  using (public.work_my_role(workspace_id) = 'admin');

create policy "Invites are visible to admins and who sent them"
  on public.work_invites for select to authenticated
  using (public.work_my_role(workspace_id) = 'admin' or invited_by = (select auth.uid()));

create policy "Notifications are private"
  on public.work_notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Notification settings are private"
  on public.work_notification_prefs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "API tokens are readable by their owner"
  on public.work_api_tokens for select to authenticated
  using (user_id = (select auth.uid()));

create policy "API tokens are creatable for yourself"
  on public.work_api_tokens for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "API tokens are revocable by their owner"
  on public.work_api_tokens for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- People in the same workspace (or, for guests, the same projects) see each other's names.
create policy "Work colleagues can read each other's profile"
  on public.profiles for select to authenticated
  using (public.work_can_see_user(id));

-- ---------------------------------------------------------------------------
-- Workspaces and members
-- ---------------------------------------------------------------------------

-- Portal admins start a workspace and become its first admin.
create or replace function public.work_create_workspace(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(null);
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception 'Only portal admins can create a workspace' using errcode = '42501';
  end if;
  if exists (select 1 from public.work_workspaces where slug = lower(p_slug)) then
    raise exception 'That web address is already taken';
  end if;
  insert into public.work_workspaces (name, slug, created_by)
  values (trim(p_name), lower(p_slug), v_uid)
  returning id into v_id;
  insert into public.work_members (workspace_id, user_id, role, invited_by)
  values (v_id, v_uid, 'admin', v_uid);
  perform work_private.log_access(v_id, null, v_uid, 'granted', 'admin', v_uid);
  return v_id;
end;
$$;

create or replace function public.work_rename_workspace(p_workspace uuid, p_name text, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
begin
  if work_private.role_in(p_workspace, v_uid) is distinct from 'admin' then
    raise exception 'Only workspace admins can do this' using errcode = '42501';
  end if;
  update public.work_workspaces set name = trim(p_name) where id = p_workspace;
end;
$$;

create or replace function public.work_set_member(
  p_workspace uuid,
  p_user uuid,
  p_role text,
  p_access_expires_at timestamptz,
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_old public.work_members;
begin
  if work_private.role_in(p_workspace, v_uid) is distinct from 'admin' then
    raise exception 'Only workspace admins can do this' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'member', 'guest') then
    raise exception 'Unknown role';
  end if;
  select * into v_old from public.work_members where workspace_id = p_workspace and user_id = p_user;
  if v_old.user_id is null then
    raise exception 'This person is not in the workspace';
  end if;
  if p_user = v_uid and p_role <> 'admin' then
    raise exception 'You cannot remove your own admin role';
  end if;

  update public.work_members
  set role = p_role,
      access_expires_at = p_access_expires_at,
      expiry_warned_at = case when access_expires_at is distinct from p_access_expires_at then null else expiry_warned_at end,
      expiry_logged_at = case when access_expires_at is distinct from p_access_expires_at then null else expiry_logged_at end
  where workspace_id = p_workspace and user_id = p_user;

  if v_old.role <> p_role then
    perform work_private.log_access(p_workspace, null, p_user, 'role_changed', p_role, v_uid,
      jsonb_build_object('from', v_old.role));
  end if;
  if v_old.access_expires_at is distinct from p_access_expires_at then
    perform work_private.log_access(p_workspace, null, p_user, 'expiry_changed', p_role, v_uid,
      jsonb_build_object('from', v_old.access_expires_at, 'to', p_access_expires_at));
  end if;
end;
$$;

-- Someone leaves: they lose access, their open work moves to p_transfer_to.
create or replace function public.work_deactivate_member(
  p_workspace uuid,
  p_user uuid,
  p_transfer_to uuid,
  p_actor uuid default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_role text;
  v_moved int := 0;
begin
  if work_private.role_in(p_workspace, v_uid) is distinct from 'admin' then
    raise exception 'Only workspace admins can do this' using errcode = '42501';
  end if;
  if p_user = v_uid then
    raise exception 'You cannot deactivate yourself';
  end if;
  select role into v_role from public.work_members
  where workspace_id = p_workspace and user_id = p_user and deactivated_at is null;
  if v_role is null then
    raise exception 'This person is not active in the workspace';
  end if;
  if p_transfer_to is not null and coalesce(work_private.role_in(p_workspace, p_transfer_to), '') not in ('admin', 'member') then
    raise exception 'Open tasks can only move to an admin or member of this workspace';
  end if;

  if p_transfer_to is not null then
    -- Give the new person access to the private projects that held this work.
    insert into public.work_project_members (project_id, user_id, added_by)
    select distinct t.project_id, p_transfer_to, v_uid
    from public.work_tasks t
    where t.workspace_id = p_workspace
      and t.status not in ('done', 'cancelled')
      and t.archived_at is null
      and (t.reviewer_id = p_user or exists (
        select 1 from public.work_task_assignees a where a.task_id = t.id and a.user_id = p_user))
    on conflict do nothing;

    with open_tasks as (
      select a.task_id
      from public.work_task_assignees a
      join public.work_tasks t on t.id = a.task_id
      where a.user_id = p_user
        and t.workspace_id = p_workspace
        and t.status not in ('done', 'cancelled')
        and t.archived_at is null
    ), added as (
      insert into public.work_task_assignees (task_id, user_id, assigned_by)
      select task_id, p_transfer_to, v_uid from open_tasks
      on conflict do nothing
      returning task_id
    )
    select count(*) into v_moved from open_tasks;

    update public.work_tasks
    set reviewer_id = p_transfer_to
    where workspace_id = p_workspace
      and reviewer_id = p_user
      and status not in ('done', 'cancelled')
      and archived_at is null;
  end if;

  delete from public.work_task_assignees a
  using public.work_tasks t
  where t.id = a.task_id
    and a.user_id = p_user
    and t.workspace_id = p_workspace
    and t.status not in ('done', 'cancelled');

  delete from public.work_project_members pm
  using public.work_projects p
  where p.id = pm.project_id and p.workspace_id = p_workspace and pm.user_id = p_user;

  update public.work_members set deactivated_at = now()
  where workspace_id = p_workspace and user_id = p_user;

  perform work_private.log_access(p_workspace, null, p_user, 'deactivated', v_role, v_uid,
    jsonb_build_object('transferred_to', p_transfer_to, 'open_tasks', v_moved));
  return v_moved;
end;
$$;

create or replace function public.work_reactivate_member(p_workspace uuid, p_user uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_role text;
begin
  if work_private.role_in(p_workspace, v_uid) is distinct from 'admin' then
    raise exception 'Only workspace admins can do this' using errcode = '42501';
  end if;
  update public.work_members set deactivated_at = null
  where workspace_id = p_workspace and user_id = p_user and deactivated_at is not null
  returning role into v_role;
  if v_role is null then
    raise exception 'This person is not deactivated';
  end if;
  perform work_private.log_access(p_workspace, null, p_user, 'reactivated', v_role, v_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Projects and project access
-- ---------------------------------------------------------------------------

create or replace function public.work_create_project(
  p_workspace uuid,
  p_name text,
  p_description text default null,
  p_visibility text default 'open',
  p_guests_see_assigned_only boolean default false,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_id uuid;
begin
  if coalesce(work_private.role_in(p_workspace, v_uid), '') not in ('admin', 'member') then
    raise exception 'Only admins and members can create projects' using errcode = '42501';
  end if;
  insert into public.work_projects (workspace_id, name, description, visibility, guests_see_assigned_only, created_by)
  values (p_workspace, trim(p_name), nullif(trim(p_description), ''), coalesce(p_visibility, 'open'),
          coalesce(p_guests_see_assigned_only, false), v_uid)
  returning id into v_id;
  insert into public.work_project_members (project_id, user_id, added_by) values (v_id, v_uid, v_uid);
  return v_id;
end;
$$;

create or replace function public.work_update_project(
  p_project uuid,
  p_name text,
  p_description text,
  p_visibility text,
  p_guests_see_assigned_only boolean,
  p_archived boolean default false,
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
begin
  if not work_private.can_manage_project(p_project, v_uid) then
    raise exception 'You cannot change this project' using errcode = '42501';
  end if;
  update public.work_projects
  set name = trim(p_name),
      description = nullif(trim(p_description), ''),
      visibility = p_visibility,
      guests_see_assigned_only = coalesce(p_guests_see_assigned_only, false),
      archived_at = case
        when coalesce(p_archived, false) then coalesce(archived_at, now())
        else null
      end
  where id = p_project;
end;
$$;

create or replace function public.work_add_project_member(
  p_project uuid,
  p_user uuid,
  p_access_expires_at timestamptz default null,
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_project public.work_projects;
  v_role text;
begin
  select * into v_project from public.work_projects where id = p_project;
  if v_project.id is null or not work_private.can_manage_project(p_project, v_uid) then
    raise exception 'You cannot add people to this project' using errcode = '42501';
  end if;
  v_role := work_private.role_in(v_project.workspace_id, p_user);
  if v_role is null then
    raise exception 'Invite this person to the workspace first';
  end if;
  insert into public.work_project_members (project_id, user_id, access_expires_at, added_by)
  values (p_project, p_user, p_access_expires_at, v_uid)
  on conflict (project_id, user_id) do update
    set access_expires_at = excluded.access_expires_at,
        expiry_warned_at = null,
        expiry_logged_at = null;
  perform work_private.log_access(v_project.workspace_id, p_project, p_user, 'granted', v_role, v_uid,
    jsonb_build_object('access_expires_at', p_access_expires_at));
  perform work_private.notify(p_user, 'project_added', v_project.workspace_id, p_project, null, v_uid,
    jsonb_build_object('project', v_project.name));
end;
$$;

create or replace function public.work_remove_project_member(p_project uuid, p_user uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_project public.work_projects;
begin
  select * into v_project from public.work_projects where id = p_project;
  if v_project.id is null or not work_private.can_manage_project(p_project, v_uid) then
    raise exception 'You cannot change access to this project' using errcode = '42501';
  end if;
  delete from public.work_project_members where project_id = p_project and user_id = p_user;
  if found then
    perform work_private.log_access(v_project.workspace_id, p_project, p_user, 'revoked',
      work_private.role_in(v_project.workspace_id, p_user), v_uid);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invites. The app makes the token, mails the link and passes the hash.
-- ---------------------------------------------------------------------------

create or replace function public.work_create_invite(
  p_workspace uuid,
  p_project uuid,
  p_email text,
  p_role text,
  p_access_expires_at timestamptz,
  p_token_hash text,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_my_role text := work_private.role_in(p_workspace, v_uid);
  v_id uuid;
  v_email text := lower(trim(p_email));
begin
  if p_role not in ('admin', 'member', 'guest') then
    raise exception 'Unknown role';
  end if;
  if p_project is not null and not exists (
    select 1 from public.work_projects where id = p_project and workspace_id = p_workspace
  ) then
    raise exception 'Project not found';
  end if;
  -- Admins invite anyone; members only guests, into a project they manage.
  if v_my_role is distinct from 'admin' and not (
    v_my_role = 'member' and p_role = 'guest' and p_project is not null
    and work_private.can_manage_project(p_project, v_uid)
  ) then
    raise exception 'You cannot send this invite' using errcode = '42501';
  end if;
  if p_role = 'guest' and p_project is null then
    raise exception 'Guests are invited to a project';
  end if;

  -- One open invite per address and place; a new one replaces the old.
  update public.work_invites set revoked_at = now()
  where workspace_id = p_workspace and email = v_email
    and project_id is not distinct from p_project
    and accepted_at is null and revoked_at is null;

  insert into public.work_invites (workspace_id, project_id, email, role, access_expires_at, token_hash, invited_by)
  values (p_workspace, p_project, v_email, p_role, p_access_expires_at, p_token_hash, v_uid)
  returning id into v_id;

  perform work_private.log_access(p_workspace, p_project, null, 'invited', p_role, v_uid,
    jsonb_build_object('access_expires_at', p_access_expires_at), v_email);
  return v_id;
end;
$$;

create or replace function public.work_revoke_invite(p_invite uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_invite public.work_invites;
begin
  select * into v_invite from public.work_invites where id = p_invite;
  if v_invite.id is null or (
    work_private.role_in(v_invite.workspace_id, v_uid) is distinct from 'admin'
    and v_invite.invited_by is distinct from v_uid
  ) then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  update public.work_invites set revoked_at = now()
  where id = p_invite and accepted_at is null and revoked_at is null;
  if found then
    perform work_private.log_access(v_invite.workspace_id, v_invite.project_id, null, 'invite_revoked',
      v_invite.role, v_uid, '{}', v_invite.email);
  end if;
end;
$$;

-- What the invite page may show to whoever holds the link.
create or replace function public.work_invite_preview(p_token_hash text)
returns table (
  status text,
  email text,
  role text,
  workspace_name text,
  project_name text,
  invited_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when i.revoked_at is not null then 'revoked'
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'open'
    end,
    i.email,
    i.role,
    w.name,
    p.name,
    coalesce(nullif(pr.full_name, ''), pr.email)
  from public.work_invites i
  join public.work_workspaces w on w.id = i.workspace_id
  left join public.work_projects p on p.id = i.project_id
  left join public.profiles pr on pr.id = i.invited_by
  where i.token_hash = p_token_hash;
$$;

create or replace function public.work_accept_invite(p_token_hash text)
returns table (workspace_slug text, project_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := work_private.actor(null);
  v_email text;
  v_invite public.work_invites;
  v_member public.work_members;
  v_rank jsonb := '{"guest": 1, "member": 2, "admin": 3}';
  v_role text;
begin
  select lower(email) into v_email from auth.users where id = v_uid;
  select * into v_invite from public.work_invites where token_hash = p_token_hash for update;
  if v_invite.id is null or v_invite.revoked_at is not null then
    raise exception 'This invite is no longer valid';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'This invite has expired. Ask for a new one.';
  end if;
  if v_invite.email <> v_email then
    raise exception 'This invite is for another e-mail address' using errcode = '42501';
  end if;

  if v_invite.accepted_at is null then
    select * into v_member from public.work_members
    where workspace_id = v_invite.workspace_id and user_id = v_uid;

    if v_member.user_id is null then
      insert into public.work_members (workspace_id, user_id, role, access_expires_at, invited_by)
      values (v_invite.workspace_id, v_uid, v_invite.role,
              case when v_invite.role = 'guest' then v_invite.access_expires_at end,
              v_invite.invited_by);
      v_role := v_invite.role;
      perform work_private.log_access(v_invite.workspace_id, null, v_uid, 'granted', v_role,
        v_invite.invited_by, jsonb_build_object('invite_id', v_invite.id));
    else
      -- Never lower someone's role through an invite.
      v_role := case when (v_rank ->> v_invite.role)::int > (v_rank ->> v_member.role)::int
                     then v_invite.role else v_member.role end;
      update public.work_members
      set role = v_role,
          deactivated_at = null,
          access_expires_at = case
            when v_role = 'guest' then coalesce(v_invite.access_expires_at, access_expires_at)
            else null
          end,
          expiry_warned_at = null,
          expiry_logged_at = null
      where workspace_id = v_invite.workspace_id and user_id = v_uid;
      perform work_private.log_access(v_invite.workspace_id, null, v_uid,
        case when v_member.deactivated_at is not null then 'reactivated' else 'granted' end,
        v_role, v_invite.invited_by, jsonb_build_object('invite_id', v_invite.id));
    end if;

    if v_invite.project_id is not null then
      insert into public.work_project_members (project_id, user_id, access_expires_at, added_by)
      values (v_invite.project_id, v_uid,
              case when v_role = 'guest' then v_invite.access_expires_at end,
              v_invite.invited_by)
      on conflict (project_id, user_id) do nothing;
      perform work_private.log_access(v_invite.workspace_id, v_invite.project_id, v_uid, 'granted',
        v_role, v_invite.invited_by, jsonb_build_object('invite_id', v_invite.id));
    end if;

    update public.work_invites set accepted_at = now(), accepted_by = v_uid where id = v_invite.id;
  elsif v_invite.accepted_by is distinct from v_uid then
    raise exception 'This invite has already been used';
  end if;

  return query
    select w.slug, v_invite.project_id
    from public.work_workspaces w
    where w.id = v_invite.workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

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
  p_actor uuid default null
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
begin
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
    workspace_id, project_id, parent_id, title, description, status, priority, due_at,
    created_by, reviewer_id, is_log, position, completed_at
  ) values (
    v_project.workspace_id, p_project, p_parent, v_title, nullif(trim(p_description), ''), p_status,
    coalesce(p_priority, 'normal'), p_due_at, v_uid, v_reviewer, coalesce(p_is_log, false),
    extract(epoch from now()), case when p_status = 'done' then now() end
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

-- Partial update: only the keys present in p_fields change.
-- Keys: title, description, priority, due_at, reviewer_id.
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

  update public.work_tasks
  set title = case when p_fields ? 'title' then trim(p_fields ->> 'title') else title end,
      description = case when p_fields ? 'description' then nullif(trim(p_fields ->> 'description'), '') else description end,
      priority = case when p_fields ? 'priority' then p_fields ->> 'priority' else priority end,
      due_at = case when p_fields ? 'due_at' then nullif(p_fields ->> 'due_at', '')::timestamptz else due_at end,
      reviewer_id = case when p_fields ? 'reviewer_id' then v_reviewer else reviewer_id end
  where id = p_task;

  -- A new reviewer of a task that already waits for review hears about it.
  if p_fields ? 'reviewer_id' and v_task.status = 'review' and v_reviewer is distinct from v_task.reviewer_id then
    perform work_private.notify(v_reviewer, 'review', v_task.workspace_id, v_task.project_id, p_task, v_uid,
      jsonb_build_object('title', v_task.title));
  end if;
end;
$$;

create or replace function public.work_set_assignees(p_task uuid, p_users uuid[], p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_task public.work_tasks := work_private.editable_task(p_task, v_uid);
  v_user uuid;
begin
  perform work_private.require_project_people(v_task.project_id, p_users);

  delete from public.work_task_assignees
  where task_id = p_task and not (user_id = any (coalesce(p_users, '{}')));

  foreach v_user in array coalesce(p_users, '{}') loop
    insert into public.work_task_assignees (task_id, user_id, assigned_by)
    values (p_task, v_user, v_uid)
    on conflict do nothing;
    if found and v_task.status not in ('done', 'cancelled') then
      perform work_private.notify(v_user, 'assigned', v_task.workspace_id, v_task.project_id, p_task, v_uid,
        jsonb_build_object('title', v_task.title));
    end if;
  end loop;
end;
$$;

-- Status changes with the review rules:
--   * to Review: the reviewer hears about it straight away
--   * to Done: only the reviewer or a workspace admin
--   * back from Review (or Done): only with a comment; owners hear about it
--   * Cancelled: the maker, the reviewer or an admin
create or replace function public.work_set_status(
  p_task uuid,
  p_status text,
  p_comment text default null,
  p_actor uuid default null
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
      completed_at = case when p_status = 'done' then now() else null end,
      review_requested_at = case when p_status = 'review' then now() else review_requested_at end
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

create or replace function public.work_add_comment(
  p_task uuid,
  p_body text,
  p_mentions uuid[] default '{}',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_task public.work_tasks := work_private.editable_task(p_task, v_uid);
  v_id uuid;
  v_user uuid;
  v_mentioned uuid[] := '{}';
begin
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Write a comment first';
  end if;
  insert into public.work_comments (task_id, author_id, body)
  values (p_task, v_uid, trim(p_body))
  returning id into v_id;

  -- Only people who can open the task can be mentioned; others are skipped.
  foreach v_user in array coalesce(p_mentions, '{}') loop
    if v_user <> v_uid and not (v_user = any (v_mentioned)) and work_private.can_view_task(p_task, v_user) then
      insert into public.work_comment_mentions (comment_id, user_id) values (v_id, v_user);
      v_mentioned := array_append(v_mentioned, v_user);
      perform work_private.notify(v_user, 'mention', v_task.workspace_id, v_task.project_id, p_task, v_uid,
        jsonb_build_object('title', v_task.title, 'comment_id', v_id));
    end if;
  end loop;

  -- Everyone else on the task: owners, maker and reviewer.
  for v_user in
    select a.user_id from public.work_task_assignees a where a.task_id = p_task
    union select v_task.created_by
    union select v_task.reviewer_id
  loop
    if v_user is not null and not (v_user = any (v_mentioned)) and work_private.can_view_task(p_task, v_user) then
      perform work_private.notify(v_user, 'comment', v_task.workspace_id, v_task.project_id, p_task, v_uid,
        jsonb_build_object('title', v_task.title, 'comment_id', v_id));
    end if;
  end loop;
  return v_id;
end;
$$;

-- Move a task (with its subtasks) to another project in the same workspace.
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
begin
  if v_task.parent_id is not null then
    raise exception 'Move the parent task; its subtasks move with it';
  end if;
  select * into v_target from public.work_projects where id = p_project;
  if v_target.id is null or not work_private.can_view_project(p_project, v_uid) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_target.workspace_id <> v_task.workspace_id then
    raise exception 'Tasks can only move within their workspace';
  end if;
  if v_target.archived_at is not null then
    raise exception 'This project is archived';
  end if;
  update public.work_tasks set project_id = p_project
  where id = p_task or parent_id = p_task;
end;
$$;

-- Copy a task with its subtasks, owners and reviewer; the copy starts at To do.
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
    created_by, reviewer_id, position)
  values (v_task.workspace_id, v_task.project_id, left(v_task.title || ' (copy)', 300), v_task.description,
    v_task.priority, v_task.due_at, v_uid, coalesce(v_task.reviewer_id, v_uid), extract(epoch from now()))
  returning id into v_new;
  insert into public.work_task_assignees (task_id, user_id, assigned_by)
  select v_new, user_id, v_uid from public.work_task_assignees where task_id = p_task;

  for v_child in
    select * from public.work_tasks
    where parent_id = p_task and archived_at is null and status <> 'cancelled'
    order by position, created_at
  loop
    insert into public.work_tasks (workspace_id, project_id, parent_id, title, description, priority,
      due_at, created_by, reviewer_id, position)
    values (v_child.workspace_id, v_child.project_id, v_new, v_child.title, v_child.description,
      v_child.priority, v_child.due_at, v_uid, coalesce(v_child.reviewer_id, v_uid), v_child.position)
    returning id into v_child_new;
    insert into public.work_task_assignees (task_id, user_id, assigned_by)
    select v_child_new, user_id, v_uid from public.work_task_assignees where task_id = v_child.id;
  end loop;
  return v_new;
end;
$$;

-- Archive (trash) instead of delete: admins, or members for tasks they made.
create or replace function public.work_archive_task(p_task uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_task public.work_tasks := work_private.editable_task(p_task, v_uid);
  v_role text := work_private.role_in(v_task.workspace_id, v_uid);
  v_now timestamptz := now();
begin
  if not (v_role = 'admin' or (v_role = 'member' and v_task.created_by = v_uid)) then
    raise exception 'Only admins, or the member who made it, can archive this task' using errcode = '42501';
  end if;
  update public.work_tasks set archived_at = v_now, archived_by = v_uid
  where (id = p_task or parent_id = p_task) and archived_at is null;
end;
$$;

create or replace function public.work_restore_task(p_task uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_task public.work_tasks;
  v_role text;
begin
  select * into v_task from public.work_tasks where id = p_task;
  if v_task.id is null or not work_private.can_view_task(p_task, v_uid) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  v_role := work_private.role_in(v_task.workspace_id, v_uid);
  if not (v_role = 'admin' or (v_role = 'member' and v_task.created_by = v_uid)) then
    raise exception 'Only admins, or the member who made it, can restore this task' using errcode = '42501';
  end if;
  if v_task.parent_id is not null and exists (
    select 1 from public.work_tasks where id = v_task.parent_id and archived_at is not null
  ) then
    raise exception 'Restore the parent task first';
  end if;
  update public.work_tasks set archived_at = null, archived_by = null
  where id = p_task or (parent_id = p_task and archived_at = v_task.archived_at);
end;
$$;

-- Register a file the user just uploaded to the "work" bucket.
create or replace function public.work_add_attachment(
  p_task uuid,
  p_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_task public.work_tasks := work_private.editable_task(p_task, v_uid);
  v_id uuid;
begin
  if public.work_file_task(p_path) is distinct from p_task then
    raise exception 'File does not belong to this task';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'work' and name = p_path) then
    raise exception 'Upload the file first';
  end if;
  insert into public.work_attachments (task_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_task.id, p_path, p_file_name, p_mime_type, p_size_bytes, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- Removes the row and returns the storage path, so the caller can remove the file.
create or replace function public.work_remove_attachment(p_attachment uuid, p_actor uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_file public.work_attachments;
  v_task public.work_tasks;
begin
  select * into v_file from public.work_attachments where id = p_attachment;
  if v_file.id is null then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  v_task := work_private.editable_task(v_file.task_id, v_uid);
  if v_file.uploaded_by is distinct from v_uid and work_private.role_in(v_task.workspace_id, v_uid) is distinct from 'admin' then
    raise exception 'Only the person who added this file, or an admin, can remove it' using errcode = '42501';
  end if;
  delete from public.work_attachments where id = p_attachment;
  return v_file.storage_path;
end;
$$;

-- Search titles, descriptions and comments within what the user may see.
create or replace function public.work_search(p_query text, p_limit int default 30, p_actor uuid default null)
returns setof public.work_tasks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_pattern text;
begin
  if (select auth.role()) = 'service_role' then v_uid := p_actor; else v_uid := (select auth.uid()); end if;
  if v_uid is null or char_length(trim(coalesce(p_query, ''))) < 2 then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select t.*
    from public.work_tasks t
    where t.archived_at is null
      and (
        t.title ilike v_pattern
        or t.description ilike v_pattern
        or exists (select 1 from public.work_comments c where c.task_id = t.id and c.body ilike v_pattern)
      )
      and work_private.can_view_task(t.id, v_uid)
    order by t.updated_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------------
-- For the API and jobs (secret key only)
-- ---------------------------------------------------------------------------

create or replace function public.work_api_can_view_task(p_task uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.can_view_task(p_task, p_user);
$$;

create or replace function public.work_api_can_view_project(p_project uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.can_view_project(p_project, p_user);
$$;

create or replace function public.work_api_can_see_user(p_viewer uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.can_see_user(p_viewer, p_user);
$$;

-- Names and e-mail of the given people, as far as p_viewer may see them.
create or replace function public.work_api_visible_people(p_viewer uuid, p_ids uuid[])
returns table (id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.email
  from public.profiles p
  where p.id = any (p_ids) and work_private.can_see_user(p_viewer, p.id);
$$;

create or replace function public.work_api_visible_projects(p_user uuid)
returns setof public.work_projects
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.work_projects p
  where work_private.can_view_project(p.id, p_user)
  order by p.name;
$$;

create or replace function public.work_api_list_tasks(
  p_user uuid,
  p_project uuid default null,
  p_workspace uuid default null,
  p_status text default null,
  p_assignee uuid default null,
  p_reviewer uuid default null,
  p_include_subtasks boolean default true,
  p_limit int default 50,
  p_offset int default 0
)
returns setof public.work_tasks
language sql
stable
security definer
set search_path = ''
as $$
  select t.*
  from public.work_tasks t
  where t.archived_at is null
    and (p_project is null or t.project_id = p_project)
    and (p_workspace is null or t.workspace_id = p_workspace)
    and (p_status is null or t.status = p_status)
    and (p_reviewer is null or t.reviewer_id = p_reviewer)
    and (p_include_subtasks or t.parent_id is null)
    and (p_assignee is null or exists (
      select 1 from public.work_task_assignees a where a.task_id = t.id and a.user_id = p_assignee))
    and work_private.can_view_task(t.id, p_user)
  order by t.due_at nulls last, t.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Claim pending notifications for sending. Rows the user can no longer open
-- are skipped. A claim that was not confirmed within 10 minutes is retried.
create or replace function public.work_claim_notifications(p_delivery text, p_limit int default 100)
returns setof public.work_notifications
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.work_notifications n
  set sent_at = now(), skipped = true
  where n.sent_at is null
    and n.delivery = p_delivery
    and n.task_id is not null
    and not work_private.can_view_task(n.task_id, n.user_id);

  return query
    update public.work_notifications n
    set claimed_at = now(), attempts = n.attempts + 1
    where n.id in (
      select q.id from public.work_notifications q
      where q.sent_at is null
        and q.delivery = p_delivery
        and q.attempts < 5
        and (q.claimed_at is null or q.claimed_at < now() - interval '10 minutes')
      order by q.id
      limit greatest(coalesce(p_limit, 100), 1)
      for update skip locked
    )
    returning n.*;
end;
$$;

create or replace function public.work_finish_notifications(p_ids bigint[], p_sent boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.work_notifications
  set sent_at = case when p_sent then now() else null end,
      claimed_at = case when p_sent then claimed_at else null end
  where id = any (p_ids);
$$;

-- Daily: deadlines tomorrow (in each person's time zone) and overdue tasks,
-- guests whose access ends within 3 days, and expired access in the log.
create or replace function public.work_daily_checks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due int := 0;
  v_overdue int := 0;
  v_expiring int := 0;
  v_expired int := 0;
  r record;
begin
  for r in
    select t.id, t.workspace_id, t.project_id, t.title, t.due_at, a.user_id,
           coalesce(pr.time_zone, 'Europe/Amsterdam') as tz
    from public.work_tasks t
    join public.work_task_assignees a on a.task_id = t.id
    join public.profiles pr on pr.id = a.user_id
    where t.archived_at is null
      and t.status in ('todo', 'in_progress')
      and t.due_at is not null
      and t.due_at < now() + interval '3 days'
  loop
    if r.due_at <= now() then
      perform work_private.notify(r.user_id, 'overdue', r.workspace_id, r.project_id, r.id, null,
        jsonb_build_object('title', r.title, 'due_at', r.due_at),
        'overdue:' || r.id || ':' || r.user_id || ':' || r.due_at);
      v_overdue := v_overdue + 1;
    elsif (r.due_at at time zone r.tz)::date = (now() at time zone r.tz)::date + 1 then
      perform work_private.notify(r.user_id, 'due_soon', r.workspace_id, r.project_id, r.id, null,
        jsonb_build_object('title', r.title, 'due_at', r.due_at),
        'due_soon:' || r.id || ':' || r.user_id || ':' || r.due_at);
      v_due := v_due + 1;
    end if;
  end loop;

  for r in
    select m.workspace_id, m.user_id, m.access_expires_at, w.name
    from public.work_members m
    join public.work_workspaces w on w.id = m.workspace_id
    where m.deactivated_at is null
      and m.access_expires_at between now() and now() + interval '3 days'
      and m.expiry_warned_at is null
  loop
    perform work_private.notify(r.user_id, 'access_expiring', r.workspace_id, null, null, null,
      jsonb_build_object('workspace', r.name, 'access_expires_at', r.access_expires_at));
    update public.work_members set expiry_warned_at = now()
    where workspace_id = r.workspace_id and user_id = r.user_id;
    v_expiring := v_expiring + 1;
  end loop;

  for r in
    select pm.project_id, pm.user_id, pm.access_expires_at, p.workspace_id, p.name
    from public.work_project_members pm
    join public.work_projects p on p.id = pm.project_id
    where pm.access_expires_at between now() and now() + interval '3 days'
      and pm.expiry_warned_at is null
  loop
    perform work_private.notify(r.user_id, 'access_expiring', r.workspace_id, r.project_id, null, null,
      jsonb_build_object('project', r.name, 'access_expires_at', r.access_expires_at));
    update public.work_project_members set expiry_warned_at = now()
    where project_id = r.project_id and user_id = r.user_id;
    v_expiring := v_expiring + 1;
  end loop;

  for r in
    update public.work_members set expiry_logged_at = now()
    where access_expires_at <= now() and expiry_logged_at is null and deactivated_at is null
    returning workspace_id, user_id, role, access_expires_at
  loop
    perform work_private.log_access(r.workspace_id, null, r.user_id, 'expired', r.role, null,
      jsonb_build_object('access_expires_at', r.access_expires_at));
    v_expired := v_expired + 1;
  end loop;

  for r in
    update public.work_project_members pm set expiry_logged_at = now()
    from public.work_projects p
    where p.id = pm.project_id and pm.access_expires_at <= now() and pm.expiry_logged_at is null
    returning p.workspace_id, pm.project_id, pm.user_id, pm.access_expires_at
  loop
    perform work_private.log_access(r.workspace_id, r.project_id, r.user_id, 'expired',
      work_private.role_in(r.workspace_id, r.user_id), null,
      jsonb_build_object('access_expires_at', r.access_expires_at));
    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object('due_soon', v_due, 'overdue', v_overdue, 'expiring', v_expiring, 'expired', v_expired);
end;
$$;

-- Empty the trash: tasks archived more than 30 days ago. Returns the file
-- paths so the job can remove them from storage.
create or replace function public.work_purge_trash()
returns setof text
language sql
security definer
set search_path = ''
as $$
  with doomed as (
    select id from public.work_tasks
    where archived_at < now() - interval '30 days'
  ), files as (
    select a.storage_path
    from public.work_attachments a
    join public.work_tasks t on t.id = a.task_id
    where t.id in (select id from doomed) or t.parent_id in (select id from doomed)
  ), gone as (
    delete from public.work_tasks where id in (select id from doomed)
  )
  select storage_path from files;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema work_private from public, anon, authenticated;
grant execute on all functions in schema work_private to service_role;

do $$
declare
  v_fn text;
begin
  -- Signed-in users: RLS helpers and the write functions.
  foreach v_fn in array array[
    'work_my_role(uuid)',
    'work_can_view_project(uuid)',
    'work_can_view_task(uuid)',
    'work_can_see_user(uuid)',
    'work_can_see_member(uuid, uuid)',
    'work_create_workspace(text, text)',
    'work_rename_workspace(uuid, text, uuid)',
    'work_set_member(uuid, uuid, text, timestamptz, uuid)',
    'work_deactivate_member(uuid, uuid, uuid, uuid)',
    'work_reactivate_member(uuid, uuid, uuid)',
    'work_create_project(uuid, text, text, text, boolean, uuid)',
    'work_update_project(uuid, text, text, text, boolean, boolean, uuid)',
    'work_add_project_member(uuid, uuid, timestamptz, uuid)',
    'work_remove_project_member(uuid, uuid, uuid)',
    'work_create_invite(uuid, uuid, text, text, timestamptz, text, uuid)',
    'work_revoke_invite(uuid, uuid)',
    'work_accept_invite(text)',
    'work_create_task(uuid, text, text, text, timestamptz, uuid, uuid[], uuid, text, boolean, uuid)',
    'work_update_task(uuid, jsonb, uuid)',
    'work_set_assignees(uuid, uuid[], uuid)',
    'work_set_status(uuid, text, text, uuid)',
    'work_add_comment(uuid, text, uuid[], uuid)',
    'work_move_task(uuid, uuid, uuid)',
    'work_duplicate_task(uuid, uuid)',
    'work_archive_task(uuid, uuid)',
    'work_restore_task(uuid, uuid)',
    'work_add_attachment(uuid, text, text, text, bigint, uuid)',
    'work_remove_attachment(uuid, uuid)',
    'work_search(text, int, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;

  -- Anyone holding an invite link may see what it is for.
  revoke execute on function public.work_invite_preview(text) from public;
  grant execute on function public.work_invite_preview(text) to anon, authenticated, service_role;

  -- The API and jobs only.
  foreach v_fn in array array[
    'work_api_can_view_task(uuid, uuid)',
    'work_api_can_view_project(uuid, uuid)',
    'work_api_can_see_user(uuid, uuid)',
    'work_api_visible_projects(uuid)',
    'work_api_visible_people(uuid, uuid[])',
    'work_api_list_tasks(uuid, uuid, uuid, text, uuid, uuid, boolean, int, int)',
    'work_claim_notifications(text, int)',
    'work_finish_notifications(bigint[], boolean)',
    'work_daily_checks()',
    'work_purge_trash()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
end;
$$;

-- work_file_task is harmless (parses a path) and used by the storage policies.
grant execute on function public.work_file_task(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket "work". Path: task/<task id>/<random>-<file name>.
-- Downloads only through short-lived signed URLs made for people who may
-- open the task.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('work', 'work', false, 26214400)
on conflict (id) do nothing;

create policy "Work files follow their task"
  on storage.objects for select to authenticated
  using (bucket_id = 'work' and public.work_can_view_task(public.work_file_task(name)));

create policy "Work files can be added to tasks you can open"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'work'
    and public.work_can_view_task(public.work_file_task(name))
    and exists (
      select 1 from public.work_tasks t
      where t.id = public.work_file_task(name) and t.archived_at is null
    )
  );

create policy "Work files can be removed by who added them or an admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'work'
    and public.work_can_view_task(public.work_file_task(name))
    and exists (
      select 1
      from public.work_attachments a
      join public.work_tasks t on t.id = a.task_id
      where a.storage_path = name
        and (a.uploaded_by = (select auth.uid()) or public.work_my_role(t.workspace_id) = 'admin')
    )
  );
