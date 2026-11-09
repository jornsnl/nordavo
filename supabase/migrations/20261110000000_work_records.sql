-- Tasks and Work merged into one (feedback Julius, "Tasks en Work samenvoegen").
--
-- Only Work stays. A Work task can hang on a client, lead (company), vacancy,
-- candidate, application or placement, like a portal task could. What was in
-- public.tasks moves to Work with its link, and public.tasks goes to the
-- archive schema.
--
--   * work_task_links      the link of a task to one portal record. Only the
--                          Nordavo team with the module of that record can
--                          read it, so guests and freelancers in Work never
--                          see which client, candidate or lead a task is about.
--   * records project      every record task lands in the private project
--                          "Portal records" of the Nordavo workspace, unless
--                          the maker picks another project. Team members of
--                          the portal (admin, member) are added to the
--                          workspace and that project automatically.
--   * work_create_record_task / work_set_task_link   the write paths (also
--                          used by the portal MCP with p_actor).

-- ---------------------------------------------------------------------------
-- 1. Who may link a task to a record: the portal team with that module
-- ---------------------------------------------------------------------------

create or replace function work_private.can_link(p_user uuid, p_entity_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when p.role = 'admin' then true
      when p.role <> 'member' then false
      when p_entity_type = 'company' then 'sales' = any (p.modules)
      when p_entity_type = 'client' then 'clients' = any (p.modules)
      when p_entity_type in ('vacancy', 'candidate', 'application', 'placement') then 'recruitment' = any (p.modules)
      else false
    end
    from public.profiles p
    where p.id = p_user
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 2. Links
-- ---------------------------------------------------------------------------

create table public.work_task_links (
  task_id uuid primary key references public.work_tasks (id) on delete cascade,
  entity_type text not null
    check (entity_type in ('client', 'vacancy', 'candidate', 'application', 'placement', 'company')),
  entity_id uuid not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index work_task_links_entity_idx on public.work_task_links (entity_type, entity_id);

alter table public.work_task_links enable row level security;

-- Read: the portal team with the module of the record, and only for tasks
-- they can open in Work. Writes go through the functions below.
create policy "Record links are for the team with that module" on public.work_task_links
  for select to authenticated
  using (public.can_access_entity(entity_type) and public.work_can_view_task(task_id));

revoke insert, update, delete on public.work_task_links from authenticated, anon;
grant select on public.work_task_links to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The records project and automatic access for the portal team
-- ---------------------------------------------------------------------------

create or replace function work_private.records_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select id into v_ws from public.work_workspaces where slug = 'nordavo';
  if v_ws is null then
    insert into public.work_workspaces (name, slug, created_by)
    values ('Nordavo', 'nordavo', (select id from public.profiles where role = 'admin' order by created_at limit 1))
    returning id into v_ws;
  end if;
  return v_ws;
end;
$$;

create or replace function work_private.records_project()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := work_private.records_workspace();
  v_project uuid;
begin
  select id into v_project from public.work_projects
  where external_source = 'portal' and external_id = 'records';
  if v_project is null then
    insert into public.work_projects (
      workspace_id, name, description, visibility, created_by, external_source, external_id
    ) values (
      v_ws,
      'Portal records',
      'Tasks on clients, leads, vacancies, candidates and placements. Only the Nordavo team is in this project.',
      'private',
      (select id from public.profiles where role = 'admin' order by created_at limit 1),
      'portal',
      'records'
    )
    returning id into v_project;
  end if;
  return v_project;
end;
$$;

-- A portal team member is in the Nordavo workspace and the records project.
-- Never downgrades a role someone already has in the workspace.
create or replace function work_private.ensure_staff_access(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_ws uuid;
  v_project uuid;
begin
  select role into v_role from public.profiles where id = p_user;
  if v_role is null or v_role not in ('admin', 'member') then
    return;
  end if;
  v_project := work_private.records_project();
  select workspace_id into v_ws from public.work_projects where id = v_project;

  insert into public.work_members (workspace_id, user_id, role)
  values (v_ws, p_user, case when v_role = 'admin' then 'admin' else 'member' end)
  on conflict (workspace_id, user_id) do update
    set deactivated_at = null,
        access_expires_at = null,
        role = case when excluded.role = 'admin' then 'admin'
                    when public.work_members.role = 'guest' then 'member'
                    else public.work_members.role end;

  insert into public.work_project_members (project_id, user_id)
  values (v_project, p_user)
  on conflict (project_id, user_id) do update set access_expires_at = null;
end;
$$;

create or replace function work_private.profiles_staff_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role in ('admin', 'member')
     and (tg_op = 'INSERT' or old.role is distinct from new.role) then
    perform work_private.ensure_staff_access(new.id);
  end if;
  return null;
end;
$$;

create trigger profiles_staff_work_access
  after insert or update of role on public.profiles
  for each row execute function work_private.profiles_staff_access();

do $$
declare
  v_user uuid;
begin
  for v_user in select id from public.profiles where role in ('admin', 'member') loop
    perform work_private.ensure_staff_access(v_user);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Write paths
-- ---------------------------------------------------------------------------

create or replace function work_private.check_record(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  v_found := case p_entity_type
    when 'client' then exists (select 1 from public.clients where id = p_entity_id)
    when 'vacancy' then exists (select 1 from public.vacancies where id = p_entity_id)
    when 'candidate' then exists (select 1 from public.candidates where id = p_entity_id)
    when 'application' then exists (select 1 from public.applications where id = p_entity_id)
    when 'placement' then exists (select 1 from public.placements where id = p_entity_id)
    when 'company' then exists (select 1 from public.companies where id = p_entity_id)
    else false
  end;
  if not v_found then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
end;
$$;

-- A task on a record. p_project defaults to the records project; any project
-- the actor may open works too (the link stays visible to the team only).
create or replace function public.work_create_record_task(
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null,
  p_assignees uuid[] default '{}',
  p_project uuid default null,
  p_status text default 'todo',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := work_private.actor(p_actor);
  v_user uuid;
  v_id uuid;
begin
  if p_entity_type is not null then
    if not work_private.can_link(v_uid, p_entity_type) then
      raise exception 'You cannot link tasks to this kind of record' using errcode = '42501';
    end if;
    perform work_private.check_record(p_entity_type, p_entity_id);
  end if;

  perform work_private.ensure_staff_access(v_uid);
  foreach v_user in array coalesce(p_assignees, '{}') loop
    perform work_private.ensure_staff_access(v_user);
  end loop;

  v_id := public.work_create_task(
    coalesce(p_project, work_private.records_project()),
    p_title,
    p_description,
    coalesce(p_priority, 'normal'),
    p_due_at,
    null,
    coalesce(p_assignees, '{}'),
    null,
    coalesce(p_status, 'todo'),
    false,
    p_actor
  );

  if p_entity_type is not null then
    insert into public.work_task_links (task_id, entity_type, entity_id, created_by)
    values (v_id, p_entity_type, p_entity_id, v_uid);
  end if;
  return v_id;
end;
$$;

-- Link a task to a record, move the link, or clear it (null).
create or replace function public.work_set_task_link(
  p_task uuid,
  p_entity_type text,
  p_entity_id uuid,
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
  v_old public.work_task_links;
begin
  select * into v_old from public.work_task_links where task_id = v_task.id;
  if v_old.task_id is not null and not work_private.can_link(v_uid, v_old.entity_type) then
    raise exception 'You cannot change the record of this task' using errcode = '42501';
  end if;

  if p_entity_type is null then
    delete from public.work_task_links where task_id = v_task.id;
  else
    if not work_private.can_link(v_uid, p_entity_type) then
      raise exception 'You cannot link tasks to this kind of record' using errcode = '42501';
    end if;
    perform work_private.check_record(p_entity_type, p_entity_id);
    insert into public.work_task_links (task_id, entity_type, entity_id, created_by)
    values (v_task.id, p_entity_type, p_entity_id, v_uid)
    on conflict (task_id) do update
      set entity_type = excluded.entity_type, entity_id = excluded.entity_id,
          created_by = excluded.created_by, created_at = now();
  end if;

  insert into public.work_task_activity (task_id, actor_id, action, details)
  values (v_task.id, v_uid, 'updated', jsonb_build_object('record', jsonb_build_object('changed', true)));
end;
$$;

revoke execute on function public.work_create_record_task(text, uuid, text, text, text, timestamptz, uuid[], uuid, text, uuid)
  from public, anon;
grant execute on function public.work_create_record_task(text, uuid, text, text, text, timestamptz, uuid[], uuid, text, uuid)
  to authenticated, service_role;
revoke execute on function public.work_set_task_link(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.work_set_task_link(uuid, text, uuid, uuid) to authenticated, service_role;

-- Deleting a record removes its tasks (as with the portal tasks before).
create or replace function work_private.record_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.work_tasks t
  using public.work_task_links l
  where l.task_id = t.id and l.entity_type = tg_argv[0] and l.entity_id = old.id;
  return null;
end;
$$;

create trigger clients_work_tasks after delete on public.clients
  for each row execute function work_private.record_deleted('client');
create trigger vacancies_work_tasks after delete on public.vacancies
  for each row execute function work_private.record_deleted('vacancy');
create trigger candidates_work_tasks after delete on public.candidates
  for each row execute function work_private.record_deleted('candidate');
create trigger applications_work_tasks after delete on public.applications
  for each row execute function work_private.record_deleted('application');
create trigger placements_work_tasks after delete on public.placements
  for each row execute function work_private.record_deleted('placement');
create trigger companies_work_tasks after delete on public.companies
  for each row execute function work_private.record_deleted('company');

-- ---------------------------------------------------------------------------
-- 5. Move every portal task to Work, then archive public.tasks
-- ---------------------------------------------------------------------------

do $$
declare
  v_project uuid := work_private.records_project();
  v_ws uuid;
  r record;
  v_id uuid;
begin
  select workspace_id into v_ws from public.work_projects where id = v_project;

  for r in select * from public.tasks order by created_at loop
    insert into public.work_tasks (
      workspace_id, project_id, title, description, status, priority, due_at,
      created_by, reviewer_id, position, completed_at, external_source, external_id,
      created_at, updated_at
    ) values (
      v_ws,
      v_project,
      left(coalesce(nullif(trim(r.title), ''), 'Task'), 300),
      nullif(trim(r.description), ''),
      r.status,
      r.priority,
      -- A due date becomes 17:00 Amsterdam time on that day.
      case when r.due_date is not null
        then (r.due_date + time '17:00') at time zone 'Europe/Amsterdam' end,
      r.created_by,
      coalesce(r.created_by, r.assignee_id),
      r.position,
      r.completed_at,
      'portal_tasks',
      r.id::text,
      r.created_at,
      r.updated_at
    )
    on conflict (external_source, external_id) do nothing
    returning id into v_id;

    if v_id is null then
      continue;
    end if;

    if r.assignee_id is not null then
      perform work_private.ensure_staff_access(r.assignee_id);
      insert into public.work_task_assignees (task_id, user_id, assigned_by)
      values (v_id, r.assignee_id, r.created_by)
      on conflict do nothing;
    end if;

    if r.entity_type is not null and r.entity_id is not null then
      insert into public.work_task_links (task_id, entity_type, entity_id, created_by)
      values (v_id, r.entity_type, r.entity_id, r.created_by)
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

alter table public.tasks set schema archive;
revoke all on archive.tasks from anon, authenticated;
comment on table archive.tasks is
  'Portal tasks before they moved to Work (20261110000000_work_records.sql). Read only archive.';
