-- Nordavo Academy, foundation (spec Academy: datamodel, rollen en
-- zichtbaarheid, coursestructuur). The contract for the other Academy
-- builders is docs/academy.md; keep both in sync.
--
--   1  Roles: profile roles developer and candidate, module academy for team
--      members, admin_update_profile and admin_set_profile_modules updated
--   2  People: academy_members (academy role, locale, start date, candidate
--      link, digest), candidates.top_candidate, candidate groups
--   3  Content: courses > modules > lessons (reusable, linked through
--      academy_module_lessons) > blocks; videos and documents with versions
--   4  Access: course access per user or group, scope all/default, per person
--      open modules, module requirements
--   5  Helpers: academy_is_manager(), academy_has_course(),
--      academy_course_scope(), academy_member_role()
--   6  Row level security for everything above
--
-- Placement data (members, rituals, pulse, leave, holidays, milestones,
-- notifications) is in 20261112010000_academy_placements.sql, learning data
-- (progress, answers, tasks, checks) and the completion engine in
-- 20261112020000_academy_learning.sql.

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------
--
-- developer  a placed developer: developer course and their own placement,
--            only /academy (and sign-in, security)
-- candidate  a candidate in the ATS with an Academy account: only the open
--            modules of the developer course, nothing of clients or placements
-- Client users keep role client (/portal and /academy); their Academy role
-- (client admin, client member, reader) is in academy_members.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in (
    'admin', 'member', 'client', 'external', 'caller', 'developer', 'candidate'
  ));

-- Team members get module academy (managing the Academy: content, people,
-- answers). Like the other modules, every existing and new member gets it
-- until an admin narrows it down in Settings.
alter table public.profiles drop constraint if exists profiles_modules_check;
alter table public.profiles
  add constraint profiles_modules_check
    check (modules <@ array['sales', 'recruitment', 'clients', 'report', 'academy']);
alter table public.profiles
  alter column modules set default array['sales', 'recruitment', 'clients', 'report', 'academy'];
update public.profiles
set modules = array_append(modules, 'academy')
where role = 'member' and not ('academy' = any (modules));

comment on column public.profiles.modules is
  'Portal modules a member sees (sales, recruitment, clients, report, academy). Admins see all. Changed by admins through admin_set_profile_modules().';

create or replace function public.admin_set_profile_modules(p_user_id uuid, p_modules text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modules text[];
begin
  if not public.is_admin() then
    raise exception 'Only admins can change who sees what';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_modules
  from unnest(coalesce(p_modules, '{}')) m;
  if not v_modules <@ array['sales', 'recruitment', 'clients', 'report', 'academy'] then
    raise exception 'Unknown module';
  end if;

  update public.profiles set modules = v_modules where id = p_user_id;
  if not found then
    raise exception 'User not found';
  end if;
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
    raise exception 'Only admins can change roles';
  end if;
  if p_role not in ('admin', 'member', 'client', 'external', 'developer', 'candidate') then
    raise exception 'Invalid role';
  end if;
  if p_role = 'client' and p_client_id is null then
    raise exception 'A client account must be linked to a client';
  end if;
  if p_user_id = (select auth.uid()) and p_role <> 'admin' then
    raise exception 'You cannot remove your own admin role';
  end if;

  update public.profiles
  set role = p_role,
      client_id = case when p_role = 'client' then p_client_id else null end
  where id = p_user_id;
end;
$$;

-- Managing the Academy: admins and members with module academy.
create or replace function public.academy_is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_module('academy');
$$;

revoke execute on function public.academy_is_manager() from public, anon;
grant execute on function public.academy_is_manager() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. People
-- ---------------------------------------------------------------------------

-- Top candidate (spec Deel 4): gets more modules of the developer course
-- open, per person. Separate from is_topper, which is the recruiter's star
-- in a vacancy pipeline (with a reason).
alter table public.candidates
  add column top_candidate boolean not null default false,
  add column top_candidate_at timestamptz;

create index candidates_top_candidate_idx on public.candidates (top_candidate) where top_candidate;

-- One row per person in the Academy. The profile is the identity (same
-- login as the rest of the portal); the time zone is profiles.time_zone
-- (Europe/Amsterdam for clients, Asia/Kolkata for developers), so dates in
-- Work and the Academy agree.
create table public.academy_members (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  -- client_admin   klantbeheerder: follows the client course, sees own
  --                placements and the progress of colleagues
  -- client_member  klant lid: other managers at the client, follow the course
  -- client_reader  meelezer: only progress and scores, never answers or notes
  -- developer      placed developer: developer course and own placement
  -- candidate      candidate: only the open modules of the developer course
  academy_role text not null check (academy_role in (
    'client_admin', 'client_member', 'client_reader', 'developer', 'candidate'
  )),
  locale text not null default 'en' check (locale in ('nl', 'en')),
  -- Start date at the client (or of the trajectory). Release offsets of
  -- modules and relative task deadlines count from here.
  start_date date,
  -- The ATS candidate this person is (candidates and developers). Unique:
  -- Academy and ATS use the same candidate, there is no separate list.
  candidate_id uuid unique references public.candidates (id) on delete set null,
  -- Mail summary of notifications.
  digest_frequency text not null default 'weekly' check (digest_frequency in ('daily', 'weekly', 'off')),
  digest_sent_at timestamptz,
  last_active_at timestamptz,
  invited_at timestamptz,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.academy_members (academy_role);
create index on public.academy_members (last_active_at);

create trigger academy_members_set_updated_at before update on public.academy_members
  for each row execute function public.set_updated_at();

comment on table public.academy_members is
  'Academy participants. Added only by Nordavo (academy_add_person or managers), never by self invite.';

-- The Academy role of the signed in user (null when not a participant).
create or replace function public.academy_member_role(p_profile_id uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select academy_role from public.academy_members
  where profile_id = coalesce(p_profile_id, (select auth.uid()));
$$;

revoke execute on function public.academy_member_role(uuid) from public, anon;
grant execute on function public.academy_member_role(uuid) to authenticated, service_role;

-- Candidate groups: per vacancy, month or campaign (spec Deel 4).
create table public.academy_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null default 'other' check (kind in ('vacancy', 'month', 'campaign', 'other')),
  vacancy_id uuid references public.vacancies (id) on delete set null,
  description text check (char_length(description) <= 2000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger academy_groups_set_updated_at before update on public.academy_groups
  for each row execute function public.set_updated_at();

create table public.academy_group_members (
  group_id uuid not null references public.academy_groups (id) on delete cascade,
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index on public.academy_group_members (profile_id);

-- ---------------------------------------------------------------------------
-- 3. Content
-- ---------------------------------------------------------------------------

create table public.academy_courses (
  id uuid primary key default gen_random_uuid(),
  -- Stable key for seeds and code ('client', 'developer'); null for others.
  slug text unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 5000),
  language text not null check (language in ('nl', 'en')),
  audience text not null check (audience in ('client', 'developer')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  position double precision not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger academy_courses_set_updated_at before update on public.academy_courses
  for each row execute function public.set_updated_at();

-- Videos: the logical video (stable id, referenced by blocks and watch
-- progress) and its versions (files). Replacing a video adds a version and
-- moves current_version_id; watch progress stays on the video.
create table public.academy_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  current_version_id uuid,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.academy_video_versions (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.academy_videos (id) on delete cascade,
  version integer not null check (version >= 1),
  -- Storage bucket attachments, path academy/video/<video_id>/<file>.
  storage_path text not null check (char_length(storage_path) <= 1000),
  file_name text check (char_length(file_name) <= 300),
  mime_type text check (char_length(mime_type) <= 100),
  size_bytes bigint check (size_bytes >= 0),
  duration_seconds numeric(10, 2) check (duration_seconds >= 0),
  -- WebVTT files, same bucket.
  subtitles_nl_path text check (char_length(subtitles_nl_path) <= 1000),
  subtitles_en_path text check (char_length(subtitles_en_path) <= 1000),
  transcript text check (char_length(transcript) <= 500000),
  transcript_status text not null default 'none' check (transcript_status in ('none', 'pending', 'ready', 'corrected', 'failed')),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (video_id, version)
);

alter table public.academy_videos
  add constraint academy_videos_current_version_fkey
  foreign key (current_version_id) references public.academy_video_versions (id) on delete set null;

create trigger academy_videos_set_updated_at before update on public.academy_videos
  for each row execute function public.set_updated_at();

-- Documents: downloads (PDF, Word, Excel) and fillable worksheets. Global
-- (reusable in lessons and as module workbook) or per placement (contract
-- summary, GDPR, policies, matrices). Versioned; "new" until new_until.
create table public.academy_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 5000),
  kind text not null default 'download' check (kind in ('download', 'worksheet')),
  scope text not null default 'global' check (scope in ('global', 'placement')),
  placement_id uuid references public.placements (id) on delete cascade,
  category text not null default 'other' check (category in (
    'workbook', 'template', 'checklist', 'contract_summary', 'gdpr', 'policy',
    'escalation_matrix', 'decision_matrix', 'blocker_agreement', 'other'
  )),
  -- Worksheet fields: [{ "key": "goal", "label": "...", "type": "text|textarea|choice", "options": [...], "required": true }]
  worksheet_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(worksheet_fields) = 'array'),
  current_version integer not null default 0 check (current_version >= 0),
  new_until timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_documents_scope check ((scope = 'placement') = (placement_id is not null))
);

create index on public.academy_documents (placement_id) where placement_id is not null;

create trigger academy_documents_set_updated_at before update on public.academy_documents
  for each row execute function public.set_updated_at();

create table public.academy_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.academy_documents (id) on delete cascade,
  version integer not null check (version >= 1),
  -- Storage bucket attachments, path academy/document/<document_id>/<file>.
  storage_path text not null check (char_length(storage_path) <= 1000),
  file_name text not null check (char_length(file_name) between 1 and 300),
  mime_type text check (char_length(mime_type) <= 200),
  size_bytes bigint check (size_bytes >= 0),
  notes text check (char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create table public.academy_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.academy_courses (id) on delete cascade,
  -- Stable key for seeds ('client-1' ...); null for modules made in the editor.
  seed_key text unique,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 5000),
  position double precision not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published')),
  -- Opens only when the previous published module (by position) is done.
  requires_previous boolean not null default true,
  -- Opens this many days after academy_members.start_date (null: no wait).
  release_offset_days integer check (release_offset_days between 0 and 3650),
  -- Open with course access scope 'default' (candidates: modules 1 and 2).
  in_default_access boolean not null default false,
  -- Core module (client course modules 1 to 4).
  is_core boolean not null default false,
  -- Must be done before the developer starts (client course module 1).
  required_before_start boolean not null default false,
  -- Workbook that belongs to every lesson of the module.
  workbook_document_id uuid references public.academy_documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.academy_modules (course_id, position);

create trigger academy_modules_set_updated_at before update on public.academy_modules
  for each row execute function public.set_updated_at();

-- A module may require other modules (of any course) to be done first.
create table public.academy_module_requirements (
  module_id uuid not null references public.academy_modules (id) on delete cascade,
  required_module_id uuid not null references public.academy_modules (id) on delete cascade,
  primary key (module_id, required_module_id),
  check (module_id <> required_module_id)
);

-- Lessons stand on their own and are linked into modules, so one lesson can
-- be used in both courses; an edit applies everywhere. Progress is per
-- lesson, so it also counts everywhere.
create table public.academy_lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  summary text check (char_length(summary) <= 2000),
  language text not null default 'en' check (language in ('nl', 'en')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  duration_minutes integer check (duration_minutes between 0 and 600),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger academy_lessons_set_updated_at before update on public.academy_lessons
  for each row execute function public.set_updated_at();

create table public.academy_module_lessons (
  module_id uuid not null references public.academy_modules (id) on delete cascade,
  lesson_id uuid not null references public.academy_lessons (id) on delete cascade,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  primary key (module_id, lesson_id)
);

create index on public.academy_module_lessons (lesson_id);
create index on public.academy_module_lessons (module_id, position);

-- Lesson blocks, in order. content is per type (see docs/academy.md and
-- src/lib/academy/blocks/types.ts); required marks the block as needed for
-- the green check, completion holds the rule (e.g. {"min_percent": 90}).
-- questionnaire is reserved for the personality test.
create table public.academy_lesson_blocks (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.academy_lessons (id) on delete cascade,
  type text not null check (type in (
    'explanation', 'video', 'document', 'worksheet', 'assignment', 'tasks',
    'knowledge_check', 'notes', 'questionnaire'
  )),
  position double precision not null default 0,
  title text check (char_length(title) <= 300),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  required boolean not null default false,
  completion jsonb not null default '{}'::jsonb check (jsonb_typeof(completion) = 'object'),
  -- Reusable media: a video block points at a video, document and worksheet
  -- blocks at a document. Deleting the media leaves the block empty.
  video_id uuid references public.academy_videos (id) on delete set null,
  document_id uuid references public.academy_documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.academy_lesson_blocks (lesson_id, position);
create index on public.academy_lesson_blocks (video_id) where video_id is not null;
create index on public.academy_lesson_blocks (document_id) where document_id is not null;

create trigger academy_lesson_blocks_set_updated_at before update on public.academy_lesson_blocks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Access
-- ---------------------------------------------------------------------------

-- Course access for one person or one group. scope all: every published
-- module (subject to order, requirements and release); scope default: only
-- modules with in_default_access, plus the person's academy_open_modules.
-- Several rows may apply (own and via groups); all wins.
create table public.academy_course_access (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.academy_courses (id) on delete cascade,
  profile_id uuid references public.academy_members (profile_id) on delete cascade,
  group_id uuid references public.academy_groups (id) on delete cascade,
  scope text not null default 'all' check (scope in ('all', 'default')),
  granted_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_course_access_target check ((profile_id is null) <> (group_id is null))
);

create unique index academy_course_access_person on public.academy_course_access (course_id, profile_id) where profile_id is not null;
create unique index academy_course_access_group on public.academy_course_access (course_id, group_id) where group_id is not null;
create index on public.academy_course_access (profile_id);
create index on public.academy_course_access (group_id);

create trigger academy_course_access_set_updated_at before update on public.academy_course_access
  for each row execute function public.set_updated_at();

-- Extra modules open for one person (top candidates and exceptions). With
-- force the module opens right away, past order, requirements and release.
create table public.academy_open_modules (
  profile_id uuid not null references public.academy_members (profile_id) on delete cascade,
  module_id uuid not null references public.academy_modules (id) on delete cascade,
  force boolean not null default false,
  granted_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (profile_id, module_id)
);

create index on public.academy_open_modules (module_id);

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------

-- The widest scope a person has on a course ('all', 'default'), or null.
create or replace function public.academy_course_scope(p_course_id uuid, p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when bool_or(a.scope = 'all') then 'all'
    when count(*) > 0 then 'default'
  end
  from public.academy_course_access a
  where a.course_id = p_course_id
    and (
      a.profile_id = p_profile_id
      or a.group_id in (select gm.group_id from public.academy_group_members gm where gm.profile_id = p_profile_id)
    );
$$;

create or replace function public.academy_has_course(p_course_id uuid, p_profile_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.academy_course_scope(p_course_id, coalesce(p_profile_id, (select auth.uid()))) is not null;
$$;

revoke execute on function public.academy_course_scope(uuid, uuid) from public, anon, authenticated;
grant execute on function public.academy_course_scope(uuid, uuid) to service_role;
revoke execute on function public.academy_has_course(uuid, uuid) from public, anon;
grant execute on function public.academy_has_course(uuid, uuid) to authenticated, service_role;

-- A course the signed in user may see (published and with access).
create or replace function public.academy_course_visible(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.academy_courses c
    where c.id = p_course_id and c.status = 'published'
      and public.academy_course_scope(c.id, (select auth.uid())) is not null
  );
$$;

-- A module whose title the signed in user may see (also when locked).
create or replace function public.academy_module_visible(p_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.academy_modules m
    where m.id = p_module_id and m.status = 'published'
      and public.academy_course_visible(m.course_id)
  );
$$;

-- A lesson whose title the signed in user may see: published and linked in
-- a visible module.
create or replace function public.academy_lesson_visible(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_lessons l
    join public.academy_module_lessons ml on ml.lesson_id = l.id
    where l.id = p_lesson_id and l.status = 'published'
      and public.academy_module_visible(ml.module_id)
  );
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'academy_course_visible(uuid)', 'academy_module_visible(uuid)', 'academy_lesson_visible(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------

alter table public.academy_members enable row level security;
alter table public.academy_groups enable row level security;
alter table public.academy_group_members enable row level security;
alter table public.academy_courses enable row level security;
alter table public.academy_videos enable row level security;
alter table public.academy_video_versions enable row level security;
alter table public.academy_documents enable row level security;
alter table public.academy_document_versions enable row level security;
alter table public.academy_modules enable row level security;
alter table public.academy_module_requirements enable row level security;
alter table public.academy_lessons enable row level security;
alter table public.academy_module_lessons enable row level security;
alter table public.academy_lesson_blocks enable row level security;
alter table public.academy_course_access enable row level security;
alter table public.academy_open_modules enable row level security;

-- Managers (admins, members with module academy) manage everything.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'academy_members', 'academy_groups', 'academy_group_members', 'academy_courses',
    'academy_videos', 'academy_video_versions', 'academy_documents', 'academy_document_versions',
    'academy_modules', 'academy_module_requirements', 'academy_lessons', 'academy_module_lessons',
    'academy_lesson_blocks', 'academy_course_access', 'academy_open_modules'
  ] loop
    execute format(
      'create policy "Academy managers manage %1$s" on public.%1$I for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager())',
      v_table
    );
  end loop;
end $$;

-- Participants read their own row and change only their language and mail
-- summary (column grant below); everything else is set by Nordavo.
create policy "Members read own academy row" on public.academy_members
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "Members update own academy row" on public.academy_members
  for update to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- Participants may only change locale and digest_frequency (and last_active_at,
-- through academy_touch()); managers anything.
create or replace function public.academy_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.academy_is_manager() or (select auth.uid()) is null then
    return new;
  end if;
  if (to_jsonb(new) - array['locale', 'digest_frequency', 'last_active_at', 'updated_at'])
     is distinct from (to_jsonb(old) - array['locale', 'digest_frequency', 'last_active_at', 'updated_at']) then
    raise exception 'Only language and mail summary can be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.academy_members_guard() from public, anon, authenticated;

create trigger academy_members_guard before update on public.academy_members
  for each row execute function public.academy_members_guard();

-- Own access rows (what is open for me).
create policy "Members read own course access" on public.academy_course_access
  for select to authenticated using (
    profile_id = (select auth.uid())
    or group_id in (select gm.group_id from public.academy_group_members gm where gm.profile_id = (select auth.uid()))
  );
create policy "Members read own open modules" on public.academy_open_modules
  for select to authenticated using (profile_id = (select auth.uid()));

-- Published content of courses they have access to. Titles of locked
-- modules and lessons are visible (shown with a lock); block content only
-- once the lesson is open (policy in the learning migration).
create policy "Members read their courses" on public.academy_courses
  for select to authenticated using (status = 'published' and public.academy_course_visible(id));
create policy "Members read modules of their courses" on public.academy_modules
  for select to authenticated using (public.academy_module_visible(id));
create policy "Members read module requirements" on public.academy_module_requirements
  for select to authenticated using (public.academy_module_visible(module_id));
create policy "Members read lesson links" on public.academy_module_lessons
  for select to authenticated using (public.academy_module_visible(module_id));
create policy "Members read their lessons" on public.academy_lessons
  for select to authenticated using (public.academy_lesson_visible(id));
