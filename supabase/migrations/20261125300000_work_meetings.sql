-- Meetings in Work (feedback 1f134c69: "Losse punten verzamelen als agenda en
-- doorzetten naar mensen").
--
-- A meeting is a recurring agenda ("Weekly with Floris", "Team meeting") in a
-- workspace. Each round of it is a session; the open session is the agenda
-- people drop points on. Closing the meeting closes the session and carries
-- the points that were not discussed over to a new session of the same
-- meeting. A point can become a normal Work task in the inbox of whoever picks
-- it up (or in a project), and keeps a link to that task.
--
-- Who sees a meeting (same membership model as the workspaces):
--   workspace  every admin and member of the workspace (in a private
--              workspace: the owner and the people the owner invited)
--   invited    only the person who made it and the people picked; other
--              admins of the workspace do not see it
-- Everyone has to be an active member of the workspace. Guests only see a
-- meeting they were picked for.
--
-- Rights are enforced like the rest of Work: reads through RLS (rules once in
-- work_private), writes only through the work_* functions below, the API with
-- p_actor.
--
-- Not run on production by this file; run it through the Supabase MCP.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.work_meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.work_workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  visibility text not null default 'workspace' check (visibility in ('workspace', 'invited')),
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index work_meetings_workspace_idx on public.work_meetings (workspace_id);

create table public.work_meeting_members (
  meeting_id uuid not null references public.work_meetings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

create index work_meeting_members_user_idx on public.work_meeting_members (user_id);

-- One round of a meeting. The open session (closed_at is null) is the agenda.
create table public.work_meeting_sessions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.work_meetings (id) on delete cascade,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null
);

create index work_meeting_sessions_meeting_idx on public.work_meeting_sessions (meeting_id, opened_at desc);
create unique index work_meeting_sessions_one_open on public.work_meeting_sessions (meeting_id) where closed_at is null;

create table public.work_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.work_meetings (id) on delete cascade,
  session_id uuid not null references public.work_meeting_sessions (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  note text check (char_length(note) <= 5000),
  added_by uuid references public.profiles (id) on delete set null,
  -- Where the point came from: the portal, or Claude through the MCP.
  source text not null default 'portal' check (source in ('portal', 'claude')),
  -- open: still to discuss. discussed. dropped (struck). forwarded: not
  -- discussed, moved on to the next session (forwarded_to).
  status text not null default 'open' check (status in ('open', 'discussed', 'dropped', 'forwarded')),
  -- What was decided, or a short note, written during the meeting.
  decision text check (char_length(decision) <= 5000),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  -- The Work task made from this point.
  task_id uuid references public.work_tasks (id) on delete set null,
  -- The same point in the previous session, and how many times it moved on.
  carried_from uuid references public.work_agenda_items (id) on delete set null,
  carried_count integer not null default 0 check (carried_count >= 0),
  forwarded_to uuid references public.work_agenda_items (id) on delete set null,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index work_agenda_items_session_idx on public.work_agenda_items (session_id, position);
create index work_agenda_items_meeting_idx on public.work_agenda_items (meeting_id);
create index work_agenda_items_task_idx on public.work_agenda_items (task_id) where task_id is not null;

create trigger work_meetings_set_updated_at before update on public.work_meetings
  for each row execute function public.set_updated_at();
create trigger work_agenda_items_set_updated_at before update on public.work_agenda_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access rules (work_private)
-- ---------------------------------------------------------------------------

create or replace function work_private.can_view_meeting(p_meeting uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      work_private.role_in(m.workspace_id, p_user) is not null
      and (
        m.created_by = p_user
        or exists (select 1 from public.work_meeting_members mm where mm.meeting_id = m.id and mm.user_id = p_user)
        or (m.visibility = 'workspace' and work_private.role_in(m.workspace_id, p_user) in ('admin', 'member'))
      )
    from public.work_meetings m
    where m.id = p_meeting
  ), false);
$$;

-- Rename, change who is in, close and archive: the maker, and the admins of
-- the workspace for a meeting everybody in the workspace sees. Admins do not
-- get to manage a meeting they cannot see.
create or replace function work_private.can_manage_meeting(p_meeting uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      work_private.can_view_meeting(m.id, p_user)
      and (
        m.created_by = p_user
        or (m.visibility = 'workspace' and work_private.role_in(m.workspace_id, p_user) = 'admin')
      )
    from public.work_meetings m
    where m.id = p_meeting
  ), false);
$$;

-- Someone picked for a meeting is an active member of its workspace.
create or replace function work_private.check_meeting_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select workspace_id into v_workspace from public.work_meetings where id = new.meeting_id;
  if work_private.role_in(v_workspace, new.user_id) is null then
    raise exception 'Everyone in a meeting has to be in the workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger work_meeting_members_check before insert on public.work_meeting_members
  for each row execute function work_private.check_meeting_member();

-- The inbox project of someone else (their tasks from a meeting land there).
-- Same as work_ensure_inbox, for a given person.
create or replace function work_private.inbox_of(p_owner uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_project uuid;
begin
  if not exists (select 1 from public.profiles where id = p_owner and role in ('admin', 'member', 'external', 'client')) then
    raise exception 'This person has no Work' using errcode = '42501';
  end if;
  select id into v_workspace from public.work_workspaces where owner_id = p_owner and kind = 'inbox';
  if v_workspace is null then
    insert into public.work_workspaces (name, slug, created_by, kind, owner_id)
    values ('Inbox', work_private.unique_slug('inbox-' || left(replace(p_owner::text, '-', ''), 8)), p_owner, 'inbox', p_owner)
    on conflict (owner_id) where kind = 'inbox' do nothing
    returning id into v_workspace;
    if v_workspace is null then
      select id into v_workspace from public.work_workspaces where owner_id = p_owner and kind = 'inbox';
    else
      insert into public.work_members (workspace_id, user_id, role, invited_by)
      values (v_workspace, p_owner, 'admin', p_owner);
    end if;
  end if;
  select id into v_project from public.work_projects
  where workspace_id = v_workspace and archived_at is null
  order by created_at
  limit 1;
  if v_project is null then
    insert into public.work_projects (workspace_id, name, visibility, created_by)
    values (v_workspace, 'Inbox', 'private', p_owner)
    returning id into v_project;
  end if;
  return v_project;
end;
$$;

revoke execute on function work_private.can_view_meeting(uuid, uuid) from public, anon, authenticated;
revoke execute on function work_private.can_manage_meeting(uuid, uuid) from public, anon, authenticated;
revoke execute on function work_private.check_meeting_member() from public, anon, authenticated;
revoke execute on function work_private.inbox_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: reads only
-- ---------------------------------------------------------------------------

create or replace function public.work_can_view_meeting(p_meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.can_view_meeting(p_meeting, (select auth.uid()));
$$;

alter table public.work_meetings enable row level security;
alter table public.work_meeting_members enable row level security;
alter table public.work_meeting_sessions enable row level security;
alter table public.work_agenda_items enable row level security;

revoke all on public.work_meetings, public.work_meeting_members, public.work_meeting_sessions, public.work_agenda_items
  from anon, authenticated;
grant select on public.work_meetings, public.work_meeting_members, public.work_meeting_sessions, public.work_agenda_items
  to authenticated;

create policy "Meetings are visible to who may see them"
  on public.work_meetings for select to authenticated
  using (public.work_can_view_meeting(id));

create policy "Meeting members follow their meeting"
  on public.work_meeting_members for select to authenticated
  using (public.work_can_view_meeting(meeting_id));

create policy "Meeting sessions follow their meeting"
  on public.work_meeting_sessions for select to authenticated
  using (public.work_can_view_meeting(meeting_id));

create policy "Agenda items follow their meeting"
  on public.work_agenda_items for select to authenticated
  using (public.work_can_view_meeting(meeting_id));

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create or replace function public.work_create_meeting(
  p_workspace uuid,
  p_name text,
  p_visibility text default 'workspace',
  p_members uuid[] default '{}',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_workspace public.work_workspaces;
  v_id uuid;
  v_user uuid;
begin
  select * into v_workspace from public.work_workspaces where id = p_workspace;
  if v_workspace.id is null or work_private.role_in(p_workspace, v_uid) is null then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  if work_private.role_in(p_workspace, v_uid) not in ('admin', 'member') then
    raise exception 'Guests cannot start a meeting' using errcode = '42501';
  end if;
  if v_workspace.kind = 'inbox' then
    raise exception 'Your inbox is for tasks. Use a workspace for meetings' using errcode = '42501';
  end if;
  if v_workspace.archived_at is not null then
    raise exception 'This workspace is archived';
  end if;
  if p_visibility not in ('workspace', 'invited') then
    raise exception 'Unknown visibility';
  end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Add a name';
  end if;

  insert into public.work_meetings (workspace_id, name, visibility, created_by)
  values (p_workspace, trim(p_name), p_visibility, v_uid)
  returning id into v_id;

  if p_visibility = 'invited' then
    foreach v_user in array coalesce(p_members, '{}') loop
      if v_user <> v_uid then
        insert into public.work_meeting_members (meeting_id, user_id, added_by)
        values (v_id, v_user, v_uid)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  insert into public.work_meeting_sessions (meeting_id) values (v_id);
  return v_id;
end;
$$;

-- Name, who sees it, who is in, archive. p_members replaces the list (for
-- 'invited'); switching to 'workspace' clears it.
create or replace function public.work_update_meeting(
  p_meeting uuid,
  p_name text,
  p_visibility text,
  p_members uuid[] default '{}',
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
  v_meeting public.work_meetings;
  v_user uuid;
begin
  select * into v_meeting from public.work_meetings where id = p_meeting;
  if v_meeting.id is null or not work_private.can_view_meeting(p_meeting, v_uid) then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  if not work_private.can_manage_meeting(p_meeting, v_uid) then
    raise exception 'Only the person who made this meeting can change it' using errcode = '42501';
  end if;
  if p_visibility not in ('workspace', 'invited') then
    raise exception 'Unknown visibility';
  end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Add a name';
  end if;

  update public.work_meetings
  set name = trim(p_name),
      visibility = p_visibility,
      archived_at = case when p_archived then coalesce(archived_at, now()) else null end
  where id = p_meeting;

  delete from public.work_meeting_members
  where meeting_id = p_meeting
    and (p_visibility = 'workspace' or user_id <> all (coalesce(p_members, '{}')));
  if p_visibility = 'invited' then
    foreach v_user in array coalesce(p_members, '{}') loop
      if v_user is distinct from v_meeting.created_by then
        insert into public.work_meeting_members (meeting_id, user_id, added_by)
        values (p_meeting, v_user, v_uid)
        on conflict do nothing;
      end if;
    end loop;
  end if;
end;
$$;

-- A point on the agenda (the open session). With an id chosen by the device it
-- is idempotent, and p_at is when it happened offline (client_time: not in the
-- future, at most 14 days old). p_source only counts for the API: the portal
-- is always 'portal'.
create or replace function public.work_add_agenda_item(
  p_meeting uuid,
  p_title text,
  p_note text default null,
  p_id uuid default null,
  p_at timestamptz default null,
  p_source text default 'portal',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_meeting public.work_meetings;
  v_session uuid;
  v_existing public.work_agenda_items;
  v_id uuid;
  v_title text := trim(coalesce(p_title, ''));
  v_source text := case when (select auth.role()) = 'service_role' and p_source = 'claude' then 'claude' else 'portal' end;
begin
  if p_id is not null then
    select * into v_existing from public.work_agenda_items where id = p_id;
    if v_existing.id is not null then
      if v_existing.added_by is distinct from v_uid then
        raise exception 'This id is already taken' using errcode = '23505';
      end if;
      return v_existing.id;
    end if;
  end if;

  select * into v_meeting from public.work_meetings where id = p_meeting;
  if v_meeting.id is null or not work_private.can_view_meeting(p_meeting, v_uid) then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  if v_meeting.archived_at is not null then
    raise exception 'This meeting is archived';
  end if;
  if char_length(v_title) not between 1 and 300 then
    raise exception 'A point needs a title of at most 300 characters';
  end if;

  select id into v_session from public.work_meeting_sessions where meeting_id = p_meeting and closed_at is null;
  if v_session is null then
    insert into public.work_meeting_sessions (meeting_id) values (p_meeting) returning id into v_session;
  end if;

  insert into public.work_agenda_items (id, meeting_id, session_id, title, note, added_by, source, position, created_at)
  values (
    coalesce(p_id, gen_random_uuid()), p_meeting, v_session, v_title, nullif(trim(coalesce(p_note, '')), ''),
    v_uid, v_source, extract(epoch from now()), work_private.client_time(p_at)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Fields: title and note (who added the point, or who manages the meeting),
-- status (open, discussed, dropped) and decision (anyone in the meeting).
-- Only points of the open session; a forwarded point is history.
create or replace function public.work_update_agenda_item(p_item uuid, p_fields jsonb, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_item public.work_agenda_items;
  v_session public.work_meeting_sessions;
  v_edit boolean;
  v_status text;
  v_decision text;
  v_title text;
begin
  select * into v_item from public.work_agenda_items where id = p_item;
  if v_item.id is null or not work_private.can_view_meeting(v_item.meeting_id, v_uid) then
    raise exception 'Point not found' using errcode = 'P0002';
  end if;
  select * into v_session from public.work_meeting_sessions where id = v_item.session_id;
  if v_session.closed_at is not null or v_item.status = 'forwarded' then
    raise exception 'This meeting is closed: its points can no longer be changed';
  end if;
  v_edit := v_item.added_by = v_uid or work_private.can_manage_meeting(v_item.meeting_id, v_uid);

  if p_fields ? 'title' or p_fields ? 'note' then
    if not v_edit then
      raise exception 'Only the person who added this point can change its text' using errcode = '42501';
    end if;
    if p_fields ? 'title' then
      v_title := trim(coalesce(p_fields ->> 'title', ''));
      if char_length(v_title) not between 1 and 300 then
        raise exception 'A point needs a title of at most 300 characters';
      end if;
      update public.work_agenda_items set title = v_title where id = p_item;
    end if;
    if p_fields ? 'note' then
      update public.work_agenda_items set note = nullif(trim(coalesce(p_fields ->> 'note', '')), '') where id = p_item;
    end if;
  end if;

  if p_fields ? 'status' then
    v_status := p_fields ->> 'status';
    if v_status not in ('open', 'discussed', 'dropped') then
      raise exception 'A point is open, discussed or dropped';
    end if;
    update public.work_agenda_items set status = v_status where id = p_item;
  end if;

  if p_fields ? 'decision' then
    v_decision := nullif(trim(coalesce(p_fields ->> 'decision', '')), '');
    if v_decision is not null and char_length(v_decision) > 5000 then
      raise exception 'At most 5,000 characters';
    end if;
    update public.work_agenda_items
    set decision = v_decision,
        decided_by = case when v_decision is null then null else v_uid end,
        decided_at = case when v_decision is null then null else now() end
    where id = p_item;
  end if;
end;
$$;

-- "Make task": a normal Work task from a point. Without a project it lands in
-- the inbox of the owner; with p_project in that project (owner and maker
-- both need access). The owner has to be in the meeting. The point links to
-- the task and counts as discussed.
create or replace function public.work_agenda_item_to_task(
  p_item uuid,
  p_owner uuid default null,
  p_due_at timestamptz default null,
  p_project uuid default null,
  p_title text default null,
  p_priority text default 'normal',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_item public.work_agenda_items;
  v_meeting public.work_meetings;
  v_owner uuid;
  v_project uuid;
  v_workspace uuid;
  v_title text;
  v_description text;
  v_by text;
  v_task uuid;
begin
  select * into v_item from public.work_agenda_items where id = p_item;
  if v_item.id is null or not work_private.can_view_meeting(v_item.meeting_id, v_uid) then
    raise exception 'Point not found' using errcode = 'P0002';
  end if;
  select * into v_meeting from public.work_meetings where id = v_item.meeting_id;
  if v_item.task_id is not null then
    raise exception 'This point already has a task';
  end if;
  if v_item.status in ('forwarded', 'dropped') then
    raise exception 'Reopen the point first: it was % ', case v_item.status when 'dropped' then 'dropped' else 'moved to the next meeting' end;
  end if;

  v_owner := coalesce(p_owner, v_uid);
  if not work_private.can_view_meeting(v_item.meeting_id, v_owner) then
    raise exception 'The owner has to be in this meeting' using errcode = '42501';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Unknown priority';
  end if;

  select coalesce(full_name, email) into v_by from public.profiles where id = v_item.added_by;
  v_title := coalesce(nullif(trim(coalesce(p_title, '')), ''), v_item.title);
  v_description := concat_ws(
    E'\n\n',
    v_item.note,
    case when v_item.decision is not null then 'Decision: ' || v_item.decision end,
    'From the agenda of "' || v_meeting.name || '"' || case when v_by is not null then ', brought up by ' || v_by else '' end || '.'
  );

  if p_project is not null then
    if not work_private.can_view_project(p_project, v_uid) or not work_private.can_view_project(p_project, v_owner) then
      raise exception 'Project not found' using errcode = 'P0002';
    end if;
    v_task := public.work_create_task(
      p_project => p_project, p_title => v_title, p_description => v_description, p_priority => p_priority,
      p_due_at => p_due_at, p_assignees => array[v_owner], p_actor => v_uid
    );
  elsif v_owner = v_uid then
    v_task := public.work_create_task(
      p_project => work_private.inbox_of(v_uid), p_title => v_title, p_description => v_description,
      p_priority => p_priority, p_due_at => p_due_at, p_assignees => array[v_uid], p_actor => v_uid
    );
  else
    -- Someone else's inbox: only the owner is in it, so the owner is the
    -- reviewer too (work_create_task needs the maker in the project).
    v_project := work_private.inbox_of(v_owner);
    select workspace_id into v_workspace from public.work_projects where id = v_project;
    insert into public.work_tasks (workspace_id, project_id, title, description, priority, due_at, created_by, reviewer_id, position)
    values (v_workspace, v_project, v_title, nullif(v_description, ''), p_priority, p_due_at, v_uid, v_owner, extract(epoch from now()))
    returning id into v_task;
    insert into public.work_task_assignees (task_id, user_id, assigned_by) values (v_task, v_owner, v_uid);
    perform work_private.notify(v_owner, 'assigned', v_workspace, v_project, v_task, v_uid, jsonb_build_object('title', v_title));
  end if;

  update public.work_agenda_items
  set task_id = v_task,
      status = case when status = 'open' then 'discussed' else status end
  where id = p_item;
  return v_task;
end;
$$;

-- Close the meeting: the session is done, and the points that were not
-- discussed (still open) move on to a new session of the same meeting. The
-- old point becomes 'forwarded' and points to the new one; the new one counts
-- how often it moved on. Returns the new session.
create or replace function public.work_close_meeting(p_meeting uuid, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_meeting public.work_meetings;
  v_session public.work_meeting_sessions;
  v_new uuid;
  v_item public.work_agenda_items;
  v_copy uuid;
begin
  select * into v_meeting from public.work_meetings where id = p_meeting;
  if v_meeting.id is null or not work_private.can_view_meeting(p_meeting, v_uid) then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  if not work_private.can_manage_meeting(p_meeting, v_uid) then
    raise exception 'Only the person who made this meeting can close it' using errcode = '42501';
  end if;
  if v_meeting.archived_at is not null then
    raise exception 'This meeting is archived';
  end if;

  select * into v_session from public.work_meeting_sessions
  where meeting_id = p_meeting and closed_at is null
  for update;
  if v_session.id is null then
    raise exception 'This meeting is already closed';
  end if;

  update public.work_meeting_sessions set closed_at = now(), closed_by = v_uid where id = v_session.id;
  insert into public.work_meeting_sessions (meeting_id) values (p_meeting) returning id into v_new;

  for v_item in
    select * from public.work_agenda_items where session_id = v_session.id and status = 'open' order by position, created_at
  loop
    insert into public.work_agenda_items (
      meeting_id, session_id, title, note, added_by, source, carried_from, carried_count, position, created_at
    ) values (
      p_meeting, v_new, v_item.title, v_item.note, v_item.added_by, v_item.source, v_item.id,
      v_item.carried_count + 1, v_item.position, v_item.created_at
    )
    returning id into v_copy;
    update public.work_agenda_items set status = 'forwarded', forwarded_to = v_copy where id = v_item.id;
  end loop;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- For the API and the MCP (secret key): the same rules for the token owner
-- ---------------------------------------------------------------------------

create or replace function public.work_api_can_view_meeting(p_meeting uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select work_private.can_view_meeting(p_meeting, p_user);
$$;

create or replace function public.work_api_visible_meetings(p_user uuid)
returns setof public.work_meetings
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from public.work_meetings m
  where work_private.can_view_meeting(m.id, p_user)
  order by m.name;
$$;

-- Execute rights: signed-in users and the API, nobody else. The api functions
-- are for the secret key only.
revoke execute on function public.work_can_view_meeting(uuid) from public, anon;
grant execute on function public.work_can_view_meeting(uuid) to authenticated, service_role;

revoke execute on function public.work_create_meeting(uuid, text, text, uuid[], uuid) from public, anon;
grant execute on function public.work_create_meeting(uuid, text, text, uuid[], uuid) to authenticated, service_role;
revoke execute on function public.work_update_meeting(uuid, text, text, uuid[], boolean, uuid) from public, anon;
grant execute on function public.work_update_meeting(uuid, text, text, uuid[], boolean, uuid) to authenticated, service_role;
revoke execute on function public.work_add_agenda_item(uuid, text, text, uuid, timestamptz, text, uuid) from public, anon;
grant execute on function public.work_add_agenda_item(uuid, text, text, uuid, timestamptz, text, uuid) to authenticated, service_role;
revoke execute on function public.work_update_agenda_item(uuid, jsonb, uuid) from public, anon;
grant execute on function public.work_update_agenda_item(uuid, jsonb, uuid) to authenticated, service_role;
revoke execute on function public.work_agenda_item_to_task(uuid, uuid, timestamptz, uuid, text, text, uuid) from public, anon;
grant execute on function public.work_agenda_item_to_task(uuid, uuid, timestamptz, uuid, text, text, uuid) to authenticated, service_role;
revoke execute on function public.work_close_meeting(uuid, uuid) from public, anon;
grant execute on function public.work_close_meeting(uuid, uuid) to authenticated, service_role;

revoke execute on function public.work_api_can_view_meeting(uuid, uuid) from public, anon, authenticated;
grant execute on function public.work_api_can_view_meeting(uuid, uuid) to service_role;
revoke execute on function public.work_api_visible_meetings(uuid) from public, anon, authenticated;
grant execute on function public.work_api_visible_meetings(uuid) to service_role;

notify pgrst, 'reload schema';
