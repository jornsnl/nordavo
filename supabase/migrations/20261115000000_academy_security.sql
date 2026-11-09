-- Academy security fixes (docs/academy.md, section 17 "Beveiliging").
--
--   1  Client portal only for client users without an Academy role or with
--      Academy role client_admin: current_client_id() is null for
--      client_member and client_reader, so every portal_* function, the
--      client file policy and the client RLS refuse them. The Academy role is
--      mirrored to app_metadata.academy_role for the proxy.
--   2  academy_add_person() never moves a client user to another client;
--      academy_add_person_check() validates before the app makes an account.
--      When a profile's client or role changes, its client memberships of
--      placements of another client are removed.
--   3  Developers and candidates have no Work: their memberships are
--      deactivated when they get that role (and their Work API tokens
--      revoked), work_private.role_in() needs a Work capable portal role, and
--      a guard keeps them from getting an active membership again.
--   4  The calendar token is rotated when a member leaves a placement and
--      when a placement ends; the feed is empty for ended placements.
--   5  Helpers that take a profile id (academy_member_role, academy_has_course,
--      academy_placement_role, academy_person_client) answer only for the
--      caller's own id unless the caller is an Academy manager or the service
--      role. Called from other security definer functions (current_user is
--      the owner) they keep answering for anyone.
--   6  academy_ats_on_application(): v_event reset per group.
--   7  Worksheet answers: no delete of submitted answers (no delete and
--      insert around the lock).
--   8  ATS rankings use the first attempt per knowledge check.

-- ---------------------------------------------------------------------------
-- 1. Client portal: not for client_member and client_reader
-- ---------------------------------------------------------------------------

-- The client of the signed-in portal user. Null for everyone else, and for
-- client users whose Academy role is client_member or client_reader (they
-- only have the Academy). Used by every portal_* function, the client file
-- policy (client_can_open_file) and the client RLS on vacancies, candidates,
-- applications and placements. Academy functions never use it: they read
-- profiles.client_id themselves.
create or replace function public.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.client_id from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'client'
    and not exists (
      select 1 from public.academy_members am
      where am.profile_id = p.id and am.academy_role in ('client_member', 'client_reader')
    );
$$;

comment on function public.current_client_id() is
  'Client portal: the client of the signed in client user; null for Academy-only client users (client_member, client_reader).';

-- The Academy role in the session token, next to portal_role, so the proxy
-- keeps Academy-only client users out of /portal without a query.
create or replace function public.academy_members_sync_app_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'academy_role'
    where id = old.profile_id and raw_app_meta_data ? 'academy_role';
    return null;
  end if;
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('academy_role', new.academy_role)
  where id = new.profile_id
    and (raw_app_meta_data ->> 'academy_role') is distinct from new.academy_role;
  return null;
end;
$$;

revoke execute on function public.academy_members_sync_app_role() from public, anon, authenticated;

create trigger academy_members_sync_app_role after insert or update of academy_role or delete on public.academy_members
  for each row execute function public.academy_members_sync_app_role();

update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('academy_role', am.academy_role)
from public.academy_members am
where am.profile_id = u.id
  and (u.raw_app_meta_data ->> 'academy_role') is distinct from am.academy_role;

-- ---------------------------------------------------------------------------
-- 2. Adding people: validate first, never move a client user
-- ---------------------------------------------------------------------------

-- Every check of academy_add_person(), without changing anything. The app
-- calls it before it makes an auth account (p_profile_id null for a new
-- address), so a refused add leaves no account behind. Managers only.
create or replace function public.academy_add_person_check(
  p_profile_id uuid,
  p_academy_role text,
  p_client_id uuid default null,
  p_course_id uuid default null,
  p_scope text default 'all',
  p_open_module_ids uuid[] default '{}'
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_client uuid;
  v_new_role text;
  v_module uuid;
begin
  if not public.academy_is_manager() then
    raise exception 'Only Nordavo adds people to the Academy' using errcode = '42501';
  end if;
  if p_academy_role is null or p_academy_role not in ('client_admin', 'client_member', 'client_reader', 'developer', 'candidate') then
    raise exception 'Unknown Academy role';
  end if;
  if p_scope is null or p_scope not in ('all', 'default') then
    raise exception 'Unknown access scope';
  end if;

  v_new_role := case when p_academy_role like 'client_%' then 'client' else p_academy_role end;
  if v_new_role = 'client' and p_client_id is null then
    raise exception 'A client user must be linked to a client';
  end if;
  if v_new_role = 'client' and not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client not found';
  end if;
  if p_course_id is not null then
    if not exists (select 1 from public.academy_courses where id = p_course_id) then
      raise exception 'Course not found';
    end if;
    foreach v_module in array coalesce(p_open_module_ids, '{}') loop
      if not exists (select 1 from public.academy_modules where id = v_module and course_id = p_course_id) then
        raise exception 'Module is not part of this course';
      end if;
    end loop;
  end if;

  if p_profile_id is null then
    return; -- a new account: nothing more to check
  end if;
  select role, client_id into v_role, v_client from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception 'User not found';
  end if;
  if v_role in ('admin', 'member') then
    return; -- the Nordavo team keeps its role
  elsif v_role = 'caller' then
    raise exception 'This account is an external caller';
  elsif v_role = 'client' and v_new_role <> 'client' then
    raise exception 'This account is a client user';
  elsif v_role = 'client' and v_client is not null and v_client <> p_client_id then
    raise exception 'This account is a client user of another client';
  elsif v_role in ('developer', 'candidate') and v_new_role = 'client' then
    raise exception 'This account is a developer or candidate';
  end if;
end;
$$;

revoke execute on function public.academy_add_person_check(uuid, text, uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.academy_add_person_check(uuid, text, uuid, uuid, text, uuid[]) to authenticated, service_role;

-- Same as before (20261112020000), with the checks in academy_add_person_check():
-- a client user of another client is refused instead of moved.
create or replace function public.academy_add_person(
  p_profile_id uuid,
  p_academy_role text,
  p_locale text default null,
  p_start_date date default null,
  p_client_id uuid default null,
  p_candidate_id uuid default null,
  p_course_id uuid default null,
  p_scope text default 'all',
  p_open_module_ids uuid[] default '{}',
  -- profiles.time_zone (Europe/Amsterdam, Asia/Kolkata); null keeps it.
  p_time_zone text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_new_role text;
  v_module uuid;
begin
  if p_profile_id is null then
    raise exception 'User not found';
  end if;
  perform public.academy_add_person_check(p_profile_id, p_academy_role, p_client_id, p_course_id, p_scope, p_open_module_ids);

  select role into v_role from public.profiles where id = p_profile_id;
  v_new_role := case when p_academy_role like 'client_%' then 'client' else p_academy_role end;

  if v_role not in ('admin', 'member') then
    -- external, candidate, developer or client (of this client): set the
    -- role. A developer is never turned back into a candidate.
    if not (v_role = 'developer' and v_new_role = 'candidate') then
      update public.profiles
      set role = v_new_role,
          client_id = case when v_new_role = 'client' then p_client_id else null end,
          modules = '{}'
      where id = p_profile_id;
    end if;
  end if;

  insert into public.academy_members (profile_id, academy_role, locale, start_date, candidate_id, invited_at, invited_by)
  values (
    p_profile_id, p_academy_role,
    coalesce(p_locale, case when p_academy_role like 'client_%' then 'nl' else 'en' end),
    p_start_date, p_candidate_id, now(), (select auth.uid())
  )
  on conflict (profile_id) do update set
    academy_role = case
      when academy_members.academy_role = 'developer' and excluded.academy_role = 'candidate' then 'developer'
      else excluded.academy_role
    end,
    locale = coalesce(p_locale, academy_members.locale),
    start_date = coalesce(excluded.start_date, academy_members.start_date),
    candidate_id = coalesce(excluded.candidate_id, academy_members.candidate_id),
    invited_at = now(),
    invited_by = excluded.invited_by;

  if p_time_zone is not null and v_role not in ('admin', 'member') then
    update public.profiles set time_zone = p_time_zone where id = p_profile_id;
  end if;

  if p_course_id is not null then
    insert into public.academy_course_access (course_id, profile_id, scope)
    values (p_course_id, p_profile_id, p_scope)
    on conflict (course_id, profile_id) where profile_id is not null do update
      set scope = case when academy_course_access.scope = 'all' then 'all' else excluded.scope end;

    foreach v_module in array coalesce(p_open_module_ids, '{}') loop
      insert into public.academy_open_modules (profile_id, module_id)
      values (p_profile_id, v_module)
      on conflict do nothing;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 and 3. A profile changes role or client
-- ---------------------------------------------------------------------------

-- Client memberships of placements of another client go (the person no
-- longer belongs to that client; removing a member also rotates the
-- calendar link, section 4). Becoming a developer or candidate ends all Work
-- access: memberships are deactivated the way work_deactivate_member() does
-- it (open task assignments and project memberships go, logged as
-- 'deactivated') and personal Work API tokens are revoked.
create or replace function public.academy_profiles_after_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
begin
  if old.role is distinct from new.role or old.client_id is distinct from new.client_id then
    delete from public.academy_placement_members pm
    using public.placements pl
    where pm.profile_id = new.id
      and pm.role like 'client_%'
      and pl.id = pm.placement_id
      and (new.role is distinct from 'client' or pl.client_id is distinct from new.client_id);
  end if;

  if new.role in ('developer', 'candidate') and old.role is distinct from new.role then
    for v_member in
      select workspace_id, role from public.work_members where user_id = new.id and deactivated_at is null
    loop
      delete from public.work_task_assignees a
      using public.work_tasks t
      where t.id = a.task_id and a.user_id = new.id and t.workspace_id = v_member.workspace_id
        and t.status not in ('done', 'cancelled');
      delete from public.work_project_members pm
      using public.work_projects p
      where p.id = pm.project_id and p.workspace_id = v_member.workspace_id and pm.user_id = new.id;
      update public.work_members set deactivated_at = now()
      where workspace_id = v_member.workspace_id and user_id = new.id;
      perform work_private.log_access(v_member.workspace_id, null, new.id, 'deactivated', v_member.role,
        (select auth.uid()), jsonb_build_object('reason', 'portal role ' || new.role));
    end loop;
    update public.work_api_tokens set revoked_at = now() where user_id = new.id and revoked_at is null;
  end if;
  return null;
end;
$$;

revoke execute on function public.academy_profiles_after_role_change() from public, anon, authenticated;

create trigger academy_profiles_after_role_change after update of role, client_id on public.profiles
  for each row execute function public.academy_profiles_after_role_change();

-- ---------------------------------------------------------------------------
-- 3. Work only for Work capable portal roles
-- ---------------------------------------------------------------------------

-- Same as 20261029000000, plus the portal role: developers, candidates and
-- callers have no Work, whatever memberships exist.
create or replace function work_private.role_in(p_workspace uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.work_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id = p_workspace
    and m.user_id = p_user
    and m.deactivated_at is null
    and (m.access_expires_at is null or m.access_expires_at > now())
    and p.role in ('admin', 'member', 'external', 'client');
$$;

revoke execute on function work_private.role_in(uuid, uuid) from public, anon, authenticated;
grant execute on function work_private.role_in(uuid, uuid) to service_role;

-- No active membership for a developer or candidate (an invite accepted
-- later, a reactivation, an admin adding them).
create or replace function public.work_members_portal_role_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deactivated_at is null
     and exists (select 1 from public.profiles where id = new.user_id and role in ('developer', 'candidate')) then
    raise exception 'Developers and candidates only have the Academy, not Work' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.work_members_portal_role_guard() from public, anon, authenticated;

create trigger work_members_portal_role_guard before insert or update on public.work_members
  for each row execute function public.work_members_portal_role_guard();

-- Existing developers and candidates: deactivate what is still active.
do $$
declare
  v_member record;
begin
  for v_member in
    select m.workspace_id, m.user_id, m.role
    from public.work_members m join public.profiles p on p.id = m.user_id
    where m.deactivated_at is null and p.role in ('developer', 'candidate')
  loop
    delete from public.work_task_assignees a
    using public.work_tasks t
    where t.id = a.task_id and a.user_id = v_member.user_id and t.workspace_id = v_member.workspace_id
      and t.status not in ('done', 'cancelled');
    delete from public.work_project_members pm
    using public.work_projects p
    where p.id = pm.project_id and p.workspace_id = v_member.workspace_id and pm.user_id = v_member.user_id;
    update public.work_members set deactivated_at = now()
    where workspace_id = v_member.workspace_id and user_id = v_member.user_id;
    perform work_private.log_access(v_member.workspace_id, null, v_member.user_id, 'deactivated', v_member.role,
      null, jsonb_build_object('reason', 'academy security migration'));
  end loop;
  update public.work_api_tokens t set revoked_at = now()
  from public.profiles p
  where p.id = t.user_id and p.role in ('developer', 'candidate') and t.revoked_at is null;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Calendar link: rotated when a member leaves or the placement ends
-- ---------------------------------------------------------------------------

-- A new token for an existing calendar row (no row: no link was handed out).
create or replace function public.academy_calendar_rotate_internal(p_placement_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.academy_placement_calendars
  set token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      rotated_at = now()
  where placement_id = p_placement_id;
$$;

create or replace function public.academy_calendar_after_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Skipped while the placement itself is being deleted (cascade).
  if exists (select 1 from public.placements where id = old.placement_id) then
    perform public.academy_calendar_rotate_internal(old.placement_id);
  end if;
  return null;
end;
$$;

create trigger academy_calendar_after_member_removed after delete on public.academy_placement_members
  for each row execute function public.academy_calendar_after_member_removed();

create or replace function public.academy_calendar_after_placement_ended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ended' and old.status is distinct from 'ended' then
    perform public.academy_calendar_rotate_internal(new.id);
  end if;
  return null;
end;
$$;

create trigger academy_calendar_after_placement_ended after update of status on public.placements
  for each row execute function public.academy_calendar_after_placement_ended();

revoke execute on function public.academy_calendar_rotate_internal(uuid) from public, anon, authenticated;
revoke execute on function public.academy_calendar_after_member_removed() from public, anon, authenticated;
revoke execute on function public.academy_calendar_after_placement_ended() from public, anon, authenticated;
grant execute on function public.academy_calendar_rotate_internal(uuid) to service_role;

-- Same as 20261113200000, but nothing for an ended placement.
create or replace function public.academy_calendar_feed(p_token text)
returns table (uid text, starts_on date, ends_on date, title_nl text, title_en text, category text)
language sql
stable
security definer
set search_path = ''
as $$
  with cal as (
    select c.placement_id from public.academy_placement_calendars c
    join public.placements p on p.id = c.placement_id
    where char_length(coalesce(p_token, '')) >= 32 and c.token = p_token
      and p.status is distinct from 'ended'
  )
  select 'holiday-' || h.id, h.date, h.date,
    h.name_nl || case h.country when 'NL' then ' (Nederland)' else ' (India)' end,
    h.name_en || case h.country when 'NL' then ' (Netherlands)' else ' (India)' end,
    'holiday_' || lower(h.country)
  from public.academy_holidays h
  where exists (select 1 from cal) and h.date between current_date - 400 and current_date + 1200
  union all
  select 'milestone-' || m.id, m.due_date, m.due_date,
    case m.kind when 'day_1' then 'Dag 1' when 'week_1' then 'Week 1' when 'day_30' then '30 dagen'
      when 'day_90' then 'Review na 90 dagen' else m.title end,
    case m.kind when 'day_1' then 'Day 1' when 'week_1' then 'Week 1' when 'day_30' then '30 days'
      when 'day_90' then 'Review after 90 days' else m.title end,
    'milestone'
  from public.academy_milestones m
  join cal on cal.placement_id = m.placement_id
  where m.due_date is not null
  union all
  select 'leave-' || l.id, l.start_date, l.end_date,
    'Verlof ' || coalesce(pr.full_name, ''),
    'Leave ' || coalesce(pr.full_name, ''),
    'leave'
  from public.academy_leave_requests l
  join cal on cal.placement_id = l.placement_id
  left join public.profiles pr on pr.id = l.profile_id
  where l.status = 'approved';
$$;

-- ---------------------------------------------------------------------------
-- 5. Helpers with a profile id: only the caller's own, unless manager
-- ---------------------------------------------------------------------------

-- The answers themselves live in academy_private (not exposed through the
-- API). The public helpers are security invoker: called by a signed-in user
-- (directly or from an RLS policy, current_user authenticated) they answer
-- only for auth.uid(), unless the caller is an Academy manager. Called from
-- a security definer function (current_user is the owner) or by the service
-- role they answer for anyone, so the engine, jobs and notifications that
-- look up other people keep working.
create schema if not exists academy_private;
revoke all on schema academy_private from public;
grant usage on schema academy_private to authenticated, service_role;

create or replace function academy_private.member_role(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select academy_role from public.academy_members where profile_id = p_profile_id;
$$;

create or replace function academy_private.has_course(p_course_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.academy_course_scope(p_course_id, p_profile_id) is not null;
$$;

create or replace function academy_private.placement_role(p_placement_id uuid, p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pm.role from public.academy_placement_members pm
  where pm.placement_id = p_placement_id and pm.profile_id = p_profile_id;
$$;

create or replace function academy_private.person_client(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.client_id from public.profiles p where p.id = p_profile_id and p.role = 'client'),
    (select pl.client_id from public.academy_placement_members pm
      join public.placements pl on pl.id = pm.placement_id
      where pm.profile_id = p_profile_id
      order by (pl.status = 'ended'), pl.start_date desc limit 1)
  );
$$;

-- May the caller ask about this profile? Own id (or none), a manager, or
-- not a signed-in API user (owner of a security definer function, service
-- role, database jobs).
create or replace function academy_private.may_ask_about(p_profile_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_profile_id is null
    or p_profile_id = (select auth.uid())
    or current_user not in ('authenticated', 'anon')
    or public.academy_is_manager();
$$;

revoke execute on all functions in schema academy_private from public, anon;
grant execute on all functions in schema academy_private to authenticated, service_role;

create or replace function public.academy_member_role(p_profile_id uuid default null)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case when academy_private.may_ask_about(p_profile_id)
    then academy_private.member_role(coalesce(p_profile_id, (select auth.uid()))) end;
$$;

create or replace function public.academy_has_course(p_course_id uuid, p_profile_id uuid default null)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case when academy_private.may_ask_about(p_profile_id)
    then academy_private.has_course(p_course_id, coalesce(p_profile_id, (select auth.uid())))
    else false end;
$$;

create or replace function public.academy_placement_role(p_placement_id uuid, p_profile_id uuid default null)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case when academy_private.may_ask_about(p_profile_id)
    then academy_private.placement_role(p_placement_id, coalesce(p_profile_id, (select auth.uid()))) end;
$$;

create or replace function public.academy_person_client(p_profile_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p_profile_id is not null and academy_private.may_ask_about(p_profile_id)
    then academy_private.person_client(p_profile_id) end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Vacancy groups: one event per group
-- ---------------------------------------------------------------------------

-- Same as 20261113300000, with v_event reset per group: a group whose event
-- already existed (on conflict do nothing) no longer reuses the id of the
-- previous group's event.
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
    v_event := null;
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

-- ---------------------------------------------------------------------------
-- 7. Worksheet answers: the lock holds
-- ---------------------------------------------------------------------------

drop policy if exists "Members manage own worksheet answers" on public.academy_worksheet_answers;
create policy "Members read own worksheet answers" on public.academy_worksheet_answers
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "Members start own worksheet answers" on public.academy_worksheet_answers
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and public.academy_can_see_document(document_id));
create policy "Members edit own worksheet answers" on public.academy_worksheet_answers
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()) and public.academy_can_see_document(document_id));
create policy "Members delete own unsubmitted worksheet answers" on public.academy_worksheet_answers
  for delete to authenticated
  using (profile_id = (select auth.uid()) and submitted_at is null);

-- ---------------------------------------------------------------------------
-- 8. Knowledge checks in the ATS: the first attempt counts
-- ---------------------------------------------------------------------------

-- The learner sees the right answers and explanations after every attempt
-- and may try again as often as they like, so a best or last score says
-- little. Rankings, filters and averages for Nordavo use the first attempt
-- per check; best and last stay next to it on the card.

-- Same as 20261113310000 (academy_ats_progress), with the first attempt per check.
create or replace function public.academy_ats_progress(p_candidate_ids uuid[] default null)
returns table (
  candidate_id uuid,
  profile_id uuid,
  enrolled boolean,
  academy_role text,
  top_candidate boolean,
  invited_at timestamptz,
  course_id uuid,
  lessons_total integer,
  lessons_done integer,
  progress_percent integer,
  modules_total integer,
  modules_done integer,
  started_at timestamptz,
  completed_at timestamptz,
  lead_time_days integer,
  last_activity_at timestamptz,
  inactive_14d boolean,
  checks_done integer,
  check_avg_percent integer,
  assignments_submitted integer,
  assignments_waiting integer,
  ai_avg_score integer,
  final_avg_score integer,
  videos_total integer,
  watch_avg_percent integer,
  certificate_issued_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with course as (select public.academy_ats_developer_course() as id),
  cand as (
    select c.id, c.top_candidate from public.candidates c
    where p_candidate_ids is null or c.id = any (p_candidate_ids)
  ),
  mem as (
    select am.profile_id, am.candidate_id, am.academy_role, am.invited_at, am.last_active_at, am.created_at
    from public.academy_members am join cand on cand.id = am.candidate_id
  ),
  mods as (
    select m.id from public.academy_modules m, course
    where m.course_id = course.id and m.status = 'published' and public.academy_module_has_lessons(m.id)
  ),
  lessons as (
    select distinct ml.lesson_id
    from public.academy_module_lessons ml
    join public.academy_modules m on m.id = ml.module_id
    join public.academy_lessons l on l.id = ml.lesson_id and l.status = 'published'
    join course on course.id = m.course_id
    where m.status = 'published'
  ),
  blocks as (
    select b.id, b.type, b.video_id from public.academy_lesson_blocks b
    where b.lesson_id in (select lesson_id from lessons)
      and not exists (select 1 from public.academy_block_drafts d where d.block_id = b.id)
  ),
  videos as (select distinct video_id from blocks where type = 'video' and video_id is not null),
  totals as (
    select (select count(*) from lessons)::integer as lessons, (select count(*) from mods)::integer as modules,
      (select count(*) from videos)::integer as videos
  ),
  lp as (
    select lp.profile_id,
      count(*) filter (where lp.completed_at is not null)::integer as done,
      min(lp.started_at) as started,
      max(greatest(lp.last_viewed_at, lp.updated_at)) as last_seen
    from public.academy_lesson_progress lp
    join mem on mem.profile_id = lp.profile_id
    where lp.lesson_id in (select lesson_id from lessons)
    group by lp.profile_id
  ),
  mc as (
    select mc.profile_id, count(*)::integer as done, max(mc.completed_at) as last_done
    from public.academy_module_completions mc
    join mem on mem.profile_id = mc.profile_id
    where mc.module_id in (select id from mods)
    group by mc.profile_id
  ),
  -- First attempt per check: answers and explanations are shown after an
  -- attempt and retrying is unlimited, so only the first one is a fair score.
  checks as (
    select x.profile_id, count(*)::integer as done, round(avg(x.first))::integer as avg_percent
    from (
      select a.profile_id, a.block_id,
        (array_agg(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end order by a.created_at, a.id))[1] as first
      from public.academy_check_attempts a
      join mem on mem.profile_id = a.profile_id
      where a.block_id in (select id from blocks where type = 'knowledge_check')
      group by a.profile_id, a.block_id
    ) x
    group by x.profile_id
  ),
  -- Latest attempt per assignment (swap point for the assignment builder).
  subs as (
    select s.profile_id, count(*)::integer as submitted,
      count(*) filter (where s.status = 'submitted' and s.feedback_at is null)::integer as waiting,
      round(avg(aa.ai_total))::integer as ai_avg,
      round(avg(s.final_score))::integer as final_avg
    from (
      select distinct on (s.profile_id, s.block_id) s.*
      from public.academy_assignment_submissions s
      join mem on mem.profile_id = s.profile_id
      where s.block_id in (select id from blocks where type = 'assignment')
      order by s.profile_id, s.block_id, s.attempt desc
    ) s
    left join public.academy_assignment_assessments aa on aa.submission_id = s.id and aa.ai_status = 'ready'
    group by s.profile_id
  ),
  watch as (
    select w.profile_id, sum(w.percent)::integer as total, max(w.updated_at) as last_watch
    from public.academy_watch_progress w
    join mem on mem.profile_id = w.profile_id
    where w.video_id in (select video_id from videos)
    group by w.profile_id
  ),
  cert as (
    select ce.profile_id, ce.issued_at from public.academy_certificates ce, course where ce.course_id = course.id
  ),
  agg as (
    select cand.id as candidate_id, mem.profile_id, mem.profile_id is not null as enrolled, mem.academy_role,
      cand.top_candidate, mem.invited_at, course.id as course_id,
      totals.lessons, coalesce(lp.done, 0) as lessons_done,
      totals.modules, coalesce(mc.done, 0) as modules_done,
      lp.started,
      case
        when cert.issued_at is not null then cert.issued_at
        when totals.modules > 0 and coalesce(mc.done, 0) >= totals.modules then mc.last_done
      end as completed,
      greatest(mem.last_active_at, lp.last_seen, watch.last_watch) as last_activity,
      mem.created_at as member_since,
      checks.done as checks_done, checks.avg_percent as check_avg,
      subs.submitted, subs.waiting, subs.ai_avg, subs.final_avg,
      totals.videos, watch.total as watch_total,
      cert.issued_at as cert_at
    from cand
    cross join course
    cross join totals
    left join mem on mem.candidate_id = cand.id
    left join lp on lp.profile_id = mem.profile_id
    left join mc on mc.profile_id = mem.profile_id
    left join checks on checks.profile_id = mem.profile_id
    left join subs on subs.profile_id = mem.profile_id
    left join watch on watch.profile_id = mem.profile_id
    left join cert on cert.profile_id = mem.profile_id
  )
  select r.candidate_id, r.profile_id, r.enrolled, r.academy_role, r.top_candidate, r.invited_at, r.course_id,
    r.lessons, r.lessons_done,
    case when r.lessons > 0 then least(100, (r.lessons_done * 100) / r.lessons) else 0 end,
    r.modules, r.modules_done,
    r.started, r.completed,
    case when r.started is not null then greatest(0, (extract(epoch from coalesce(r.completed, now()) - r.started) / 86400)::integer) end,
    r.last_activity,
    r.enrolled and r.completed is null and coalesce(r.last_activity, r.member_since) < now() - interval '14 days',
    coalesce(r.checks_done, 0), r.check_avg,
    coalesce(r.submitted, 0), coalesce(r.waiting, 0), r.ai_avg, r.final_avg,
    r.videos,
    case when r.enrolled and r.videos > 0 then (coalesce(r.watch_total, 0) / r.videos) end,
    r.cert_at
  from agg r;
$$;


-- Same as 20261113310000 (academy_person_detail), with first_percent per check.
create or replace function public.academy_person_detail(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.academy_members%rowtype;
  v_course uuid := public.academy_ats_developer_course();
begin
  select * into v_member from public.academy_members where profile_id = p_profile_id;
  if not found then
    return null;
  end if;
  if not (public.academy_is_manager() or (public.has_module('recruitment') and v_member.candidate_id is not null)) then
    return null;
  end if;

  return jsonb_build_object(
    'member', jsonb_build_object(
      'profile_id', v_member.profile_id, 'academy_role', v_member.academy_role, 'locale', v_member.locale,
      'start_date', v_member.start_date, 'candidate_id', v_member.candidate_id, 'invited_at', v_member.invited_at,
      'created_at', v_member.created_at, 'last_activity_at', public.academy_last_activity(p_profile_id),
      'email', (select email from public.profiles where id = p_profile_id),
      'full_name', (select full_name from public.profiles where id = p_profile_id)
    ),
    'developer_course_id', v_course,
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'course_id', c.id, 'title', c.title, 'status', c.status,
        'scope', public.academy_course_scope(c.id, p_profile_id),
        'done', public.academy_course_done(c.id, p_profile_id)
      ) order by c.position)
      from public.academy_courses c
      where public.academy_course_scope(c.id, p_profile_id) is not null
    ), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'module_id', m.id, 'course_id', m.course_id, 'title', m.title, 'position', m.position,
        'status', m.status, 'in_default_access', m.in_default_access,
        'state', public.academy_module_state(m.id, p_profile_id),
        'completed_at', mc.completed_at,
        'open_row', o.module_id is not null, 'force', coalesce(o.force, false)
      ) order by m.course_id, m.position)
      from public.academy_modules m
      left join public.academy_module_completions mc on mc.module_id = m.id and mc.profile_id = p_profile_id
      left join public.academy_open_modules o on o.module_id = m.id and o.profile_id = p_profile_id
      where public.academy_course_scope(m.course_id, p_profile_id) is not null or m.course_id = v_course
    ), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lesson_id', l.id, 'title', l.title, 'percent', lp.percent, 'started_at', lp.started_at,
        'last_viewed_at', lp.last_viewed_at, 'completed_at', lp.completed_at
      ) order by lp.completed_at nulls last, lp.started_at)
      from public.academy_lesson_progress lp join public.academy_lessons l on l.id = lp.lesson_id
      where lp.profile_id = p_profile_id
    ), '[]'::jsonb),
    'checks', coalesce((
      select jsonb_agg(x order by x ->> 'last_at' desc)
      from (
        select jsonb_build_object(
          'block_id', b.id, 'title', coalesce(b.title, 'Knowledge check'), 'lesson_title', l.title,
          'attempts', count(*),
          'first_percent', round((array_agg(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end order by a.created_at, a.id))[1]),
          'best_percent', round(max(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end)),
          'last_percent', round((array_agg(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end order by a.created_at desc))[1]),
          'last_at', max(a.created_at)
        ) as x
        from public.academy_check_attempts a
        join public.academy_lesson_blocks b on b.id = a.block_id
        join public.academy_lessons l on l.id = b.lesson_id
        where a.profile_id = p_profile_id
        group by b.id, b.title, l.title
      ) checks
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'submission_id', s.id, 'block_id', s.block_id, 'title', coalesce(b.title, 'Assignment'), 'lesson_id', l.id,
        'lesson_title', l.title, 'attempt', s.attempt, 'status', s.status, 'submitted_at', s.submitted_at,
        'feedback_at', s.feedback_at, 'final_score', s.final_score, 'link_url', s.link_url,
        'file_name', s.file_name, 'ai_total', aa.ai_total, 'ai_status', coalesce(aa.ai_status, 'none')
      ) order by s.submitted_at desc)
      from public.academy_assignment_submissions s
      join public.academy_lesson_blocks b on b.id = s.block_id
      join public.academy_lessons l on l.id = b.lesson_id
      left join public.academy_assignment_assessments aa on aa.submission_id = s.id
      where s.profile_id = p_profile_id
    ), '[]'::jsonb),
    'videos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'video_id', v.id, 'title', v.title, 'percent', coalesce(w.percent, 0), 'completed_at', w.completed_at,
        'updated_at', w.updated_at
      ) order by v.title)
      from public.academy_videos v
      left join public.academy_watch_progress w on w.video_id = v.id and w.profile_id = p_profile_id
      where w.profile_id is not null or v.id in (
        select b.video_id from public.academy_lesson_blocks b
        join public.academy_module_lessons ml on ml.lesson_id = b.lesson_id
        join public.academy_modules m on m.id = ml.module_id
        where b.video_id is not null and m.course_id = v_course and m.status = 'published'
      )
    ), '[]'::jsonb),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object('course_id', ce.course_id, 'number', ce.number, 'issued_at', ce.issued_at))
      from public.academy_certificates ce where ce.profile_id = p_profile_id
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('group_id', g.id, 'name', g.name, 'kind', g.kind) order by g.name)
      from public.academy_group_members gm join public.academy_groups g on g.id = gm.group_id
      where gm.profile_id = p_profile_id
    ), '[]'::jsonb)
  );
end;
$$;


-- Same as 20261113100000, plus first_percent (new column, so drop and create).
drop function if exists public.academy_candidate_check_scores(uuid);
create or replace function public.academy_candidate_check_scores(p_candidate_id uuid default null)
returns table (
  candidate_id uuid,
  profile_id uuid,
  block_id uuid,
  check_title text,
  lesson_title text,
  attempts integer,
  best_percent integer,
  last_percent integer,
  last_attempt_at timestamptz,
  first_percent integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select am.candidate_id, am.profile_id, b.id, coalesce(b.title, l.title), l.title,
    count(*)::integer,
    max(a.pct)::integer,
    (array_agg(a.pct order by a.created_at desc))[1]::integer,
    max(a.created_at),
    (array_agg(a.pct order by a.created_at, a.id))[1]::integer
  from public.academy_members am
  join (
    select x.*, case when x.max_score = 0 then 100 else round(x.score * 100.0 / x.max_score) end as pct
    from public.academy_check_attempts x
  ) a on a.profile_id = am.profile_id
  join public.academy_lesson_blocks b on b.id = a.block_id
  join public.academy_lessons l on l.id = b.lesson_id
  where am.candidate_id is not null
    and (p_candidate_id is null or am.candidate_id = p_candidate_id)
    and (public.academy_is_manager() or public.has_module('recruitment'))
  group by am.candidate_id, am.profile_id, b.id, b.title, l.title
  order by am.candidate_id, max(a.created_at) desc;
$$;


revoke execute on function public.academy_candidate_check_scores(uuid) from public, anon;
grant execute on function public.academy_candidate_check_scores(uuid) to authenticated, service_role;

-- Same as 20261113100000, the average of the first attempts.
create or replace function public.academy_candidate_learn_summary(p_candidate_ids uuid[] default null)
returns table (
  candidate_id uuid,
  profile_id uuid,
  checks_done integer,
  check_average_percent integer,
  assignments_submitted integer,
  assignments_approved integer,
  assignment_average_score integer,
  questionnaire_done boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select am.candidate_id, am.profile_id,
    (select count(distinct a.block_id)::integer from public.academy_check_attempts a where a.profile_id = am.profile_id),
    (select round(avg(first))::integer from (
      select (array_agg(case when a.max_score = 0 then 100 else a.score * 100.0 / a.max_score end order by a.created_at, a.id))[1] as first
      from public.academy_check_attempts a where a.profile_id = am.profile_id group by a.block_id
    ) x),
    (select count(distinct s.block_id)::integer from public.academy_assignment_submissions s where s.profile_id = am.profile_id),
    (select count(distinct s.block_id)::integer from public.academy_assignment_submissions s
      where s.profile_id = am.profile_id and s.status = 'approved'),
    (select round(avg(s.final_score))::integer from public.academy_assignment_submissions s
      where s.profile_id = am.profile_id and s.final_score is not null),
    exists (
      select 1 from public.academy_questionnaire_responses r
      join public.academy_questionnaire_consents c on c.profile_id = r.profile_id and c.block_id = r.block_id and c.withdrawn_at is null
      where r.profile_id = am.profile_id and r.submitted_at is not null
    )
  from public.academy_members am
  where am.candidate_id is not null
    and (p_candidate_ids is null or am.candidate_id = any (p_candidate_ids))
    and (public.academy_is_manager() or public.has_module('recruitment'));
$$;


-- "First" needs an order that holds within one transaction too.
alter table public.academy_check_attempts alter column created_at set default clock_timestamp();
