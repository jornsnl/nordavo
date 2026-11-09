-- Nordavo Working Style Profile, part 2: the flow. Settings changes (audited),
-- invitations (automatic on the trigger stage, on placement start, by hand),
-- the questionnaire through the personal link or the own account, the
-- report for the person, staff and shared clients, sharing and withdrawing,
-- permission requests, deleting, retention and the daily job.
-- docs/working-style-profile.md describes the rules.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

-- Admin only. Every change is in the audit log with the old and new values.
create or replace function public.wsp_update_settings(p_settings jsonb)
returns public.wsp_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.wsp_settings;
  v_new public.wsp_settings;
begin
  if not public.is_admin() then
    raise exception 'Only admins change the working style profile settings' using errcode = '42501';
  end if;
  select * into v_old from public.wsp_settings where id;
  update public.wsp_settings set
    enabled = coalesce((p_settings ->> 'enabled')::boolean, enabled),
    trigger_stage_id = coalesce(p_settings ->> 'trigger_stage_id', trigger_stage_id),
    default_for_new_vacancies = coalesce((p_settings ->> 'default_for_new_vacancies')::boolean, default_for_new_vacancies),
    auto_invite_developers_on_placement = coalesce((p_settings ->> 'auto_invite_developers_on_placement')::boolean, auto_invite_developers_on_placement),
    invite_valid_days = coalesce((p_settings ->> 'invite_valid_days')::integer, invite_valid_days),
    reminder_after_days = coalesce((p_settings ->> 'reminder_after_days')::integer, reminder_after_days),
    reuse_months = coalesce((p_settings ->> 'reuse_months')::integer, reuse_months),
    permission_request_days = coalesce((p_settings ->> 'permission_request_days')::integer, permission_request_days),
    candidate_retention_days = coalesce((p_settings ->> 'candidate_retention_days')::integer, candidate_retention_days),
    talent_pool_retention_days = coalesce((p_settings ->> 'talent_pool_retention_days')::integer, talent_pool_retention_days),
    developer_retention_days = coalesce((p_settings ->> 'developer_retention_days')::integer, developer_retention_days),
    updated_by = (select auth.uid()),
    updated_at = now()
  where id
  returning * into v_new;

  perform wsp_private.audit(null, 'settings_changed', jsonb_build_object(
    'scope', 'system',
    'old', to_jsonb(v_old) - 'id' - 'updated_by' - 'updated_at',
    'new', to_jsonb(v_new) - 'id' - 'updated_by' - 'updated_at'
  ));
  return v_new;
end;
$$;

revoke execute on function public.wsp_update_settings(jsonb) from public, anon;
grant execute on function public.wsp_update_settings(jsonb) to authenticated;

-- Vacancy (wsp_enabled) and person (wsp_mode, talent pool consent) changes
-- go through the normal updates of those tables; these triggers log them.
create or replace function wsp_private.log_vacancy_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.wsp_enabled is distinct from old.wsp_enabled then
    perform wsp_private.audit(null, 'settings_changed', jsonb_build_object(
      'scope', 'vacancy', 'vacancy_id', new.id, 'old', old.wsp_enabled, 'new', new.wsp_enabled));
  end if;
  return null;
end;
$$;

create trigger wsp_vacancy_setting after update of wsp_enabled on public.vacancies
  for each row execute function wsp_private.log_vacancy_setting();

create or replace function wsp_private.log_person_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.wsp_mode is distinct from old.wsp_mode then
    perform wsp_private.audit(null, 'settings_changed', jsonb_build_object(
      'scope', 'person', 'candidate_id', new.id, 'field', 'wsp_mode', 'old', old.wsp_mode, 'new', new.wsp_mode));
  end if;
  if (new.talent_pool_consent_at is null) is distinct from (old.talent_pool_consent_at is null) then
    perform wsp_private.audit(null, 'settings_changed', jsonb_build_object(
      'scope', 'person', 'candidate_id', new.id, 'field', 'talent_pool_consent',
      'old', old.talent_pool_consent_at is not null, 'new', new.talent_pool_consent_at is not null));
  end if;
  return null;
end;
$$;

create trigger wsp_person_setting after update of wsp_mode, talent_pool_consent_at on public.candidates
  for each row execute function wsp_private.log_person_setting();

-- ---------------------------------------------------------------------------
-- 2. Invitation rules
-- ---------------------------------------------------------------------------

-- The three levels: the person wins over the vacancy, the vacancy over the system.
create or replace function wsp_private.profile_on(p_person uuid, p_vacancy uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case c.wsp_mode
    when 'never' then false
    when 'always' then true
    else coalesce((select v.wsp_enabled from public.vacancies v where v.id = p_vacancy), false)
  end
  from public.candidates c where c.id = p_person;
$$;

-- Links whose 14 days have passed become expired (also when started; staff can resend).
create or replace function wsp_private.expire_stale(p_person uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.wsp_assessments set status = 'expired'
  where status in ('invited', 'started') and expires_at <= now()
    and (p_person is null or person_id = p_person);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function wsp_private.open_assessment(p_person uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.wsp_assessments
  where person_id = p_person and status in ('invited', 'started') and expires_at > now()
  limit 1;
$$;

-- A completed assessment younger than reuse_months that is still kept.
create or replace function wsp_private.reusable_assessment(p_person uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.wsp_assessments a
  where a.person_id = p_person and a.status = 'completed'
    and a.completed_at > now() - make_interval(months => (wsp_private.settings()).reuse_months)
  order by a.completed_at desc
  limit 1;
$$;

-- Developer when the candidate has a running placement or is a developer in the Academy.
create or replace function wsp_private.person_type(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.placements p where p.candidate_id = p_person and p.status in ('active', 'notice'))
      or exists (select 1 from public.academy_members m where m.candidate_id = p_person and m.academy_role = 'developer')
    then 'developer' else 'candidate'
  end;
$$;

-- The Academy account of the person, if any.
create or replace function wsp_private.person_profile(p_person uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.profile_id from public.academy_members m where m.candidate_id = p_person;
$$;

create or replace function wsp_private.new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 64 hex characters from two random uuids (as forms_new_token()), 244 random bits.
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

-- Link an assessment to a vacancy (and its client) or a client. Logged once.
create or replace function wsp_private.add_link(p_assessment uuid, p_vacancy uuid, p_client uuid, p_actor uuid, p_role text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid := p_client;
  v_id uuid;
begin
  if p_vacancy is not null and v_client is null then
    select client_id into v_client from public.vacancies where id = p_vacancy;
  end if;
  if p_vacancy is null and v_client is null then
    return false;
  end if;
  insert into public.wsp_assessment_links (assessment_id, vacancy_id, client_id, linked_by)
  values (p_assessment, p_vacancy, v_client, p_actor)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  perform wsp_private.audit(p_assessment, 'linked', jsonb_build_object('vacancy_id', p_vacancy, 'client_id', v_client), p_role);
  return true;
end;
$$;

-- A new assessment with a personal link, its links, the audit row and the mail.
create or replace function wsp_private.create_invite(
  p_person uuid,
  p_person_type text,
  p_reason text,
  p_actor uuid,
  p_vacancy uuid,
  p_client uuid,
  p_details jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_role text := case when p_actor is null then 'system' else null end;
  v_profile uuid;
begin
  insert into public.wsp_assessments (person_id, person_type, status, invite_token, invited_by, invite_reason, expires_at)
  values (p_person, p_person_type, 'invited', wsp_private.new_token(), p_actor, p_reason,
          now() + make_interval(days => (wsp_private.settings()).invite_valid_days))
  returning id into v_id;

  perform wsp_private.add_link(v_id, p_vacancy, p_client, p_actor, v_role);
  perform wsp_private.audit(v_id, 'invited',
    jsonb_build_object('by', coalesce(p_actor::text, 'system'), 'reason', p_reason, 'vacancy_id', p_vacancy, 'client_id', p_client)
      || coalesce(p_details, '{}'),
    v_role);
  insert into public.wsp_outbox (kind, assessment_id) values ('invite', v_id);

  -- Developers (and candidates with an Academy account) also see it in the portal.
  v_profile := wsp_private.person_profile(p_person);
  if v_profile is not null then
    perform public.academy_notify(v_profile, 'wsp_invite', 'Your Working Style Profile',
      'A short working style questionnaire is waiting for you (about 10 minutes). You always see your own results first.',
      '/academy/working-style', jsonb_build_object('assessment_id', v_id));
  end if;
  return v_id;
end;
$$;

-- Automatic invitation when an application reaches the trigger stage. The
-- result says what happened (for tests and the log): invited, linked (a
-- completed profile younger than 12 months was linked), open (an open
-- invitation was linked), again (this vacancy had a profile before: no
-- second invitation), off (not on for this person) or never.
create or replace function wsp_private.on_trigger_stage(p_application uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app record;
  v_mode text;
  v_open uuid;
  v_reuse uuid;
begin
  select a.id, a.candidate_id, a.vacancy_id, a.stage, v.client_id
  into v_app
  from public.applications a join public.vacancies v on v.id = a.vacancy_id
  where a.id = p_application;
  if v_app.id is null or not public.wsp_enabled() then
    return 'off';
  end if;

  select wsp_mode into v_mode from public.candidates where id = v_app.candidate_id;
  if v_mode = 'never' then
    return 'never';
  end if;
  if not wsp_private.profile_on(v_app.candidate_id, v_app.vacancy_id) then
    return 'off';
  end if;

  -- Back to an earlier stage and to the trigger stage again: no second invitation.
  if exists (
    select 1 from public.wsp_assessment_links l join public.wsp_assessments x on x.id = l.assessment_id
    where l.vacancy_id = v_app.vacancy_id and x.person_id = v_app.candidate_id
  ) then
    return 'again';
  end if;

  perform wsp_private.expire_stale(v_app.candidate_id);
  v_open := wsp_private.open_assessment(v_app.candidate_id);
  if v_open is not null then
    perform wsp_private.add_link(v_open, v_app.vacancy_id, v_app.client_id, null, 'system');
    return 'open';
  end if;

  v_reuse := wsp_private.reusable_assessment(v_app.candidate_id);
  if v_reuse is not null then
    perform wsp_private.add_link(v_reuse, v_app.vacancy_id, v_app.client_id, null, 'system');
    return 'linked';
  end if;

  perform wsp_private.create_invite(v_app.candidate_id, wsp_private.person_type(v_app.candidate_id), 'trigger_stage',
    null, v_app.vacancy_id, v_app.client_id,
    jsonb_build_object('stage', (wsp_private.settings()).trigger_stage_id, 'application_id', v_app.id));
  return 'invited';
end;
$$;

create or replace function wsp_private.applications_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage text := (wsp_private.settings()).trigger_stage_id;
  v_hit boolean;
begin
  if not public.wsp_enabled() then
    return null;
  end if;
  if v_stage = 'shortlist' then
    v_hit := new.shortlisted_at is not null and (tg_op = 'INSERT' or old.shortlisted_at is null);
  else
    v_hit := new.stage = v_stage and (tg_op = 'INSERT' or old.stage is distinct from new.stage);
  end if;
  if v_hit then
    -- The pipeline never fails because of the profile.
    begin
      perform wsp_private.on_trigger_stage(new.id);
    exception when others then
      raise warning 'wsp: automatic invitation failed for application %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

create trigger wsp_on_application after insert or update of stage, shortlisted_at on public.applications
  for each row execute function wsp_private.applications_trigger();

-- Ask the person to share with a client (staff, or the system when a
-- developer with a report is placed). At most once per client per
-- permission_request_days. Mail plus an in-portal notification.
create or replace function wsp_private.request_permission(p_assessment uuid, p_client uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
  v_last timestamptz;
  v_profile uuid;
  v_client_name text;
  v_role text := case when p_actor is null then 'system' else null end;
begin
  select * into v_a from public.wsp_assessments where id = p_assessment;
  if v_a.id is null or v_a.status <> 'completed' then
    return 'not_completed';
  end if;
  if not public.wsp_is_linked_client(p_assessment, p_client) then
    return 'not_linked';
  end if;
  if exists (select 1 from public.wsp_shares where assessment_id = p_assessment and client_id = p_client and revoked_at is null) then
    return 'shared';
  end if;
  select max(requested_at) into v_last from public.wsp_permission_requests
  where assessment_id = p_assessment and client_id = p_client;
  if v_last is not null and v_last > now() - make_interval(days => (wsp_private.settings()).permission_request_days) then
    return 'too_soon';
  end if;

  insert into public.wsp_permission_requests (assessment_id, client_id, requested_by) values (p_assessment, p_client, p_actor);
  perform wsp_private.audit(p_assessment, 'permission_requested',
    jsonb_build_object('client_id', p_client, 'by', coalesce(p_actor::text, 'system')), v_role);
  insert into public.wsp_outbox (kind, assessment_id, client_id) values ('permission_request', p_assessment, p_client);

  v_profile := wsp_private.person_profile(v_a.person_id);
  if v_profile is not null then
    select name into v_client_name from public.clients where id = p_client;
    perform public.academy_notify(v_profile, 'wsp_permission_request', 'May we share your Working Style Profile?',
      coalesce(v_client_name, 'A client') || ' would like to see your Working Style Profile. Nothing is shared unless you tick the box yourself.',
      '/academy/working-style', jsonb_build_object('assessment_id', p_assessment, 'client_id', p_client));
  end if;
  return 'requested';
end;
$$;

-- Placement start: link the client; a developer with a report gets a
-- permission request (nothing is shared if they do nothing); without one,
-- an invitation only when the system setting for placements is on.
create or replace function wsp_private.on_placement(p_placement uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_mode text;
  v_report uuid;
  v_open uuid;
begin
  select id, candidate_id, client_id, vacancy_id into v_p from public.placements where id = p_placement;
  if v_p.id is null or not public.wsp_enabled() then
    return 'off';
  end if;
  select wsp_mode into v_mode from public.candidates where id = v_p.candidate_id;
  if v_mode = 'never' then
    return 'never';
  end if;

  select a.id into v_report from public.wsp_assessments a
  where a.person_id = v_p.candidate_id and a.status = 'completed'
  order by a.completed_at desc limit 1;
  if v_report is not null then
    perform wsp_private.add_link(v_report, v_p.vacancy_id, v_p.client_id, null, 'system');
    return wsp_private.request_permission(v_report, v_p.client_id, null);
  end if;

  perform wsp_private.expire_stale(v_p.candidate_id);
  v_open := wsp_private.open_assessment(v_p.candidate_id);
  if v_open is not null then
    perform wsp_private.add_link(v_open, v_p.vacancy_id, v_p.client_id, null, 'system');
    return 'open';
  end if;

  if not (wsp_private.settings()).auto_invite_developers_on_placement then
    return 'off';
  end if;
  perform wsp_private.create_invite(v_p.candidate_id, 'developer', 'placement_start', null, v_p.vacancy_id, v_p.client_id,
    jsonb_build_object('placement_id', v_p.id));
  return 'invited';
end;
$$;

create or replace function wsp_private.placements_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform wsp_private.on_placement(new.id);
  exception when others then
    raise warning 'wsp: placement automation failed for placement %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger wsp_on_placement after insert on public.placements
  for each row execute function wsp_private.placements_trigger();

-- ---------------------------------------------------------------------------
-- 3. Staff actions
-- ---------------------------------------------------------------------------

create or replace function wsp_private.require_staff()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.wsp_is_staff() then
    raise exception 'Only the Nordavo team can do this' using errcode = '42501';
  end if;
end;
$$;

-- Vacancy and person settings for staff (recruitment or Academy managers);
-- the triggers above log every change.
create or replace function public.wsp_set_vacancy(p_vacancy uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform wsp_private.require_staff();
  update public.vacancies set wsp_enabled = p_enabled where id = p_vacancy;
  if not found then
    raise exception 'Vacancy not found.';
  end if;
end;
$$;

create or replace function public.wsp_set_person(p_person uuid, p_mode text default null, p_talent_pool_consent boolean default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform wsp_private.require_staff();
  update public.candidates set
    wsp_mode = coalesce(p_mode, wsp_mode),
    talent_pool_consent_at = case
      when p_talent_pool_consent is null then talent_pool_consent_at
      when p_talent_pool_consent then coalesce(talent_pool_consent_at, now())
      else null end
  where id = p_person;
  if not found then
    raise exception 'Candidate not found.';
  end if;
end;
$$;

revoke execute on function public.wsp_set_vacancy(uuid, boolean), public.wsp_set_person(uuid, text, boolean) from public, anon;
grant execute on function public.wsp_set_vacancy(uuid, boolean), public.wsp_set_person(uuid, text, boolean) to authenticated;

-- "Send working style profile": also when the vacancy is off; never for a
-- person on Never, never with the system off. Optionally for a vacancy and client.
create or replace function public.wsp_send(p_person uuid, p_vacancy uuid default null, p_client uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_client uuid := p_client;
begin
  perform wsp_private.require_staff();
  if not public.wsp_enabled() then
    raise exception 'The working style profile is switched off.';
  end if;
  select wsp_mode into v_mode from public.candidates where id = p_person;
  if v_mode is null then
    raise exception 'Candidate not found.';
  end if;
  if v_mode = 'never' then
    raise exception 'This person is set to Never: no invitations.';
  end if;
  perform wsp_private.expire_stale(p_person);
  if wsp_private.open_assessment(p_person) is not null then
    raise exception 'There is already an open invitation. Resend it instead.';
  end if;
  if p_vacancy is not null and v_client is null then
    select client_id into v_client from public.vacancies where id = p_vacancy;
  end if;
  return wsp_private.create_invite(p_person, wsp_private.person_type(p_person), 'manual', (select auth.uid()), p_vacancy, v_client);
end;
$$;

-- A new link (and 14 days) for an invitation that expired or was not opened.
-- Answers given so far stay.
create or replace function public.wsp_resend(p_assessment uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
begin
  perform wsp_private.require_staff();
  if not public.wsp_enabled() then
    raise exception 'The working style profile is switched off.';
  end if;
  select * into v_a from public.wsp_assessments where id = p_assessment;
  if v_a.id is null or v_a.status not in ('invited', 'started', 'expired') then
    raise exception 'Only an open or expired invitation can be sent again.';
  end if;
  if (select wsp_mode from public.candidates where id = v_a.person_id) = 'never' then
    raise exception 'This person is set to Never: no invitations.';
  end if;
  if exists (select 1 from public.wsp_assessments where person_id = v_a.person_id and id <> v_a.id
             and status in ('invited', 'started') and expires_at > now()) then
    raise exception 'This person has another open invitation.';
  end if;
  update public.wsp_assessments set
    status = case when started_at is null then 'invited' else 'started' end,
    invite_token = wsp_private.new_token(),
    invited_at = now(),
    expires_at = now() + make_interval(days => (wsp_private.settings()).invite_valid_days),
    reminder_sent_at = null
  where id = p_assessment;
  perform wsp_private.audit(p_assessment, 'resent', jsonb_build_object('by', (select auth.uid())));
  insert into public.wsp_outbox (kind, assessment_id) values ('invite', p_assessment);
  return p_assessment;
end;
$$;

create or replace function public.wsp_link(p_assessment uuid, p_vacancy uuid default null, p_client uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform wsp_private.require_staff();
  if not exists (select 1 from public.wsp_assessments where id = p_assessment and status <> 'deleted') then
    raise exception 'Assessment not found.';
  end if;
  return wsp_private.add_link(p_assessment, p_vacancy, p_client, (select auth.uid()));
end;
$$;

-- "Ask for permission". Staff never consents; this only asks.
create or replace function public.wsp_request_permission(p_assessment uuid, p_client uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result text;
begin
  perform wsp_private.require_staff();
  if not public.wsp_enabled() then
    raise exception 'The working style profile is switched off.';
  end if;
  v_result := wsp_private.request_permission(p_assessment, p_client, (select auth.uid()));
  if v_result = 'too_soon' then
    raise exception 'Permission was already asked for this client in the last % days.', (wsp_private.settings()).permission_request_days;
  elsif v_result = 'shared' then
    raise exception 'The profile is already shared with this client.';
  elsif v_result = 'not_linked' then
    raise exception 'This client is not linked to the profile.';
  elsif v_result = 'not_completed' then
    raise exception 'The questionnaire is not completed yet.';
  end if;
  return v_result;
end;
$$;

revoke execute on function public.wsp_send(uuid, uuid, uuid), public.wsp_resend(uuid), public.wsp_link(uuid, uuid, uuid),
  public.wsp_request_permission(uuid, uuid) from public, anon;
grant execute on function public.wsp_send(uuid, uuid, uuid), public.wsp_resend(uuid), public.wsp_link(uuid, uuid, uuid),
  public.wsp_request_permission(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The questionnaire (personal link or own account)
-- ---------------------------------------------------------------------------

-- The assessment for a personal link (anyone holding it, signed in or not)
-- or for the signed-in person. Null otherwise, and null for deleted ones.
create or replace function wsp_private.resolve(p_token text, p_assessment uuid)
returns public.wsp_assessments
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
begin
  if p_token is not null then
    if p_token !~ '^[0-9a-f]{64}$' then
      return null;
    end if;
    select * into v_a from public.wsp_assessments
    where invite_token = p_token and status <> 'deleted' and (p_assessment is null or id = p_assessment);
  elsif p_assessment is not null then
    select * into v_a from public.wsp_assessments
    where id = p_assessment and status <> 'deleted' and person_id = public.wsp_my_person_id();
  end if;
  if v_a.id is null then
    return null;
  end if;
  return v_a;
end;
$$;

-- Who acts in the audit log: the person signed in, or the personal link.
create or replace function wsp_private.person_role(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_person is not null and p_person = public.wsp_my_person_id() then 'person' else 'person_link' end;
$$;

-- Everything the questionnaire page needs: state, intro variant, the
-- statements in their fixed order, the answers so far and the page to
-- continue on. Null when the link is unknown or the feature is off.
create or replace function public.wsp_questionnaire(p_token text default null, p_assessment uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
  v_name text;
  v_answers jsonb;
  v_page integer;
begin
  if not public.wsp_enabled() then
    return null;
  end if;
  v_a := wsp_private.resolve(p_token, p_assessment);
  if v_a.id is null then
    return null;
  end if;
  if v_a.status in ('invited', 'started') and v_a.expires_at <= now() then
    update public.wsp_assessments set status = 'expired' where id = v_a.id;
    v_a.status := 'expired';
  end if;
  select full_name into v_name from public.candidates where id = v_a.person_id;

  select coalesce(jsonb_object_agg(x.item_id, x.answer), '{}') into v_answers
  from public.wsp_answers x where x.assessment_id = v_a.id;

  select coalesce(min(ceil(i.position / 10.0)::integer), (select ceil(max(position) / 10.0)::integer from public.wsp_items where instrument_version = v_a.instrument_version))
  into v_page
  from public.wsp_items i
  where i.instrument_version = v_a.instrument_version
    and not exists (select 1 from public.wsp_answers x where x.assessment_id = v_a.id and x.item_id = i.id);

  return jsonb_build_object(
    'id', v_a.id,
    'status', v_a.status,
    'person_type', v_a.person_type,
    'full_name', v_name,
    'intro_accepted', v_a.intro_accepted_at is not null,
    'expires_at', v_a.expires_at,
    'completed_at', v_a.completed_at,
    'signed_in_as_person', v_a.person_id = public.wsp_my_person_id(),
    'page', v_page,
    'answers', v_answers,
    'items', (
      select jsonb_agg(jsonb_build_object('id', i.id, 'position', i.position, 'statement', i.statement) order by i.position)
      from public.wsp_items i where i.instrument_version = v_a.instrument_version
    )
  );
end;
$$;

create or replace function wsp_private.require_open(p_token text, p_assessment uuid)
returns public.wsp_assessments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
begin
  if not public.wsp_enabled() then
    raise exception 'The working style profile is not available.';
  end if;
  v_a := wsp_private.resolve(p_token, p_assessment);
  if v_a.id is null then
    raise exception 'This link is not valid.' using errcode = '42501';
  end if;
  if v_a.status not in ('invited', 'started') or v_a.expires_at <= now() then
    raise exception 'This questionnaire is closed. Ask Nordavo for a new link.';
  end if;
  return v_a;
end;
$$;

-- The mandatory checkbox of the intro: starts the questionnaire.
create or replace function public.wsp_accept_intro(p_token text default null, p_assessment uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
begin
  v_a := wsp_private.require_open(p_token, p_assessment);
  update public.wsp_assessments set
    intro_accepted_at = coalesce(intro_accepted_at, now()),
    started_at = coalesce(started_at, now()),
    status = 'started'
  where id = v_a.id;
end;
$$;

-- Add time spent on a page (all visits count). Every answer of the page carries the total.
create or replace function wsp_private.add_page_time(p_assessment uuid, p_page integer, p_elapsed_ms integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_elapsed integer := least(greatest(coalesce(p_elapsed_ms, 0), 0), 3600000);
begin
  if v_elapsed = 0 then
    return;
  end if;
  update public.wsp_answers set page_duration_ms = least(page_duration_ms + v_elapsed, 86400000)
  where assessment_id = p_assessment and page_number = p_page;
end;
$$;

-- One answer, saved at once. The statement must be on the page that is shown.
create or replace function public.wsp_save_answer(
  p_token text,
  p_assessment uuid,
  p_item uuid,
  p_answer integer,
  p_page integer,
  p_elapsed_ms integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
  v_position integer;
  v_page_ms integer;
begin
  v_a := wsp_private.require_open(p_token, p_assessment);
  if v_a.intro_accepted_at is null then
    raise exception 'Tick the box on the first screen to start.';
  end if;
  if p_answer is null or p_answer not between 1 and 5 then
    raise exception 'Choose one of the five answers.';
  end if;
  select position into v_position from public.wsp_items where id = p_item and instrument_version = v_a.instrument_version;
  if v_position is null or ceil(v_position / 10.0)::integer <> p_page then
    raise exception 'This statement is not on this page.';
  end if;
  select coalesce(max(page_duration_ms), 0) into v_page_ms from public.wsp_answers
  where assessment_id = v_a.id and page_number = p_page;
  insert into public.wsp_answers (assessment_id, item_id, answer, answered_at, page_number, page_duration_ms)
  values (v_a.id, p_item, p_answer, now(), p_page, v_page_ms)
  on conflict (assessment_id, item_id) do update set answer = excluded.answer, answered_at = excluded.answered_at;
  perform wsp_private.add_page_time(v_a.id, p_page, p_elapsed_ms);
end;
$$;

-- Time on a page without a new answer (leaving the page, Next, Back).
create or replace function public.wsp_page_time(p_token text, p_assessment uuid, p_page integer, p_elapsed_ms integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
begin
  v_a := wsp_private.require_open(p_token, p_assessment);
  perform wsp_private.add_page_time(v_a.id, p_page, p_elapsed_ms);
end;
$$;

-- When the profile is deleted (null while not known), see section 7.
create or replace function wsp_private.compute_delete_after(p_assessment uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
  v_s public.wsp_settings := wsp_private.settings();
  v_consent timestamptz;
  v_open boolean;
  v_closed timestamptz;
  v_has_links boolean;
  v_count integer;
begin
  select * into v_a from public.wsp_assessments where id = p_assessment;
  if v_a.id is null or v_a.status = 'deleted' then
    return null;
  end if;

  -- Developers: 28 days after the end of the (last) placement.
  if exists (select 1 from public.placements where candidate_id = v_a.person_id) then
    if exists (select 1 from public.placements where candidate_id = v_a.person_id and status <> 'ended') then
      return null;
    end if;
    select max(coalesce(end_date::timestamptz, updated_at)) into v_closed from public.placements where candidate_id = v_a.person_id;
    return v_closed + make_interval(days => v_s.developer_retention_days);
  end if;

  -- Candidates with talent pool consent: 365 days after the questionnaire.
  select talent_pool_consent_at into v_consent from public.candidates where id = v_a.person_id;
  if v_consent is not null then
    return coalesce(v_a.completed_at, v_a.invited_at) + make_interval(days => v_s.talent_pool_retention_days);
  end if;

  -- Other candidates: 28 days after the last linked application process
  -- closed (rejected, parked, or the vacancy closed or filled). Without a
  -- linked vacancy, all applications of the candidate count.
  v_has_links := exists (select 1 from public.wsp_assessment_links where assessment_id = v_a.id and vacancy_id is not null);
  select count(*),
         bool_or(not (ap.stage in ('rejected', 'parked') or v.status in ('closed', 'filled'))),
         max(case
               when ap.stage = 'rejected' then coalesce(ap.rejected_at, ap.updated_at)
               when ap.stage = 'parked' then coalesce(ap.parked_at, ap.updated_at)
               else coalesce(v.closed_at::timestamptz, v.updated_at)
             end)
  into v_count, v_open, v_closed
  from public.applications ap
  join public.vacancies v on v.id = ap.vacancy_id
  where ap.candidate_id = v_a.person_id
    and (not v_has_links or ap.vacancy_id in (select vacancy_id from public.wsp_assessment_links where assessment_id = v_a.id));

  if v_count = 0 then
    return coalesce(v_a.completed_at, v_a.expires_at) + make_interval(days => v_s.candidate_retention_days);
  end if;
  if v_open then
    return null;
  end if;
  return greatest(v_closed, coalesce(v_a.completed_at, v_a.invited_at)) + make_interval(days => v_s.candidate_retention_days);
end;
$$;

-- After the last page: score, flags, completed, mail to staff.
create or replace function public.wsp_complete(p_token text default null, p_assessment uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
  v_missing integer;
begin
  v_a := wsp_private.require_open(p_token, p_assessment);
  if v_a.intro_accepted_at is null then
    raise exception 'Tick the box on the first screen to start.';
  end if;
  select count(*) into v_missing from public.wsp_items i
  where i.instrument_version = v_a.instrument_version
    and not exists (select 1 from public.wsp_answers x where x.assessment_id = v_a.id and x.item_id = i.id);
  if v_missing > 0 then
    raise exception 'Answer every statement (% to go).', v_missing;
  end if;

  perform wsp_private.score_assessment(v_a.id);
  perform wsp_private.compute_flags(v_a.id);
  update public.wsp_assessments set status = 'completed', completed_at = now() where id = v_a.id;
  update public.wsp_assessments set delete_after = wsp_private.compute_delete_after(v_a.id) where id = v_a.id;
  insert into public.wsp_outbox (kind, assessment_id, payload)
  values ('completed', v_a.id, jsonb_build_object('flags', (
    select coalesce(jsonb_agg(flag_type order by flag_type), '[]') from public.wsp_flags where assessment_id = v_a.id)));
  return v_a.id;
end;
$$;

grant execute on function public.wsp_questionnaire(text, uuid), public.wsp_accept_intro(text, uuid),
  public.wsp_save_answer(text, uuid, uuid, integer, integer, integer), public.wsp_page_time(text, uuid, integer, integer),
  public.wsp_complete(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The report
-- ---------------------------------------------------------------------------

-- The report for whoever asks, with the intro for their role:
--   person  the personal link or the own account (also the share status per linked client)
--   staff   recruitment or Academy managers (the client intro; flags and answers they read from the tables)
--   client  only with an active share for their own client; every view is logged
-- p_export logs a download (every role). Null when not allowed.
create or replace function public.wsp_report(p_assessment uuid default null, p_token text default null, p_export boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
  v_audience text;
  v_role text;
  v_client uuid;
  v_name text;
  v_title text;
  v_role_label text;
  v_share record;
  v_result jsonb;
begin
  if not public.wsp_enabled() then
    return null;
  end if;

  if p_token is not null then
    v_a := wsp_private.resolve(p_token, p_assessment);
    if v_a.id is not null then
      v_audience := 'person';
      v_role := wsp_private.person_role(v_a.person_id);
    end if;
  elsif p_assessment is not null then
    v_a := wsp_private.resolve(null, p_assessment);
    if v_a.id is not null then
      v_audience := 'person';
      v_role := 'person';
    elsif public.wsp_is_staff() then
      select * into v_a from public.wsp_assessments where id = p_assessment and status <> 'deleted';
      v_audience := 'staff';
      v_role := case when public.is_admin() then 'admin' else 'staff' end;
    elsif public.wsp_client_has_share(p_assessment) then
      select * into v_a from public.wsp_assessments where id = p_assessment;
      v_audience := 'client';
      v_role := 'client';
      v_client := public.current_client_id();
    end if;
  end if;

  if v_a.id is null or v_a.status <> 'completed' then
    return null;
  end if;

  select c.full_name, c.current_title into v_name, v_title from public.candidates c where c.id = v_a.person_id;
  -- Role or vacancy in the header: a vacancy of this client (for a client),
  -- otherwise the latest linked vacancy, otherwise the current title.
  select v.title into v_role_label
  from public.wsp_assessment_links l join public.vacancies v on v.id = l.vacancy_id
  where l.assessment_id = v_a.id and (v_client is null or l.client_id = v_client)
  order by l.linked_at desc limit 1;
  v_role_label := coalesce(v_role_label, v_title);

  v_result := jsonb_build_object(
    'id', v_a.id,
    'audience', v_audience,
    'full_name', v_name,
    'role_label', v_role_label,
    'person_type', v_a.person_type,
    'completed_at', v_a.completed_at,
    'instrument_version', v_a.instrument_version,
    'results', (
      select coalesce(jsonb_agg(jsonb_build_object('dimension', r.dimension, 'mean', r.mean_score, 'score', r.score_0_100, 'band', r.band)), '[]')
      from public.wsp_results r where r.assessment_id = v_a.id
    )
  );

  if v_audience in ('person', 'staff') then
    v_result := v_result || jsonb_build_object(
      'can_share', v_a.person_id = public.wsp_my_person_id(),
      'clients', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'client_id', c.id,
          'name', c.name,
          'status', case
            when exists (select 1 from public.wsp_shares s where s.assessment_id = v_a.id and s.client_id = c.id and s.revoked_at is null) then 'shared'
            when exists (select 1 from public.wsp_shares s where s.assessment_id = v_a.id and s.client_id = c.id) then 'withdrawn'
            else 'not_shared' end,
          'consented_at', (select max(s.consented_at) from public.wsp_shares s where s.assessment_id = v_a.id and s.client_id = c.id and s.revoked_at is null),
          'revoked_at', (select max(s.revoked_at) from public.wsp_shares s where s.assessment_id = v_a.id and s.client_id = c.id),
          'requested_at', (select max(r.requested_at) from public.wsp_permission_requests r where r.assessment_id = v_a.id and r.client_id = c.id)
        ) order by c.name), '[]')
        from public.clients c
        where c.id in (select l.client_id from public.wsp_assessment_links l where l.assessment_id = v_a.id)
      )
    );
  end if;

  if v_audience = 'client' then
    select c.name as client_name, s.consented_at into v_share
    from public.wsp_shares s join public.clients c on c.id = s.client_id
    where s.assessment_id = v_a.id and s.client_id = v_client and s.revoked_at is null;
    v_result := v_result || jsonb_build_object('share', jsonb_build_object('client_name', v_share.client_name, 'consented_at', v_share.consented_at));
    if not p_export then
      perform wsp_private.audit(v_a.id, 'viewed', jsonb_build_object('client_id', v_client), 'client');
    end if;
  end if;

  if p_export then
    perform wsp_private.audit(v_a.id, 'exported', jsonb_build_object('role', v_role, 'audience', v_audience, 'client_id', v_client), v_role);
  end if;
  return v_result;
end;
$$;

grant execute on function public.wsp_report(uuid, text, boolean) to anon, authenticated;

-- Reports shared with the client of the signed-in client user (portal only).
create or replace function public.wsp_client_reports()
returns table (assessment_id uuid, full_name text, role_label text, completed_at timestamptz, consented_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, c.full_name,
         coalesce((select v.title from public.wsp_assessment_links l join public.vacancies v on v.id = l.vacancy_id
                   where l.assessment_id = a.id and l.client_id = s.client_id order by l.linked_at desc limit 1), c.current_title),
         a.completed_at, s.consented_at
  from public.wsp_shares s
  join public.wsp_assessments a on a.id = s.assessment_id
  join public.candidates c on c.id = a.person_id
  where public.wsp_enabled()
    and public.current_client_id() is not null
    and s.client_id = public.current_client_id()
    and s.revoked_at is null
    and a.status = 'completed'
  order by s.consented_at desc;
$$;

revoke execute on function public.wsp_client_reports() from public, anon;
grant execute on function public.wsp_client_reports() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Sharing and withdrawing (the person, through RLS on wsp_shares)
-- ---------------------------------------------------------------------------

create or replace function wsp_private.shares_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.consented_at := now();
    new.consent_text_version := 'nordavo-wsp-consent-v1';
    new.revoked_at := null;
    new.revoked_by := null;
    return new;
  end if;
  -- Update: only withdrawing, once, and nothing else changes.
  if old.revoked_at is not null then
    raise exception 'This permission was already withdrawn.';
  end if;
  if new.assessment_id is distinct from old.assessment_id or new.client_id is distinct from old.client_id
     or new.consented_at is distinct from old.consented_at or new.consented_by is distinct from old.consented_by
     or new.consent_text_version is distinct from old.consent_text_version or new.id is distinct from old.id then
    raise exception 'Only withdrawing is possible.';
  end if;
  if new.revoked_by is null and current_setting('wsp.system', true) is distinct from 'on' then
    raise exception 'Only withdrawing is possible.';
  end if;
  new.revoked_at := now();
  return new;
end;
$$;

create trigger wsp_shares_before before insert or update on public.wsp_shares
  for each row execute function wsp_private.shares_before();

create or replace function wsp_private.shares_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    perform wsp_private.audit(new.assessment_id, 'shared', jsonb_build_object('client_id', new.client_id), 'person');
    return null;
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    perform wsp_private.audit(new.assessment_id, 'revoked', jsonb_build_object('client_id', new.client_id),
      case when new.revoked_by is null then 'system' else wsp_private.actor_role() end);
    -- The mail to the client contact (exact text), with the first name frozen in the payload.
    select c.full_name into v_name from public.wsp_assessments a join public.candidates c on c.id = a.person_id
    where a.id = new.assessment_id;
    insert into public.wsp_outbox (kind, assessment_id, client_id, payload)
    values ('withdrawn', new.assessment_id, new.client_id, jsonb_build_object('full_name', v_name));
  end if;
  return null;
end;
$$;

create trigger wsp_shares_after after insert or update on public.wsp_shares
  for each row execute function wsp_private.shares_after();

-- ---------------------------------------------------------------------------
-- 7. Deleting and retention
-- ---------------------------------------------------------------------------

-- Deletes everything of an assessment except one audit row without content.
-- Active shares are withdrawn first, with the mail to the client.
create or replace function wsp_private.delete_assessment(p_assessment uuid, p_role text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('wsp.system', 'on', true);
  update public.wsp_shares set revoked_by = case when p_role in ('system', 'person_link') then null else (select auth.uid()) end
  where assessment_id = p_assessment and revoked_at is null;
  perform set_config('wsp.system', 'off', true);

  delete from public.wsp_answers where assessment_id = p_assessment;
  delete from public.wsp_results where assessment_id = p_assessment;
  delete from public.wsp_flags where assessment_id = p_assessment;
  delete from public.wsp_assessment_links where assessment_id = p_assessment;
  delete from public.wsp_shares where assessment_id = p_assessment;
  delete from public.wsp_permission_requests where assessment_id = p_assessment;
  delete from public.wsp_audit_log where assessment_id = p_assessment;
  update public.wsp_outbox set status = 'skipped', payload = '{}', handled_at = now()
  where assessment_id = p_assessment and status in ('pending', 'failed') and kind <> 'withdrawn';

  update public.wsp_assessments set
    status = 'deleted', person_id = null, invite_token = null, invited_by = null,
    reminder_sent_at = null, started_at = null, completed_at = null, intro_accepted_at = null,
    delete_after = null, deleted_at = now()
  where id = p_assessment;
  perform wsp_private.audit(p_assessment, 'deleted', jsonb_build_object('by', p_reason), p_role);
end;
$$;

-- "Delete my profile" (personal link or own account).
create or replace function public.wsp_delete_my_profile(p_token text default null, p_assessment uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
begin
  v_a := wsp_private.resolve(p_token, p_assessment);
  if v_a.id is null then
    raise exception 'This link is not valid.' using errcode = '42501';
  end if;
  perform wsp_private.delete_assessment(v_a.id, wsp_private.person_role(v_a.person_id), 'person');
end;
$$;

grant execute on function public.wsp_delete_my_profile(text, uuid) to anon, authenticated;

-- Staff: delete a profile (for example after a mistaken invitation).
create or replace function public.wsp_staff_delete(p_assessment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform wsp_private.require_staff();
  if not exists (select 1 from public.wsp_assessments where id = p_assessment and status <> 'deleted') then
    raise exception 'Assessment not found.';
  end if;
  perform wsp_private.delete_assessment(p_assessment, wsp_private.actor_role(), 'staff');
end;
$$;

revoke execute on function public.wsp_staff_delete(uuid) from public, anon;
grant execute on function public.wsp_staff_delete(uuid) to authenticated;

-- The daily job (wsp-daily, service role): expire links, one reminder after
-- reminder_after_days for invitations not started, recompute delete_after
-- and delete what is due. Returns the counts.
create or replace function public.wsp_run_daily()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.wsp_settings := wsp_private.settings();
  v_expired integer;
  v_reminded integer := 0;
  v_deleted integer := 0;
  v_id uuid;
begin
  v_expired := wsp_private.expire_stale(null);

  if v_s.enabled then
    for v_id in
      select id from public.wsp_assessments
      where status = 'invited' and started_at is null and reminder_sent_at is null
        and invited_at <= now() - make_interval(days => v_s.reminder_after_days)
        and expires_at > now()
    loop
      update public.wsp_assessments set reminder_sent_at = now() where id = v_id;
      perform wsp_private.audit(v_id, 'reminded', '{}', 'system');
      insert into public.wsp_outbox (kind, assessment_id) values ('reminder', v_id);
      v_reminded := v_reminded + 1;
    end loop;
  end if;

  update public.wsp_assessments set delete_after = wsp_private.compute_delete_after(id)
  where status <> 'deleted';

  for v_id in
    select id from public.wsp_assessments where status <> 'deleted' and delete_after is not null and delete_after <= now()
  loop
    perform wsp_private.delete_assessment(v_id, 'system', 'retention');
    v_deleted := v_deleted + 1;
  end loop;

  return jsonb_build_object('expired', v_expired, 'reminded', v_reminded, 'deleted', v_deleted);
end;
$$;

revoke execute on function public.wsp_run_daily() from public, anon, authenticated;
grant execute on function public.wsp_run_daily() to service_role;

revoke all on all functions in schema wsp_private from public, anon, authenticated;
