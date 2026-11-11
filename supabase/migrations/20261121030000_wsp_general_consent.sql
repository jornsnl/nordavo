-- Working Style Profile: one general permission instead of one per client
-- (feedback Julius, 10 November 2026).
--
-- Before: the person ticked a box per linked client, only from their own
-- Academy account, and the client saw the profile in the client portal.
-- Now:
--   * One question, not tied to a client or vacancy: "May Nordavo share your
--     Working Style Profile with companies we introduce you to for a
--     placement?" It is asked on the last screen of the questionnaire (also
--     through the personal link), with Yes, share and Not now. Nothing is
--     ticked beforehand and nothing depends on it. After Not now the portal
--     asks once more, after the general term from Settings
--     (permission_request_days, no longer per client).
--   * With permission, staff share the profile with a client (client portal)
--     or a prospect (PDF with an introduction or the anonymous profile).
--     Without it, sharing is refused. Every share is in the audit log: with
--     whom, by whom and when.
--   * The person gives or withdraws the permission in the Academy (and on
--     their report) and sees which companies received the profile and when.
--     Withdrawing means nothing new can be shared and every active share
--     ends: clients no longer see it in the portal, and their contact gets
--     the withdrawal mail.
-- Shares given per client before this migration stay as they were (the
-- person agreed to that client); withdrawing ends them as well.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.wsp_consents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.candidates (id) on delete cascade,
  consented_at timestamptz not null default now(),
  -- The person's account, or null through the personal link.
  consented_by uuid references public.profiles (id) on delete set null,
  via text not null check (via in ('questionnaire', 'report', 'academy')),
  consent_text_version text not null default 'nordavo-wsp-consent-v2',
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null
);

create unique index wsp_consents_one_active on public.wsp_consents (person_id) where revoked_at is null;
create index wsp_consents_person on public.wsp_consents (person_id, consented_at desc);

-- "Not now": the portal asks once more after the general term.
create table public.wsp_consent_prompts (
  person_id uuid primary key references public.candidates (id) on delete cascade,
  declined_at timestamptz not null default now(),
  declined_again_at timestamptz
);

alter table public.wsp_shares
  alter column client_id drop not null,
  alter column consented_by drop not null,
  add column company_id uuid references public.companies (id) on delete cascade,
  -- Staff who shared it (null for the shares the person gave per client before).
  add column shared_by uuid references public.profiles (id) on delete set null,
  add column consent_id uuid references public.wsp_consents (id) on delete set null,
  add column channel text not null default 'portal' check (channel in ('portal', 'pdf', 'anonymous_profile')),
  add constraint wsp_shares_recipient check (client_id is not null or company_id is not null);

create index wsp_shares_company on public.wsp_shares (company_id) where company_id is not null;

alter table public.wsp_permission_requests alter column client_id drop not null;
create index wsp_permission_requests_person on public.wsp_permission_requests (assessment_id, requested_at desc);

alter table public.wsp_audit_log drop constraint wsp_audit_log_action_check;
alter table public.wsp_audit_log add constraint wsp_audit_log_action_check check (action in (
  'invited', 'reminded', 'linked', 'viewed', 'shared', 'revoked', 'exported', 'permission_requested', 'deleted', 'resent',
  'settings_changed', 'consent_given', 'consent_declined', 'consent_withdrawn'
));

alter table public.wsp_consents enable row level security;
alter table public.wsp_consent_prompts enable row level security;

create policy "Staff and the person read consents" on public.wsp_consents
  for select to authenticated
  using (public.wsp_is_staff() or person_id = public.wsp_my_person_id());
create policy "Staff and the person read prompts" on public.wsp_consent_prompts
  for select to authenticated
  using (public.wsp_is_staff() or person_id = public.wsp_my_person_id());

revoke insert, update, delete, truncate on public.wsp_consents, public.wsp_consent_prompts from authenticated, anon;
grant select on public.wsp_consents, public.wsp_consent_prompts to authenticated;

-- Shares are made by staff through wsp_share and ended through
-- wsp_withdraw_consent (or deleting the profile); no direct writes.
drop policy "Person shares own profile" on public.wsp_shares;
drop policy "Person withdraws own share" on public.wsp_shares;
drop policy "Staff and the person read shares" on public.wsp_shares;
create policy "Staff and the person read shares" on public.wsp_shares
  for select to authenticated
  using (public.wsp_is_staff() or public.wsp_is_person(assessment_id));

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

create or replace function wsp_private.active_consent(p_person uuid)
returns public.wsp_consents
language sql
stable
security definer
set search_path = ''
as $$
  select c from public.wsp_consents c where c.person_id = p_person and c.revoked_at is null;
$$;

-- Ask on the last screen (no answer yet), or once more after Not now and
-- the general term; never with an active permission.
create or replace function wsp_private.may_ask(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (wsp_private.active_consent(p_person)).id is null
    and coalesce((
      select p.declined_again_at is null
         and p.declined_at <= now() - make_interval(days => (wsp_private.settings()).permission_request_days)
      from public.wsp_consent_prompts p where p.person_id = p_person
    ), true);
$$;

-- Who received the profile, for the person and for staff.
create or replace function wsp_private.recipients(p_person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'assessment_id', s.assessment_id,
      'name', coalesce(cl.name, co.name, 'A company'),
      'kind', case when s.client_id is not null then 'client' else 'prospect' end,
      'client_id', s.client_id,
      'company_id', s.company_id,
      'channel', s.channel,
      'shared_at', s.consented_at,
      'shared_by', s.shared_by,
      'shared_by_name', p.full_name,
      'revoked_at', s.revoked_at
    ) order by s.consented_at desc), '[]'::jsonb)
  from public.wsp_shares s
  join public.wsp_assessments a on a.id = s.assessment_id
  left join public.clients cl on cl.id = s.client_id
  left join public.companies co on co.id = s.company_id
  left join public.profiles p on p.id = s.shared_by
  where a.person_id = p_person;
$$;

-- The state of the permission: for the person (personal link or own account).
create or replace function public.wsp_consent_state(p_token text default null, p_assessment uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments := wsp_private.resolve(p_token, p_assessment);
  v_c public.wsp_consents;
begin
  if v_a.id is null or v_a.person_id is null or not public.wsp_enabled() then
    return null;
  end if;
  v_c := wsp_private.active_consent(v_a.person_id);
  return jsonb_build_object(
    'consented', v_c.id is not null,
    'consented_at', v_c.consented_at,
    'may_ask', wsp_private.may_ask(v_a.person_id),
    'declined_at', (select declined_at from public.wsp_consent_prompts where person_id = v_a.person_id),
    'recipients', wsp_private.recipients(v_a.person_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The person: yes, not now, withdraw
-- ---------------------------------------------------------------------------

create or replace function public.wsp_give_consent(p_token text default null, p_assessment uuid default null, p_via text default 'questionnaire')
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments := wsp_private.resolve(p_token, p_assessment);
  v_c public.wsp_consents;
  v_role text;
begin
  if v_a.id is null or v_a.person_id is null then
    raise exception 'This link is not valid any more.';
  end if;
  if not public.wsp_enabled() then
    raise exception 'The working style profile is switched off.';
  end if;
  v_c := wsp_private.active_consent(v_a.person_id);
  if v_c.id is not null then
    return v_c.consented_at;
  end if;
  v_role := wsp_private.person_role(v_a.person_id);
  insert into public.wsp_consents (person_id, consented_by, via)
  values (v_a.person_id, case when v_role = 'person' then (select auth.uid()) end,
          case when p_via in ('questionnaire', 'report', 'academy') then p_via else 'questionnaire' end)
  returning * into v_c;
  perform wsp_private.audit(v_a.id, 'consent_given', jsonb_build_object('via', v_c.via, 'version', v_c.consent_text_version), v_role);
  return v_c.consented_at;
end;
$$;

create or replace function public.wsp_decline_consent(p_token text default null, p_assessment uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments := wsp_private.resolve(p_token, p_assessment);
begin
  if v_a.id is null or v_a.person_id is null then
    raise exception 'This link is not valid any more.';
  end if;
  if (wsp_private.active_consent(v_a.person_id)).id is not null then
    return;
  end if;
  insert into public.wsp_consent_prompts (person_id) values (v_a.person_id)
  on conflict (person_id) do update
  set declined_again_at = case
    when public.wsp_consent_prompts.declined_at <= now() - make_interval(days => (wsp_private.settings()).permission_request_days)
    then coalesce(public.wsp_consent_prompts.declined_again_at, now())
    else public.wsp_consent_prompts.declined_again_at
  end;
  perform wsp_private.audit(v_a.id, 'consent_declined', '{}', wsp_private.person_role(v_a.person_id));
end;
$$;

-- Withdraw: nothing new can be shared, and every active share ends (the
-- client contact gets the withdrawal mail through shares_after).
create or replace function wsp_private.withdraw(p_person uuid, p_assessment uuid, p_role text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ended int;
begin
  update public.wsp_consents set revoked_at = now(), revoked_by = case when p_role = 'person' then (select auth.uid()) end
  where person_id = p_person and revoked_at is null;
  perform set_config('wsp.system', 'on', true);
  update public.wsp_shares s set revoked_by = case when p_role = 'person' then (select auth.uid()) end
  from public.wsp_assessments a
  where a.id = s.assessment_id and a.person_id = p_person and s.revoked_at is null;
  get diagnostics v_ended = row_count;
  perform set_config('wsp.system', '', true);
  perform wsp_private.audit(p_assessment, 'consent_withdrawn', jsonb_build_object('shares_ended', v_ended), p_role);
  return v_ended;
end;
$$;

create or replace function public.wsp_withdraw_consent(p_token text default null, p_assessment uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments := wsp_private.resolve(p_token, p_assessment);
begin
  if v_a.id is null or v_a.person_id is null then
    raise exception 'This link is not valid any more.';
  end if;
  return wsp_private.withdraw(v_a.person_id, v_a.id, wsp_private.person_role(v_a.person_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Staff: share, see, ask
-- ---------------------------------------------------------------------------

-- Share a completed profile with a client (shown in the client portal) or a
-- prospect (as a PDF, with an introduction or the anonymous profile). Only
-- with an active permission of the person. Returns the share.
create or replace function public.wsp_share(
  p_assessment uuid,
  p_client uuid default null,
  p_company uuid default null,
  p_channel text default 'portal'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.wsp_assessments;
  v_c public.wsp_consents;
  v_id uuid;
begin
  perform wsp_private.require_staff();
  if not public.wsp_enabled() then
    raise exception 'The working style profile is switched off.';
  end if;
  if (p_client is null) = (p_company is null) then
    raise exception 'Choose a client or a prospect.';
  end if;
  if p_channel not in ('portal', 'pdf', 'anonymous_profile') then
    raise exception 'Unknown way of sharing.';
  end if;
  if p_channel = 'portal' and p_client is null then
    raise exception 'Only a client has the client portal. Share a PDF with a prospect.';
  end if;
  select * into v_a from public.wsp_assessments where id = p_assessment;
  if v_a.id is null or v_a.status <> 'completed' then
    raise exception 'The questionnaire is not completed yet.';
  end if;
  v_c := wsp_private.active_consent(v_a.person_id);
  if v_c.id is null then
    raise exception 'The person has not given permission to share their profile.';
  end if;

  if p_client is not null and p_channel = 'portal' then
    select id into v_id from public.wsp_shares
    where assessment_id = p_assessment and client_id = p_client and revoked_at is null and channel = 'portal';
    if v_id is not null then
      -- Already in their portal: log the share again, keep one row.
      perform wsp_private.audit(p_assessment, 'shared',
        jsonb_build_object('client_id', p_client, 'channel', p_channel, 'by', (select auth.uid()), 'again', true));
      return v_id;
    end if;
  end if;
  if p_client is not null then
    perform wsp_private.add_link(p_assessment, null, p_client, (select auth.uid()));
  end if;

  perform set_config('wsp.sharing', 'on', true);
  insert into public.wsp_shares (assessment_id, client_id, company_id, channel, shared_by, consent_id, consent_text_version)
  values (p_assessment, p_client, p_company, p_channel, (select auth.uid()), v_c.id, v_c.consent_text_version)
  returning id into v_id;
  perform set_config('wsp.sharing', '', true);
  return v_id;
end;
$$;

-- The permission, the shares and the last request, for the candidate card.
create or replace function public.wsp_staff_consent(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.wsp_consents;
begin
  perform wsp_private.require_staff();
  v_c := wsp_private.active_consent(p_person);
  return jsonb_build_object(
    'consented', v_c.id is not null,
    'consented_at', v_c.consented_at,
    'via', v_c.via,
    'withdrawn_at', (select max(revoked_at) from public.wsp_consents where person_id = p_person),
    'declined_at', (select declined_at from public.wsp_consent_prompts where person_id = p_person),
    'last_request_at', (
      select max(r.requested_at) from public.wsp_permission_requests r
      join public.wsp_assessments a on a.id = r.assessment_id where a.person_id = p_person
    ),
    'request_days', (wsp_private.settings()).permission_request_days,
    'recipients', wsp_private.recipients(p_person)
  );
end;
$$;

-- Asking for permission is general now: at most once per term per person
-- (the setting is no longer per client). Also used at a placement start.
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
  v_role text := case when p_actor is null then 'system' else null end;
begin
  select * into v_a from public.wsp_assessments where id = p_assessment;
  if v_a.id is null or v_a.status <> 'completed' then
    return 'not_completed';
  end if;
  if (wsp_private.active_consent(v_a.person_id)).id is not null then
    return 'shared';
  end if;
  select max(r.requested_at) into v_last
  from public.wsp_permission_requests r join public.wsp_assessments a on a.id = r.assessment_id
  where a.person_id = v_a.person_id;
  if v_last is not null and v_last > now() - make_interval(days => (wsp_private.settings()).permission_request_days) then
    return 'too_soon';
  end if;

  insert into public.wsp_permission_requests (assessment_id, client_id, requested_by) values (p_assessment, p_client, p_actor);
  perform wsp_private.audit(p_assessment, 'permission_requested',
    jsonb_build_object('client_id', p_client, 'by', coalesce(p_actor::text, 'system')), v_role);
  insert into public.wsp_outbox (kind, assessment_id, client_id) values ('permission_request', p_assessment, null);

  v_profile := wsp_private.person_profile(v_a.person_id);
  if v_profile is not null then
    perform public.academy_notify(v_profile, 'wsp_permission_request', 'May we share your Working Style Profile?',
      'Nordavo would like to share your Working Style Profile with companies we introduce you to. Nothing is shared unless you say yes, and you can withdraw this at any time.',
      '/academy/working-style', jsonb_build_object('assessment_id', p_assessment));
  end if;
  return 'requested';
end;
$$;

create or replace function public.wsp_request_permission(p_assessment uuid, p_client uuid default null)
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
    raise exception 'Permission was already asked in the last % days.', (wsp_private.settings()).permission_request_days;
  elsif v_result = 'shared' then
    raise exception 'The person already gave permission.';
  elsif v_result = 'not_completed' then
    raise exception 'The questionnaire is not completed yet.';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Shares: made by staff, ended by withdrawing or deleting
-- ---------------------------------------------------------------------------

create or replace function wsp_private.shares_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_setting('wsp.sharing', true) is distinct from 'on' then
      raise exception 'Share through wsp_share.';
    end if;
    new.consented_at := now();
    new.consent_text_version := coalesce(new.consent_text_version, 'nordavo-wsp-consent-v2');
    new.revoked_at := null;
    new.revoked_by := null;
    return new;
  end if;
  -- Update: only ending the share, once, and nothing else changes.
  if old.revoked_at is not null then
    raise exception 'This share already ended.';
  end if;
  if new.assessment_id is distinct from old.assessment_id or new.client_id is distinct from old.client_id
     or new.company_id is distinct from old.company_id or new.channel is distinct from old.channel
     or new.shared_by is distinct from old.shared_by or new.consent_id is distinct from old.consent_id
     or new.consented_at is distinct from old.consented_at or new.consented_by is distinct from old.consented_by
     or new.consent_text_version is distinct from old.consent_text_version or new.id is distinct from old.id then
    raise exception 'Only ending a share is possible.';
  end if;
  if new.revoked_by is null and current_setting('wsp.system', true) is distinct from 'on' then
    raise exception 'Only ending a share is possible.';
  end if;
  new.revoked_at := now();
  return new;
end;
$$;

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
    perform wsp_private.audit(new.assessment_id, 'shared', jsonb_build_object(
      'client_id', new.client_id, 'company_id', new.company_id, 'channel', new.channel,
      'by', new.shared_by, 'to', coalesce(
        (select name from public.clients where id = new.client_id),
        (select name from public.companies where id = new.company_id))),
      case when new.shared_by is null then 'person' else null end);
    return null;
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    perform wsp_private.audit(new.assessment_id, 'revoked', jsonb_build_object('client_id', new.client_id, 'company_id', new.company_id),
      case when new.revoked_by is null then 'system' else wsp_private.actor_role() end);
    -- The mail to the client contact (exact text), with the first name frozen in the payload.
    if new.client_id is not null then
      select c.full_name into v_name from public.wsp_assessments a join public.candidates c on c.id = a.person_id
      where a.id = new.assessment_id;
      insert into public.wsp_outbox (kind, assessment_id, client_id, payload)
      values ('withdrawn', new.assessment_id, new.client_id, jsonb_build_object('full_name', v_name));
    end if;
  end if;
  return null;
end;
$$;

-- The client portal only shows portal shares (a PDF for a client is a copy, not access).
create or replace function public.wsp_client_has_share(p_assessment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.wsp_enabled()
    and public.current_client_id() is not null
    and exists (
      select 1
      from public.wsp_shares s
      join public.wsp_assessments a on a.id = s.assessment_id
      where s.assessment_id = p_assessment
        and s.client_id = public.current_client_id()
        and s.channel = 'portal'
        and s.revoked_at is null
        and a.status = 'completed'
    );
$$;

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
    and s.channel = 'portal'
    and s.revoked_at is null
    and a.status = 'completed'
  order by s.consented_at desc;
$$;

-- ---------------------------------------------------------------------------
-- 6. Keep the data for now (feedback Julius): the text about retention, the
--    talent pool and deleting is gone from the questionnaire, and the daily
--    job no longer deletes by retention until an admin switches it on.
--    delete_after is still worked out, so switching on applies at once.
--    "Delete my profile" and deleting by staff keep working.
-- ---------------------------------------------------------------------------

alter table public.wsp_settings add column retention_enabled boolean not null default false;

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
    retention_enabled = coalesce((p_settings ->> 'retention_enabled')::boolean, retention_enabled),
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

  -- Deleting by retention only when an admin switched it on (Settings, Working style).
  for v_id in
    select id from public.wsp_assessments
    where v_s.retention_enabled and status <> 'deleted' and delete_after is not null and delete_after <= now()
  loop
    perform wsp_private.delete_assessment(v_id, 'system', 'retention');
    v_deleted := v_deleted + 1;
  end loop;

  return jsonb_build_object('expired', v_expired, 'reminded', v_reminded, 'deleted', v_deleted);
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------

revoke all on all functions in schema wsp_private from public, anon, authenticated;

revoke execute on function public.wsp_consent_state(text, uuid), public.wsp_give_consent(text, uuid, text),
  public.wsp_decline_consent(text, uuid), public.wsp_withdraw_consent(text, uuid) from public;
grant execute on function public.wsp_consent_state(text, uuid), public.wsp_give_consent(text, uuid, text),
  public.wsp_decline_consent(text, uuid), public.wsp_withdraw_consent(text, uuid) to anon, authenticated, service_role;

revoke execute on function public.wsp_share(uuid, uuid, uuid, text), public.wsp_staff_consent(uuid) from public, anon;
grant execute on function public.wsp_share(uuid, uuid, uuid, text), public.wsp_staff_consent(uuid) to authenticated, service_role;

-- The new default for p_client: the old two-argument signature is replaced.
revoke execute on function public.wsp_request_permission(uuid, uuid) from public, anon;
grant execute on function public.wsp_request_permission(uuid, uuid) to authenticated;
