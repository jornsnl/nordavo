-- Nordavo Academy and the ATS, core (spec Academy: koppeling met het ATS,
-- kandidatenbeheer, automatisering op ATS-statussen). Builds on the Academy
-- foundation (20261112000000 to 20261112040000). docs/academy.md section
-- "ATS-koppeling" is the description; keep both in sync.
--
--   1  academy_ats_settings: one row with the developer and client course,
--      the extra modules of top candidates, reminder and retention rules
--   2  academy_group_settings: per candidate group automatic enrolment when
--      a candidate is linked to the group's vacancy
--   3  academy_ats_events: the log and outbox of every automation (placed,
--      linked to a vacancy, top candidate, enrolment from the ATS). What the
--      database can do alone runs in the trigger (top candidate modules,
--      enrolment of an existing account); what needs the app (new accounts,
--      mail, the placement with its client contact) is picked up by the app
--      or the job academy-ats-sync. Idempotent: one event per placement, per
--      candidate and group, per top candidate marking
--   4  academy_ats_enrol_core(): a candidate in the developer course
--   5  academy_ats_apply_top(): the extra modules of a top candidate
--   6  academy_ats_apply_placement(): status placed: developer role and the
--      whole developer course (progress kept), the client contact with the
--      client course, placement members, milestones, rituals, task deadlines
--   7  Triggers on placements, applications and candidates
--   8  Wrappers for Nordavo (managers) and row level security
--   9  Jobs academy-* belong to module academy

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

create table public.academy_ats_settings (
  id boolean primary key default true check (id),
  -- The course candidates and developers follow, and the client course.
  -- Null: the start curriculum (slug developer, slug client).
  developer_course_id uuid references public.academy_courses (id) on delete set null,
  client_course_id uuid references public.academy_courses (id) on delete set null,
  -- Opened (in order, not forced) for a top candidate, on top of the default modules.
  top_candidate_module_ids uuid[] not null default '{}',
  top_candidate_mail boolean not null default true,
  -- Status placed: invite the client contact person and send welcome mails.
  invite_client_contact boolean not null default true,
  welcome_mail boolean not null default true,
  -- Reminders to candidates who get stuck (job academy-reminders).
  reminder_enabled boolean not null default true,
  reminder_after_days integer not null default 7 check (reminder_after_days between 1 and 90),
  reminder_repeat_days integer not null default 7 check (reminder_repeat_days between 1 and 90),
  reminder_max integer not null default 3 check (reminder_max between 0 and 10),
  -- Retention (job academy-retention): Academy data of candidates who were
  -- never placed, after this many months without activity in ATS and
  -- Academy. Off by default: the job then only reports (dry run).
  retention_months integer not null default 12 check (retention_months between 1 and 120),
  retention_action text not null default 'anonymise' check (retention_action in ('anonymise', 'delete')),
  retention_enabled boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger academy_ats_settings_set_updated_at before update on public.academy_ats_settings
  for each row execute function public.set_updated_at();

-- The start curriculum: developer module 3 opens for top candidates.
insert into public.academy_ats_settings (id, top_candidate_module_ids)
values (true, coalesce((select array_agg(id) from public.academy_modules where seed_key = 'developer-3'), '{}'))
on conflict (id) do nothing;

create or replace function public.academy_ats_developer_course()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.developer_course_id from public.academy_ats_settings s where s.id),
    (select c.id from public.academy_courses c where c.slug = 'developer')
  );
$$;

create or replace function public.academy_ats_client_course()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.client_course_id from public.academy_ats_settings s where s.id),
    (select c.id from public.academy_courses c where c.slug = 'client')
  );
$$;

-- Who reads Academy results in the ATS: Academy managers and the
-- recruitment team (the ATS is module recruitment).
create or replace function public.academy_ats_can_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.academy_is_manager() or public.has_module('recruitment');
$$;

-- The real deadline of a relative one: end of day start + offset in the
-- person's zone (same as deadlineFromOffset in src/lib/academy/time.ts).
create or replace function public.academy_ats_deadline(p_start date, p_offset integer, p_zone text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((p_start + p_offset + 1)::timestamp at time zone coalesce(p_zone, 'Europe/Amsterdam')) - interval '1 second';
$$;

-- ---------------------------------------------------------------------------
-- 2. Group settings
-- ---------------------------------------------------------------------------

-- A group per vacancy (academy_groups.vacancy_id) with auto_enrol: every
-- candidate linked to that vacancy gets an Academy account in the group with
-- the developer course (default modules, plus open_module_ids).
create table public.academy_group_settings (
  group_id uuid primary key references public.academy_groups (id) on delete cascade,
  auto_enrol boolean not null default false,
  open_module_ids uuid[] not null default '{}',
  send_mail boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger academy_group_settings_set_updated_at before update on public.academy_group_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Events
-- ---------------------------------------------------------------------------

create table public.academy_ats_events (
  id uuid primary key default gen_random_uuid(),
  -- placed          placement recorded (status placed in the ATS)
  -- vacancy_linked  candidate linked to a vacancy whose group enrols
  -- top_candidate   marked as top candidate (mail with the new modules)
  -- enrol           added to the developer course from the ATS (one or bulk)
  kind text not null check (kind in ('placed', 'vacancy_linked', 'top_candidate', 'enrol')),
  -- One event per placement / candidate and group / marking; null for enrol.
  dedupe_key text unique,
  candidate_id uuid references public.candidates (id) on delete cascade,
  placement_id uuid references public.placements (id) on delete cascade,
  vacancy_id uuid references public.vacancies (id) on delete set null,
  group_id uuid references public.academy_groups (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  -- Options (enrol: open_module_ids, send_mail).
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- pending: the app still has to do something (account, mail);
  -- done: finished; skipped: nothing to do (reason in result); failed: see error.
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped', 'failed')),
  attempts integer not null default 0,
  -- What was done, step by step (database part and app part).
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  error text check (char_length(error) <= 4000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index on public.academy_ats_events (status, created_at);
create index on public.academy_ats_events (candidate_id, created_at desc);
create index on public.academy_ats_events (placement_id);
-- At most one open enrolment per candidate.
create unique index academy_ats_events_one_pending_enrol on public.academy_ats_events (candidate_id)
  where kind = 'enrol' and status = 'pending';

create trigger academy_ats_events_set_updated_at before update on public.academy_ats_events
  for each row execute function public.set_updated_at();

-- Merge a step into the result of an event.
create or replace function public.academy_ats_event_note(p_event_id uuid, p_result jsonb, p_status text default null, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.academy_ats_events
  set result = result || coalesce(p_result, '{}'::jsonb),
      status = coalesce(p_status, status),
      error = case when p_status = 'failed' then left(p_error, 4000) when p_status in ('done', 'skipped') then null else error end,
      processed_at = case when p_status in ('done', 'skipped', 'failed') then now() else processed_at end,
      attempts = attempts + case when p_status is not null then 1 else 0 end
  where id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. Enrolment of a candidate
-- ---------------------------------------------------------------------------

-- A candidate (with an auth account p_profile_id) in the developer course:
-- Academy row with the ATS candidate, course access (scope default, never
-- narrowed), open modules of that course, group, and the top candidate
-- modules when the candidate is marked. A developer stays a developer; the
-- team keeps its role; client users and callers are refused. Internal: the
-- wrappers and the app (service role) call it. Returns what it did.
create or replace function public.academy_ats_enrol_core(
  p_profile_id uuid,
  p_candidate_id uuid,
  p_group_id uuid default null,
  p_open_module_ids uuid[] default '{}',
  p_scope text default 'default',
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_course uuid := public.academy_ats_developer_course();
  v_existing public.academy_members%rowtype;
  v_linked uuid;
  v_module uuid;
  v_new boolean := false;
  v_opened integer := 0;
begin
  if p_scope not in ('all', 'default') then
    raise exception 'Unknown access scope';
  end if;
  if not exists (select 1 from public.candidates where id = p_candidate_id) then
    raise exception 'Candidate not found';
  end if;
  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception 'User not found';
  end if;
  if v_role = 'client' then
    raise exception 'This account is a client user';
  elsif v_role = 'caller' then
    raise exception 'This account is an external caller';
  end if;

  select profile_id into v_linked from public.academy_members where candidate_id = p_candidate_id;
  if v_linked is not null and v_linked <> p_profile_id then
    raise exception 'This candidate is already linked to another Academy account';
  end if;

  select * into v_existing from public.academy_members where profile_id = p_profile_id;
  if found and v_existing.academy_role like 'client_%' then
    raise exception 'This account is a client user';
  end if;
  if found and v_existing.candidate_id is not null and v_existing.candidate_id <> p_candidate_id then
    raise exception 'This account is linked to another candidate';
  end if;

  if v_role in ('external', 'candidate') then
    update public.profiles set role = 'candidate', client_id = null, modules = '{}'
    where id = p_profile_id and role <> 'candidate';
  end if;

  if v_existing.profile_id is null then
    v_new := true;
    insert into public.academy_members (profile_id, academy_role, locale, candidate_id, invited_at, invited_by)
    values (p_profile_id, case when v_role = 'developer' then 'developer' else 'candidate' end, 'en', p_candidate_id, now(), p_actor);
    if v_role in ('external', 'candidate') then
      update public.profiles set time_zone = 'Asia/Kolkata' where id = p_profile_id and time_zone = 'Europe/Amsterdam';
    end if;
  else
    update public.academy_members set candidate_id = p_candidate_id where profile_id = p_profile_id and candidate_id is null;
  end if;

  if v_course is not null then
    insert into public.academy_course_access (course_id, profile_id, scope, granted_by)
    values (v_course, p_profile_id, p_scope, p_actor)
    on conflict (course_id, profile_id) where profile_id is not null do update
      set scope = case when academy_course_access.scope = 'all' then 'all' else excluded.scope end;

    foreach v_module in array coalesce(p_open_module_ids, '{}') loop
      if not exists (select 1 from public.academy_modules where id = v_module and course_id = v_course) then
        raise exception 'Module is not part of the developer course';
      end if;
      insert into public.academy_open_modules (profile_id, module_id, granted_by)
      values (p_profile_id, v_module, p_actor)
      on conflict do nothing;
      if found then v_opened := v_opened + 1; end if;
    end loop;
  end if;

  if p_group_id is not null then
    insert into public.academy_group_members (group_id, profile_id, added_by)
    values (p_group_id, p_profile_id, p_actor)
    on conflict do nothing;
  end if;

  if exists (select 1 from public.candidates where id = p_candidate_id and top_candidate) then
    perform public.academy_ats_apply_top(p_candidate_id, false);
  end if;

  return jsonb_build_object('profile_id', p_profile_id, 'new_member', v_new, 'course_id', v_course, 'opened_modules', v_opened);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Top candidates
-- ---------------------------------------------------------------------------

-- Marked: the configured extra modules open for the candidate's Academy
-- account (in order, not forced). Unmarked: those rows are removed again
-- (progress stays, and a started module stays open). Returns the titles of
-- the modules that were newly opened. With p_notify an in-app notification.
create or replace function public.academy_ats_apply_top(p_candidate_id uuid, p_notify boolean default true)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_top boolean;
  v_modules uuid[];
  v_course uuid := public.academy_ats_developer_course();
  v_titles text[] := '{}';
  v_module record;
begin
  select am.profile_id, c.top_candidate into v_profile, v_top
  from public.candidates c left join public.academy_members am on am.candidate_id = c.id
  where c.id = p_candidate_id;
  if v_profile is null then
    return v_titles;
  end if;
  select coalesce(top_candidate_module_ids, '{}') into v_modules from public.academy_ats_settings where id;

  if v_top then
    for v_module in
      select m.id, m.title from public.academy_modules m
      where m.id = any (coalesce(v_modules, '{}')) and m.course_id = v_course
      order by m.position
    loop
      insert into public.academy_open_modules (profile_id, module_id) values (v_profile, v_module.id)
      on conflict do nothing;
      if found then
        v_titles := v_titles || v_module.title;
      end if;
    end loop;
    if p_notify and cardinality(v_titles) > 0 then
      perform public.academy_notify(
        v_profile, 'top_candidate', 'More modules are open for you',
        'Nordavo opened extra modules of the developer course for you: ' || array_to_string(v_titles, ', ') || '.',
        case when v_course is not null then '/academy/courses/' || v_course end,
        jsonb_build_object('module_titles', to_jsonb(v_titles))
      );
    end if;
  else
    delete from public.academy_open_modules
    where profile_id = v_profile and not force and module_id = any (coalesce(v_modules, '{}'));
  end if;
  return v_titles;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Placed
-- ---------------------------------------------------------------------------

-- Everything the database can do when a placement is recorded. Idempotent:
-- run it again and nothing doubles. p_client_profile_id: the client contact
-- (account made by the app); p_developer_profile_id: the developer's account
-- when the app just made it. Without them it uses what exists: the Academy
-- account linked to the candidate, the client's Academy users.
--
--   developer  role developer (the team keeps its role), start date, the
--              whole developer course (scope all; progress stays), member
--              of the placement
--   client     the contact gets client_admin unless already in the Academy,
--              the client course (scope all); every Academy user of the
--              client becomes a member of the placement with their role
--   placement  milestones day 1, week 1, 30 days, 90 days review; rituals
--              copied from the course templates; tasks with a relative
--              deadline get a real date (end of that day in the person's
--              zone); shared tasks get a status row for the placement;
--              placement-only tasks show through the membership
create or replace function public.academy_ats_apply_placement(
  p_placement_id uuid,
  p_client_profile_id uuid default null,
  p_developer_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.placements%rowtype;
  v_dev uuid;
  v_dev_role text;
  v_client_role text;
  v_client_client uuid;
  v_dev_course uuid := public.academy_ats_developer_course();
  v_client_course uuid := public.academy_ats_client_course();
  v_result jsonb := '{}'::jsonb;
  v_member record;
  v_lesson uuid;
  v_count integer;
begin
  select * into v_p from public.placements where id = p_placement_id;
  if not found then
    raise exception 'Placement not found';
  end if;

  -- Developer.
  v_dev := coalesce(p_developer_profile_id, (select profile_id from public.academy_members where candidate_id = v_p.candidate_id));
  if v_dev is not null then
    select role into v_dev_role from public.profiles where id = v_dev;
    if v_dev_role in ('client', 'caller') then
      v_result := v_result || jsonb_build_object('developer', 'skipped: the account is a ' || v_dev_role);
      v_dev := null;
    end if;
  end if;
  if v_dev is not null then
    if not exists (select 1 from public.academy_members where profile_id = v_dev) then
      perform public.academy_ats_enrol_core(v_dev, v_p.candidate_id, null, '{}', 'all', null);
    end if;
    if v_dev_role in ('external', 'candidate') then
      update public.profiles set role = 'developer', client_id = null, modules = '{}' where id = v_dev;
    end if;
    update public.academy_members
    set academy_role = 'developer',
        candidate_id = coalesce(candidate_id, v_p.candidate_id),
        start_date = case when academy_role = 'candidate' or start_date is null then v_p.start_date else start_date end
    where profile_id = v_dev;
    if v_dev_course is not null then
      insert into public.academy_course_access (course_id, profile_id, scope)
      values (v_dev_course, v_dev, 'all')
      on conflict (course_id, profile_id) where profile_id is not null do update set scope = 'all';
    end if;
    insert into public.academy_placement_members (placement_id, profile_id, role)
    values (p_placement_id, v_dev, 'developer')
    on conflict (placement_id, profile_id) do nothing;
    v_result := v_result || jsonb_build_object('developer', 'ok', 'developer_profile_id', v_dev);
  else
    v_result := v_result || jsonb_build_object('developer', coalesce(v_result ->> 'developer', 'no Academy account yet'));
  end if;

  -- Client contact.
  if p_client_profile_id is not null then
    select role, client_id into v_client_role, v_client_client from public.profiles where id = p_client_profile_id;
    if v_client_role = 'external' or (v_client_role = 'client' and v_client_client = v_p.client_id) then
      if v_client_role = 'external' then
        update public.profiles set role = 'client', client_id = v_p.client_id, modules = '{}' where id = p_client_profile_id;
      end if;
      insert into public.academy_members (profile_id, academy_role, locale, start_date, invited_at)
      values (p_client_profile_id, 'client_admin', 'nl', v_p.start_date, now())
      on conflict (profile_id) do update
        set start_date = coalesce(academy_members.start_date, excluded.start_date);
      if v_client_course is not null then
        insert into public.academy_course_access (course_id, profile_id, scope)
        values (v_client_course, p_client_profile_id, 'all')
        on conflict (course_id, profile_id) where profile_id is not null do update set scope = 'all';
      end if;
      v_result := v_result || jsonb_build_object('client_contact', 'ok', 'client_profile_id', p_client_profile_id);
    else
      v_result := v_result || jsonb_build_object('client_contact', 'skipped: the account is not a user of this client');
    end if;
  end if;

  -- Every Academy user of the client joins the placement with their role.
  for v_member in
    select am.profile_id, am.academy_role
    from public.academy_members am join public.profiles p on p.id = am.profile_id
    where p.role = 'client' and p.client_id = v_p.client_id and am.academy_role like 'client_%'
  loop
    insert into public.academy_placement_members (placement_id, profile_id, role)
    values (p_placement_id, v_member.profile_id, v_member.academy_role)
    on conflict (placement_id, profile_id) do nothing;
  end loop;

  -- Milestones: the placement page owns the timeline (academy_ensure_milestones,
  -- day 1 is the start date). It is idempotent, so a rerun adds nothing.
  v_count := public.academy_ensure_milestones(p_placement_id);
  v_result := v_result || jsonb_build_object('milestones_added', v_count);

  -- Rituals: copies of the course templates for the courses the members
  -- follow (academy_ensure_placement_rituals, owned by the placement page;
  -- idempotent, the copies keep following their template).
  v_count := public.academy_ensure_placement_rituals(p_placement_id);
  v_result := v_result || jsonb_build_object('rituals_added', v_count);

  -- Personal tasks with a relative deadline, for every member of the
  -- placement, in the courses they follow. An existing date is kept.
  insert into public.academy_task_status (task_id, profile_id, due_at)
  select distinct on (t.id, pm.profile_id) t.id, pm.profile_id,
    public.academy_ats_deadline(coalesce(am.start_date, v_p.start_date), t.deadline_offset_days, coalesce(pr.time_zone, 'Europe/Amsterdam'))
  from public.academy_placement_members pm
  join public.academy_members am on am.profile_id = pm.profile_id
  join public.profiles pr on pr.id = pm.profile_id
  join public.academy_course_access ca on ca.profile_id = pm.profile_id
  join public.academy_modules m on m.course_id = ca.course_id
  join public.academy_module_lessons ml on ml.module_id = m.id
  join public.academy_lesson_blocks b on b.lesson_id = ml.lesson_id and b.type = 'tasks'
  join public.academy_tasks t on t.block_id = b.id
  where pm.placement_id = p_placement_id and pm.role <> 'client_reader'
    and not t.shared and t.deadline_offset_days is not null
  on conflict (task_id, profile_id) where profile_id is not null
    do update set due_at = coalesce(academy_task_status.due_at, excluded.due_at);
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('task_deadlines', v_count);

  -- Shared tasks of both courses: one status for the placement.
  insert into public.academy_task_status (task_id, placement_id, due_at)
  select distinct on (t.id) t.id, p_placement_id,
    case when t.deadline_offset_days is not null
      then public.academy_ats_deadline(v_p.start_date, t.deadline_offset_days, coalesce(v_p.overlap_time_zone, 'Europe/Amsterdam')) end
  from public.academy_modules m
  join public.academy_module_lessons ml on ml.module_id = m.id
  join public.academy_lesson_blocks b on b.lesson_id = ml.lesson_id and b.type = 'tasks'
  join public.academy_tasks t on t.block_id = b.id
  where m.course_id in (v_dev_course, v_client_course) and t.shared
  on conflict (task_id, placement_id) where profile_id is null
    do update set due_at = coalesce(academy_task_status.due_at, excluded.due_at);
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('shared_tasks', v_count);

  -- Placement-only tasks now count for the developer: recompute started lessons.
  if v_dev is not null then
    for v_lesson in select lesson_id from public.academy_lesson_progress where profile_id = v_dev loop
      perform public.academy_refresh_lesson(v_lesson, v_dev);
    end loop;
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Triggers
-- ---------------------------------------------------------------------------

-- A placement is recorded: event placed. The app picks it up right away
-- (createPlacement) or the job academy-ats-sync does within the hour: it
-- makes the accounts that are missing, runs academy_ats_apply_placement()
-- and sends the welcome mails. Queued only, so recording a placement never
-- fails because of the Academy.
create or replace function public.academy_ats_on_placement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.academy_ats_events (kind, dedupe_key, candidate_id, placement_id, vacancy_id)
  values ('placed', 'placed:' || new.id, new.candidate_id, new.id, new.vacancy_id)
  on conflict (dedupe_key) do nothing;
  return null;
end;
$$;

create trigger academy_ats_on_placement after insert on public.placements
  for each row execute function public.academy_ats_on_placement();

-- A candidate is linked to a vacancy whose group enrols automatically.
-- With an Academy account the enrolment is done here; otherwise the app
-- makes the account (event pending).
create or replace function public.academy_ats_on_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group record;
  v_event uuid;
  v_profile uuid;
begin
  select profile_id into v_profile from public.academy_members where candidate_id = new.candidate_id;
  for v_group in
    select g.id, gs.open_module_ids, gs.send_mail
    from public.academy_groups g join public.academy_group_settings gs on gs.group_id = g.id
    where g.vacancy_id = new.vacancy_id and gs.auto_enrol
  loop
    insert into public.academy_ats_events (kind, dedupe_key, candidate_id, vacancy_id, group_id, profile_id, payload)
    values ('vacancy_linked', 'vacancy_linked:' || new.candidate_id || ':' || v_group.id, new.candidate_id, new.vacancy_id,
      v_group.id, v_profile, jsonb_build_object('open_module_ids', to_jsonb(v_group.open_module_ids), 'send_mail', v_group.send_mail))
    on conflict (dedupe_key) do nothing
    returning id into v_event;
    if v_event is not null and v_profile is not null then
      begin
        perform public.academy_ats_event_note(v_event,
          jsonb_build_object('database', public.academy_ats_enrol_core(v_profile, new.candidate_id, v_group.id, v_group.open_module_ids, 'default', null)),
          'done');
      exception when others then
        perform public.academy_ats_event_note(v_event, '{}'::jsonb, 'failed', sqlerrm);
      end;
    end if;
  end loop;
  return null;
end;
$$;

create trigger academy_ats_on_application after insert on public.applications
  for each row execute function public.academy_ats_on_application();

-- Marking a top candidate keeps the date.
create or replace function public.academy_ats_top_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.top_candidate and (tg_op = 'INSERT' or not old.top_candidate) then
    new.top_candidate_at := now();
  elsif not new.top_candidate then
    new.top_candidate_at := null;
  end if;
  return new;
end;
$$;

create trigger academy_ats_top_stamp before insert or update of top_candidate on public.candidates
  for each row execute function public.academy_ats_top_stamp();

-- Marked or unmarked: the extra modules open or close right away; marked
-- with an Academy account and new modules, the app sends the mail (event).
create or replace function public.academy_ats_on_top_candidate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titles text[];
  v_profile uuid;
  v_mail boolean;
begin
  if new.top_candidate is not distinct from old.top_candidate then
    return null;
  end if;
  v_titles := public.academy_ats_apply_top(new.id, true);
  if new.top_candidate then
    select profile_id into v_profile from public.academy_members where candidate_id = new.id;
    select top_candidate_mail into v_mail from public.academy_ats_settings where id;
    insert into public.academy_ats_events (kind, dedupe_key, candidate_id, profile_id, status, result, processed_at)
    values (
      'top_candidate', 'top_candidate:' || new.id || ':' || extract(epoch from new.top_candidate_at)::bigint, new.id, v_profile,
      case when v_profile is not null and cardinality(v_titles) > 0 and coalesce(v_mail, true) then 'pending' else 'skipped' end,
      jsonb_build_object('opened_modules', to_jsonb(v_titles),
        'reason', case when v_profile is null then 'not in the Academy yet: applied when enrolled'
                       when cardinality(v_titles) = 0 then 'no new modules to open'
                       when not coalesce(v_mail, true) then 'mail is off' end),
      case when v_profile is null or cardinality(v_titles) = 0 or not coalesce(v_mail, true) then now() end
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return null;
end;
$$;

create trigger academy_ats_on_top_candidate after update of top_candidate on public.candidates
  for each row execute function public.academy_ats_on_top_candidate();

-- ---------------------------------------------------------------------------
-- 8. For Nordavo (managers), grants and row level security
-- ---------------------------------------------------------------------------

-- Enrol a candidate whose account exists (the app makes new accounts).
create or replace function public.academy_ats_enrol(
  p_profile_id uuid,
  p_candidate_id uuid,
  p_group_id uuid default null,
  p_open_module_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.academy_is_manager() then
    raise exception 'Only Nordavo adds people to the Academy' using errcode = '42501';
  end if;
  return public.academy_ats_enrol_core(p_profile_id, p_candidate_id, p_group_id, p_open_module_ids, 'default', (select auth.uid()));
end;
$$;

-- Run the database part of a placement again (button on the placement).
create or replace function public.academy_ats_rerun_placement(p_placement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.academy_is_manager() then
    raise exception 'Only Nordavo runs the Academy automation' using errcode = '42501';
  end if;
  v_result := public.academy_ats_apply_placement(p_placement_id);
  update public.academy_ats_events set result = result || jsonb_build_object('database', v_result)
  where dedupe_key = 'placed:' || p_placement_id;
  return v_result;
end;
$$;

-- Queue an enrolment from the ATS (one or many candidates). Returns the
-- number queued; candidates with an open enrolment are left alone.
create or replace function public.academy_ats_queue_enrol(
  p_candidate_ids uuid[],
  p_group_id uuid default null,
  p_open_module_ids uuid[] default '{}',
  p_send_mail boolean default true
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.academy_is_manager() then
    raise exception 'Only Nordavo adds people to the Academy' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_candidate_ids, '{}')) > 5000 then
    raise exception 'At most 5000 candidates at once';
  end if;
  insert into public.academy_ats_events (kind, candidate_id, group_id, profile_id, payload)
  select 'enrol', c.id, p_group_id, am.profile_id,
    jsonb_build_object('open_module_ids', to_jsonb(coalesce(p_open_module_ids, '{}')), 'send_mail', coalesce(p_send_mail, true))
  from public.candidates c
  left join public.academy_members am on am.candidate_id = c.id
  where c.id = any (p_candidate_ids)
  on conflict (candidate_id) where kind = 'enrol' and status = 'pending' do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Names of ATS candidates for the automation log (managers with module
-- academy alone do not read candidates).
create or replace function public.academy_candidate_names(p_candidate_ids uuid[])
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.full_name from public.candidates c
  where public.academy_ats_can_read() and c.id = any (p_candidate_ids);
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'academy_ats_event_note(uuid, jsonb, text, text)',
    'academy_ats_enrol_core(uuid, uuid, uuid, uuid[], text, uuid)',
    'academy_ats_apply_top(uuid, boolean)',
    'academy_ats_apply_placement(uuid, uuid, uuid)',
    'academy_ats_on_placement()', 'academy_ats_on_application()', 'academy_ats_on_top_candidate()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
  foreach v_fn in array array[
    'academy_ats_developer_course()', 'academy_ats_client_course()', 'academy_ats_can_read()',
    'academy_ats_deadline(date, integer, text)',
    'academy_ats_enrol(uuid, uuid, uuid, uuid[])', 'academy_ats_rerun_placement(uuid)',
    'academy_ats_queue_enrol(uuid[], uuid, uuid[], boolean)', 'academy_candidate_names(uuid[])'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $$;

alter table public.academy_ats_settings enable row level security;
alter table public.academy_group_settings enable row level security;
alter table public.academy_ats_events enable row level security;

create policy "Academy managers manage ATS settings" on public.academy_ats_settings
  for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager());
-- The recruitment team sees which modules a top candidate gets.
create policy "Recruitment reads ATS settings" on public.academy_ats_settings
  for select to authenticated using (public.academy_ats_can_read());

create policy "Academy managers manage group settings" on public.academy_group_settings
  for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager());

-- Events are written by triggers and functions; Nordavo reads (and may
-- retry: update by managers). Never deleted by hand.
create policy "Academy and recruitment read ATS events" on public.academy_ats_events
  for select to authenticated using (public.academy_ats_can_read());
create policy "Academy managers update ATS events" on public.academy_ats_events
  for update to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager());

-- ---------------------------------------------------------------------------
-- 9. Jobs academy-* are module academy
-- ---------------------------------------------------------------------------

create or replace function public.job_module(p_job_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_job_name ~ '^s[0-9]+-' or p_job_name like 'max-%' or p_job_name like 'claude-%' then 'sales'
    when p_job_name like 'work-%' or p_job_name like 'clickup-%' then null
    when p_job_name like 'academy-%' then 'academy'
    else 'recruitment'
  end;
$$;
