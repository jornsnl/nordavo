-- Portal core: clients, vacancies, candidates, pipeline, placements,
-- tasks, notes, attachments, activity log and the client portal.
--
-- Roles (public.profiles.role):
--   admin   Nordavo team, can also manage users
--   member  Nordavo team
--   client  A contact person at a client, sees only their own company
--           through the client portal (/portaal)

-- ---------------------------------------------------------------------------
-- Clients first, so profiles can reference them
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  industry text,
  city text,
  status text not null default 'lead' check (status in ('lead', 'active', 'inactive')),
  notes text,
  owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles: add the client role and a link to the client company
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'member', 'client'));
alter table public.profiles
  add column client_id uuid references public.clients (id) on delete set null;
alter table public.profiles add column email text;

-- Backfill email for existing users and keep it in sync for new ones.
update public.profiles p set email = u.email from auth.users u where u.id = p.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so policies can call them without recursion)
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role in ('admin', 'member') from public.profiles where id = (select auth.uid())),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = (select auth.uid())),
    false
  );
$$;

create or replace function public.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select client_id from public.profiles
  where id = (select auth.uid()) and role = 'client';
$$;

-- Staff can see every profile (for assignee pickers), admins manage roles.
create policy "Staff can read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Business tables
-- ---------------------------------------------------------------------------

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  job_title text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vacancies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  description text,
  stack text[] not null default '{}',
  seniority text not null default 'senior' check (seniority in ('medior', 'senior', 'lead')),
  status text not null default 'open' check (status in ('open', 'on_hold', 'filled', 'closed')),
  monthly_budget numeric(10, 2),
  desired_start_date date,
  opened_at date not null default current_date,
  closed_at date,
  owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  location text not null default 'Bangalore',
  current_title text,
  years_experience integer check (years_experience >= 0),
  skills text[] not null default '{}',
  linkedin_url text,
  video_url text,
  cv_path text,
  summary text,
  status text not null default 'available' check (status in ('available', 'in_process', 'placed', 'unavailable')),
  owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A candidate in the pipeline of one vacancy.
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  stage text not null default 'sourced' check (stage in (
    'sourced', 'screening', 'technical_test', 'english_interview',
    'presented', 'final_interview', 'placed', 'rejected'
  )),
  position double precision not null default 0,
  technical_score integer check (technical_score between 0 and 100),
  english_score integer check (english_score between 0 and 100),
  assessment_notes text,
  presented_at timestamptz,
  client_decision text not null default 'pending' check (client_decision in ('pending', 'approved', 'rejected')),
  client_feedback text,
  client_decided_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vacancy_id, candidate_id)
);

create table public.placements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  candidate_id uuid not null references public.candidates (id) on delete restrict,
  vacancy_id uuid references public.vacancies (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  start_date date not null,
  end_date date,
  monthly_rate numeric(10, 2),
  status text not null default 'active' check (status in ('active', 'notice', 'ended')),
  notice_given_at date,
  -- Underperformance is replaced within 30 days at no cost.
  guarantee_until date generated always as (start_date + 30) stored,
  next_checkin_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.placement_checkins (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.placements (id) on delete cascade,
  checkin_date date not null default current_date,
  rating integer check (rating between 1 and 5),
  notes text,
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Generic building blocks, attached to any record via entity_type + entity_id
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date date,
  assignee_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  entity_type text check (entity_type in ('client', 'vacancy', 'candidate', 'application', 'placement')),
  entity_id uuid,
  position double precision not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((entity_type is null) = (entity_id is null))
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('client', 'vacancy', 'candidate', 'application', 'placement')),
  entity_id uuid not null,
  body text not null,
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('client', 'vacancy', 'candidate', 'application', 'placement')),
  entity_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted', 'stage_changed', 'status_changed')),
  summary text not null,
  changes jsonb not null default '{}',
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index on public.clients (status);
create index on public.client_contacts (client_id);
create index on public.vacancies (client_id);
create index on public.vacancies (status);
create index on public.candidates (status);
create index on public.applications (vacancy_id, stage, position);
create index on public.applications (candidate_id);
create index on public.placements (client_id);
create index on public.placements (candidate_id);
create index on public.placements (status);
create index on public.placement_checkins (placement_id);
create index on public.tasks (assignee_id, status);
create index on public.tasks (entity_type, entity_id);
create index on public.notes (entity_type, entity_id);
create index on public.attachments (entity_type, entity_id);
create index on public.activity_log (entity_type, entity_id, created_at desc);
create index on public.activity_log (created_at desc);
create index on public.profiles (client_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger client_contacts_set_updated_at before update on public.client_contacts
  for each row execute function public.set_updated_at();
create trigger vacancies_set_updated_at before update on public.vacancies
  for each row execute function public.set_updated_at();
create trigger candidates_set_updated_at before update on public.candidates
  for each row execute function public.set_updated_at();
create trigger applications_set_updated_at before update on public.applications
  for each row execute function public.set_updated_at();
create trigger placements_set_updated_at before update on public.placements
  for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger notes_set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

-- Keep tasks.completed_at in sync with the status.
create or replace function public.tasks_set_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger tasks_completed_at before insert or update on public.tasks
  for each row execute function public.tasks_set_completed_at();

-- ---------------------------------------------------------------------------
-- Activity log: written by triggers, so every change is recorded
-- whether it comes from the app, the dashboard or SQL.
-- ---------------------------------------------------------------------------

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text := tg_argv[0];
  v_label text;
  v_row jsonb;
  v_old jsonb;
  v_changes jsonb := '{}';
  v_action text;
  v_summary text;
  v_key text;
  v_entity_id uuid;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  v_entity_id := (v_row ->> 'id')::uuid;
  v_label := coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'full_name', '');

  if tg_op = 'INSERT' then
    v_action := 'created';
    v_summary := 'aangemaakt';
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    v_summary := 'verwijderd';
  else
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('updated_at', 'position', 'created_at')
         and (v_row -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_row -> v_key)
        );
      end if;
    end loop;

    if v_changes = '{}'::jsonb then
      return null; -- only position/updated_at changed, nothing worth logging
    end if;

    if v_changes ? 'stage' then
      v_action := 'stage_changed';
      v_summary := 'fase gewijzigd';
    elsif v_changes ? 'status' then
      v_action := 'status_changed';
      v_summary := 'status gewijzigd';
    else
      v_action := 'updated';
      v_summary := 'bijgewerkt';
    end if;
  end if;

  insert into public.activity_log (entity_type, entity_id, action, summary, changes, actor_id)
  values (
    v_entity_type,
    v_entity_id,
    v_action,
    trim(both ' ' from v_label || ' ' || v_summary),
    v_changes,
    (select auth.uid())
  );
  return null;
end;
$$;

create trigger clients_activity after insert or update or delete on public.clients
  for each row execute function public.log_activity('client');
create trigger vacancies_activity after insert or update or delete on public.vacancies
  for each row execute function public.log_activity('vacancy');
create trigger candidates_activity after insert or update or delete on public.candidates
  for each row execute function public.log_activity('candidate');
create trigger applications_activity after insert or update or delete on public.applications
  for each row execute function public.log_activity('application');
create trigger placements_activity after insert or update or delete on public.placements
  for each row execute function public.log_activity('placement');
create trigger tasks_activity after insert or update or delete on public.tasks
  for each row execute function public.log_activity('task');

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.vacancies enable row level security;
alter table public.candidates enable row level security;
alter table public.applications enable row level security;
alter table public.placements enable row level security;
alter table public.placement_checkins enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;
alter table public.activity_log enable row level security;

-- Staff: full access to every business table.
create policy "Staff manage clients" on public.clients
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage client contacts" on public.client_contacts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage vacancies" on public.vacancies
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage candidates" on public.candidates
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage applications" on public.applications
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage placements" on public.placements
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage placement checkins" on public.placement_checkins
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage tasks" on public.tasks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage notes" on public.notes
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff manage attachments" on public.attachments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff read activity" on public.activity_log
  for select to authenticated using (public.is_staff());

-- Client portal: read-only access to their own company.
create policy "Clients read own company" on public.clients
  for select to authenticated using (id = public.current_client_id());

create policy "Clients read own vacancies" on public.vacancies
  for select to authenticated using (client_id = public.current_client_id());

-- Only candidates that Nordavo has presented to the client are visible.
create policy "Clients read presented applications" on public.applications
  for select to authenticated using (
    stage in ('presented', 'final_interview', 'placed')
    and exists (
      select 1 from public.vacancies v
      where v.id = applications.vacancy_id
        and v.client_id = public.current_client_id()
    )
  );

create policy "Clients read presented candidates" on public.candidates
  for select to authenticated using (
    exists (
      select 1
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
      where a.candidate_id = candidates.id
        and a.stage in ('presented', 'final_interview', 'placed')
        and v.client_id = public.current_client_id()
    )
  );

create policy "Clients read own placements" on public.placements
  for select to authenticated using (client_id = public.current_client_id());

-- Clients give feedback through this function only, so they can never
-- change anything else on an application.
create or replace function public.client_review_application(
  p_application_id uuid,
  p_decision text,
  p_feedback text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Ongeldige beslissing';
  end if;

  update public.applications a
  set client_decision = p_decision,
      client_feedback = nullif(trim(p_feedback), ''),
      client_decided_at = now()
  from public.vacancies v
  where a.id = p_application_id
    and v.id = a.vacancy_id
    and v.client_id = public.current_client_id()
    and a.stage in ('presented', 'final_interview');

  if not found then
    raise exception 'Kandidaat niet gevonden';
  end if;
end;
$$;

revoke execute on function public.client_review_application(uuid, text, text) from public, anon;
grant execute on function public.client_review_application(uuid, text, text) to authenticated;

-- Admins change roles and client links through this function, because
-- the column grant on profiles only lets users edit their own name.
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
  if p_role not in ('admin', 'member', 'client') then
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

revoke execute on function public.admin_update_profile(uuid, text, uuid) from public, anon;
grant execute on function public.admin_update_profile(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for CVs and other attachments.
-- Path convention: <entity_type>/<entity_id>/<random>-<file name>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 20971520)
on conflict (id) do nothing;

create policy "Staff manage attachment files"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'attachments' and public.is_staff())
  with check (bucket_id = 'attachments' and public.is_staff());

-- Clients may open CVs of candidates presented to them.
create policy "Clients read presented candidate files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'candidate'
    and exists (
      select 1
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
      where a.candidate_id::text = (storage.foldername(name))[2]
        and a.stage in ('presented', 'final_interview', 'placed')
        and v.client_id = public.current_client_id()
    )
  );
