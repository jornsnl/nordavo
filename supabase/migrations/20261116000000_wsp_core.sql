-- Nordavo Working Style Profile (Big Five), part 1: data model, the 52
-- statements, settings, access helpers, row level security and scoring.
-- docs/working-style-profile.md is the description; the fixed texts live in
-- src/lib/wsp/content.ts (the statements also here, tests compare both).
--
-- Hard rules from the assignment that this migration enforces:
-- * scoring is rule based, in SQL (wsp_private.score_assessment) and in
--   TypeScript (src/lib/wsp/scoring.ts), with the same test cases on both;
-- * clients never read answers, flags or the assessment row; they read a
--   report only with an active share (wsp_client_has_share);
-- * a share is made only by the person, from their own account
--   (policy "Person shares own profile": consented_by = auth.uid());
-- * nothing here is used by candidate lists, boards, search or the talent pool.

-- ---------------------------------------------------------------------------
-- 1. Settings (one row, admin only)
-- ---------------------------------------------------------------------------

create schema if not exists wsp_private;
revoke all on schema wsp_private from public, anon, authenticated;

create table public.wsp_settings (
  id boolean primary key default true check (id),
  -- Off: the feature is hidden everywhere and nothing is sent.
  enabled boolean not null default false,
  -- The pipeline stage that invites a candidate automatically. "shortlist"
  -- is the shortlist mark on the board (applications.shortlisted_at); the
  -- others are the flow stages of applications.stage.
  trigger_stage_id text not null default 'shortlist' check (trigger_stage_id in (
    'shortlist', 'sourced', 'techstack_check', 'fill_out', 'video_review', 'technical_test',
    'interview', 'matched', 'client_interview', 'final_screening', 'placed'
  )),
  default_for_new_vacancies boolean not null default true,
  auto_invite_developers_on_placement boolean not null default false,
  -- Terms (part 4: "alle termijnen instelbaar in de config").
  invite_valid_days integer not null default 14 check (invite_valid_days between 1 and 90),
  reminder_after_days integer not null default 3 check (reminder_after_days between 1 and 30),
  reuse_months integer not null default 12 check (reuse_months between 0 and 36),
  permission_request_days integer not null default 7 check (permission_request_days between 1 and 90),
  candidate_retention_days integer not null default 28 check (candidate_retention_days between 0 and 3650),
  talent_pool_retention_days integer not null default 365 check (talent_pool_retention_days between 0 and 3650),
  developer_retention_days integer not null default 28 check (developer_retention_days between 0 and 3650),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.wsp_settings (id) values (true);

create or replace function wsp_private.settings()
returns public.wsp_settings
language sql
stable
security definer
set search_path = ''
as $$
  select s from public.wsp_settings s where s.id;
$$;

-- Default of vacancies.wsp_enabled for new vacancies.
create or replace function public.wsp_default_for_new_vacancies()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select default_for_new_vacancies from public.wsp_settings where id), false);
$$;

revoke execute on function public.wsp_default_for_new_vacancies() from public, anon;
grant execute on function public.wsp_default_for_new_vacancies() to authenticated, service_role;

-- Is the feature on? For every page (also the personal link, signed out).
create or replace function public.wsp_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from public.wsp_settings where id), false);
$$;

grant execute on function public.wsp_enabled() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Vacancy and person settings
-- ---------------------------------------------------------------------------

-- Existing vacancies start off (an opt-in for running searches); new ones
-- follow wsp_settings.default_for_new_vacancies.
alter table public.vacancies add column wsp_enabled boolean not null default false;
alter table public.vacancies alter column wsp_enabled set default public.wsp_default_for_new_vacancies();

-- Candidates and developers (a developer is the ATS candidate of the
-- placement; academy_members.candidate_id links the Academy account).
alter table public.candidates
  add column wsp_mode text not null default 'follow_vacancy' check (wsp_mode in ('follow_vacancy', 'always', 'never')),
  -- Agreed to stay in the talent pool (retention of the profile: 365 days
  -- instead of 28 days after the last application closed). Set by staff.
  add column talent_pool_consent_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Statements
-- ---------------------------------------------------------------------------

create table public.wsp_items (
  id uuid primary key default gen_random_uuid(),
  instrument_version text not null,
  position integer not null check (position between 1 and 200),
  code text not null,
  statement text not null,
  dimension text not null check (dimension in ('E', 'A', 'C', 'S', 'O', 'check')),
  -- normal: score is the answer; reversed: 6 minus the answer. Null for checks.
  key text check (key in ('normal', 'reversed')),
  expected_answer integer check (expected_answer between 1 and 5),
  unique (instrument_version, code),
  unique (instrument_version, position),
  check (((dimension = 'check') = (key is null)) and ((dimension = 'check') = (expected_answer is not null)))
);

-- The 52 statements of nordavo-wsp-v1, in their fixed order (part 2).
insert into public.wsp_items (instrument_version, position, code, statement, dimension, key, expected_answer) values
  ('nordavo-wsp-v1', 1, 'E1', 'I make friends easily.', 'E', 'normal', null),
  ('nordavo-wsp-v1', 2, 'A1', 'I feel little concern for others.', 'A', 'reversed', null),
  ('nordavo-wsp-v1', 3, 'C1', 'I am always prepared.', 'C', 'normal', null),
  ('nordavo-wsp-v1', 4, 'S1', 'I get stressed out easily.', 'S', 'reversed', null),
  ('nordavo-wsp-v1', 5, 'O1', 'I like to solve complex problems.', 'O', 'normal', null),
  ('nordavo-wsp-v1', 6, 'E2', 'I don''t talk a lot.', 'E', 'reversed', null),
  ('nordavo-wsp-v1', 7, 'A2', 'I am interested in people.', 'A', 'normal', null),
  ('nordavo-wsp-v1', 8, 'C2', 'I put little time and effort into my work.', 'C', 'reversed', null),
  ('nordavo-wsp-v1', 9, 'S2', 'I am relaxed most of the time.', 'S', 'normal', null),
  ('nordavo-wsp-v1', 10, 'O2', 'I have difficulty understanding abstract ideas.', 'O', 'reversed', null),
  ('nordavo-wsp-v1', 11, 'E3', 'I feel comfortable around people.', 'E', 'normal', null),
  ('nordavo-wsp-v1', 12, 'A3', 'I insult people.', 'A', 'reversed', null),
  ('nordavo-wsp-v1', 13, 'C3', 'I pay attention to details.', 'C', 'normal', null),
  ('nordavo-wsp-v1', 14, 'S3', 'I worry about things.', 'S', 'reversed', null),
  ('nordavo-wsp-v1', 15, 'O3', 'I have a vivid imagination.', 'O', 'normal', null),
  ('nordavo-wsp-v1', 16, 'E4', 'I keep in the background.', 'E', 'reversed', null),
  ('nordavo-wsp-v1', 17, 'A4', 'I sympathize with others'' feelings.', 'A', 'normal', null),
  ('nordavo-wsp-v1', 18, 'C4', 'I make a mess of things.', 'C', 'reversed', null),
  ('nordavo-wsp-v1', 19, 'S4', 'I remain calm under pressure.', 'S', 'normal', null),
  ('nordavo-wsp-v1', 20, 'O4', 'I am not interested in abstract ideas.', 'O', 'reversed', null),
  ('nordavo-wsp-v1', 21, 'E5', 'I start conversations.', 'E', 'normal', null),
  ('nordavo-wsp-v1', 22, 'A5', 'I am not interested in other people''s problems.', 'A', 'reversed', null),
  ('nordavo-wsp-v1', 23, 'CHK1', 'For this statement, please select "Moderately accurate".', 'check', null, 4),
  ('nordavo-wsp-v1', 24, 'C5', 'I start tasks right away.', 'C', 'normal', null),
  ('nordavo-wsp-v1', 25, 'S5', 'I am easily disturbed.', 'S', 'reversed', null),
  ('nordavo-wsp-v1', 26, 'O5', 'I have excellent ideas.', 'O', 'normal', null),
  ('nordavo-wsp-v1', 27, 'E6', 'I have little to say.', 'E', 'reversed', null),
  ('nordavo-wsp-v1', 28, 'A6', 'I have a soft heart.', 'A', 'normal', null),
  ('nordavo-wsp-v1', 29, 'C6', 'I break my promises.', 'C', 'reversed', null),
  ('nordavo-wsp-v1', 30, 'S6', 'I get upset easily.', 'S', 'reversed', null),
  ('nordavo-wsp-v1', 31, 'O6', 'I do not have a good imagination.', 'O', 'reversed', null),
  ('nordavo-wsp-v1', 32, 'E7', 'I take charge.', 'E', 'normal', null),
  ('nordavo-wsp-v1', 33, 'A7', 'I am not really interested in others.', 'A', 'reversed', null),
  ('nordavo-wsp-v1', 34, 'C7', 'I like order.', 'C', 'normal', null),
  ('nordavo-wsp-v1', 35, 'S7', 'I am not easily annoyed.', 'S', 'normal', null),
  ('nordavo-wsp-v1', 36, 'O7', 'I am quick to understand things.', 'O', 'normal', null),
  ('nordavo-wsp-v1', 37, 'E8', 'I don''t like to draw attention to myself.', 'E', 'reversed', null),
  ('nordavo-wsp-v1', 38, 'A8', 'I take time out for others.', 'A', 'normal', null),
  ('nordavo-wsp-v1', 39, 'C8', 'I shirk my duties.', 'C', 'reversed', null),
  ('nordavo-wsp-v1', 40, 'S8', 'I become overwhelmed by events.', 'S', 'reversed', null),
  ('nordavo-wsp-v1', 41, 'O8', 'I prefer variety to routine.', 'O', 'normal', null),
  ('nordavo-wsp-v1', 42, 'E9', 'I don''t mind being the center of attention.', 'E', 'normal', null),
  ('nordavo-wsp-v1', 43, 'A9', 'I feel others'' emotions.', 'A', 'normal', null),
  ('nordavo-wsp-v1', 44, 'CHK2', 'For this statement, please select "Very inaccurate".', 'check', null, 1),
  ('nordavo-wsp-v1', 45, 'C9', 'I follow a schedule.', 'C', 'normal', null),
  ('nordavo-wsp-v1', 46, 'S9', 'I get irritated easily.', 'S', 'reversed', null),
  ('nordavo-wsp-v1', 47, 'O9', 'I spend time reflecting on things.', 'O', 'normal', null),
  ('nordavo-wsp-v1', 48, 'E10', 'I am quiet around strangers.', 'E', 'reversed', null),
  ('nordavo-wsp-v1', 49, 'A10', 'I make people feel at ease.', 'A', 'normal', null),
  ('nordavo-wsp-v1', 50, 'C10', 'I am exacting in my work.', 'C', 'normal', null),
  ('nordavo-wsp-v1', 51, 'S10', 'I fear for the worst.', 'S', 'reversed', null),
  ('nordavo-wsp-v1', 52, 'O10', 'I am full of ideas.', 'O', 'normal', null);

-- ---------------------------------------------------------------------------
-- 4. Assessments and their data
-- ---------------------------------------------------------------------------

create table public.wsp_assessments (
  id uuid primary key default gen_random_uuid(),
  -- The ATS candidate (also for developers). Null once deleted.
  person_id uuid references public.candidates (id) on delete cascade,
  person_type text not null check (person_type in ('candidate', 'developer')),
  status text not null default 'invited' check (status in ('invited', 'started', 'completed', 'expired', 'deleted')),
  -- The personal link (/working-style/<token>). Null once deleted.
  invite_token text unique check (invite_token ~ '^[0-9a-f]{64}$'),
  -- Null is "system" (automatic invitation).
  invited_by uuid references public.profiles (id) on delete set null,
  invite_reason text not null check (invite_reason in ('trigger_stage', 'manual', 'placement_start')),
  invited_at timestamptz not null default now(),
  -- The link is valid until here (invited_at or the last resend, plus invite_valid_days).
  expires_at timestamptz not null,
  reminder_sent_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  intro_accepted_at timestamptz,
  instrument_version text not null default 'nordavo-wsp-v1',
  -- Retention: when the daily job deletes everything (null: not yet known).
  delete_after timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'deleted') = (person_id is null))
);

-- At most one open assessment per person.
create unique index wsp_assessments_one_open on public.wsp_assessments (person_id) where status in ('invited', 'started');
create index wsp_assessments_person on public.wsp_assessments (person_id, created_at desc);
create index wsp_assessments_delete_after on public.wsp_assessments (delete_after) where status <> 'deleted';

create trigger wsp_assessments_set_updated_at before update on public.wsp_assessments
  for each row execute function public.set_updated_at();

create table public.wsp_assessment_links (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.wsp_assessments (id) on delete cascade,
  vacancy_id uuid references public.vacancies (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  linked_at timestamptz not null default now(),
  -- Null is "system".
  linked_by uuid references public.profiles (id) on delete set null,
  check (vacancy_id is not null or client_id is not null),
  unique nulls not distinct (assessment_id, vacancy_id, client_id)
);

create index wsp_links_client on public.wsp_assessment_links (client_id, assessment_id);
create index wsp_links_vacancy on public.wsp_assessment_links (vacancy_id, assessment_id);

create table public.wsp_answers (
  assessment_id uuid not null references public.wsp_assessments (id) on delete cascade,
  item_id uuid not null references public.wsp_items (id),
  answer smallint not null check (answer between 1 and 5),
  answered_at timestamptz not null default now(),
  page_number smallint not null check (page_number between 1 and 20),
  -- Time on this page so far (all visits together), the same on every answer of the page.
  page_duration_ms integer not null default 0 check (page_duration_ms >= 0),
  primary key (assessment_id, item_id)
);

create table public.wsp_results (
  assessment_id uuid not null references public.wsp_assessments (id) on delete cascade,
  dimension text not null check (dimension in ('E', 'A', 'C', 'S', 'O')),
  mean_score numeric(3, 2) not null check (mean_score between 1 and 5),
  score_0_100 integer not null check (score_0_100 between 0 and 100),
  band text not null check (band in ('lower', 'middle', 'higher')),
  primary key (assessment_id, dimension)
);

create table public.wsp_flags (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.wsp_assessments (id) on delete cascade,
  flag_type text not null check (flag_type in ('attention_check_failed', 'too_fast', 'straightlining', 'yes_saying')),
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (assessment_id, flag_type)
);

create table public.wsp_shares (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.wsp_assessments (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  consented_at timestamptz not null default now(),
  -- Always the person themselves (policy "Person shares own profile").
  consented_by uuid not null references public.profiles (id) on delete cascade,
  consent_text_version text not null default 'nordavo-wsp-consent-v1',
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null
);

create unique index wsp_shares_one_active on public.wsp_shares (assessment_id, client_id) where revoked_at is null;
create index wsp_shares_client on public.wsp_shares (client_id) where revoked_at is null;

create table public.wsp_permission_requests (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.wsp_assessments (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  -- Null is "system" (a developer with a report was placed).
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now()
);

create index wsp_permission_requests_lookup on public.wsp_permission_requests (assessment_id, client_id, requested_at desc);

create table public.wsp_audit_log (
  id bigint generated always as identity primary key,
  assessment_id uuid references public.wsp_assessments (id) on delete set null,
  -- Null is "system" (or the personal link, see actor_role).
  actor uuid,
  -- system, admin, staff, person, person_link (the personal link, signed out), client.
  actor_role text not null check (actor_role in ('system', 'admin', 'staff', 'person', 'person_link', 'client')),
  action text not null check (action in (
    'invited', 'reminded', 'linked', 'viewed', 'shared', 'revoked', 'exported',
    'permission_requested', 'deleted', 'resent', 'settings_changed'
  )),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index wsp_audit_log_assessment on public.wsp_audit_log (assessment_id, created_at desc);
create index wsp_audit_log_created on public.wsp_audit_log (created_at desc);

-- Mail to send (invitation, reminder, permission request, withdrawn,
-- completed). Written by the database, sent by the app (service role):
-- right after the action and every hour by the job wsp-mail. The payload is
-- emptied once handled.
create table public.wsp_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('invite', 'reminder', 'permission_request', 'withdrawn', 'completed')),
  assessment_id uuid references public.wsp_assessments (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create index wsp_outbox_pending on public.wsp_outbox (created_at) where status in ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- 5. Who is who
-- ---------------------------------------------------------------------------

-- Nordavo staff for this feature: recruitment (candidates) or Academy
-- managers (developers); admins have both.
create or replace function public.wsp_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_module('recruitment') or public.has_module('academy');
$$;

-- The ATS candidate of the signed-in account (candidates and developers in the Academy).
create or replace function public.wsp_my_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.candidate_id from public.academy_members m where m.profile_id = (select auth.uid());
$$;

-- Is this assessment of the signed-in person?
create or replace function public.wsp_is_person(p_assessment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wsp_assessments a
    where a.id = p_assessment and a.person_id is not null and a.person_id = public.wsp_my_person_id()
  );
$$;

-- May the signed-in client user see this report: a completed assessment
-- with an active share for their own client, and the feature on. Client
-- users without the portal (Academy client_member, client_reader) have no
-- current_client_id() and never see one.
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
        and s.revoked_at is null
        and a.status = 'completed'
    );
$$;

-- Is the client linked to the assessment (directly or through a vacancy)?
create or replace function public.wsp_is_linked_client(p_assessment uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wsp_assessment_links l
    where l.assessment_id = p_assessment and l.client_id = p_client
  );
$$;

revoke execute on function public.wsp_is_staff(), public.wsp_my_person_id(), public.wsp_is_person(uuid),
  public.wsp_client_has_share(uuid), public.wsp_is_linked_client(uuid, uuid) from public, anon;
grant execute on function public.wsp_is_staff(), public.wsp_my_person_id(), public.wsp_is_person(uuid),
  public.wsp_client_has_share(uuid), public.wsp_is_linked_client(uuid, uuid) to authenticated, service_role;

-- The role of whoever acts, for the audit log.
create or replace function wsp_private.actor_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then 'system'
    when public.is_admin() then 'admin'
    when public.wsp_is_staff() then 'staff'
    when public.current_client_id() is not null then 'client'
    else 'person'
  end;
$$;

create or replace function wsp_private.audit(p_assessment uuid, p_action text, p_details jsonb default '{}', p_role text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.wsp_audit_log (assessment_id, actor, actor_role, action, details)
  values (
    p_assessment,
    case when coalesce(p_role, '') in ('system', 'person_link') then null else (select auth.uid()) end,
    coalesce(p_role, wsp_private.actor_role()),
    p_action,
    coalesce(p_details, '{}')
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------

alter table public.wsp_settings enable row level security;
alter table public.wsp_items enable row level security;
alter table public.wsp_assessments enable row level security;
alter table public.wsp_assessment_links enable row level security;
alter table public.wsp_answers enable row level security;
alter table public.wsp_results enable row level security;
alter table public.wsp_flags enable row level security;
alter table public.wsp_shares enable row level security;
alter table public.wsp_permission_requests enable row level security;
alter table public.wsp_audit_log enable row level security;
alter table public.wsp_outbox enable row level security;

-- Nobody signed out reads or writes a table; the personal link goes through
-- the security definer functions of the next migration.
revoke all on public.wsp_settings, public.wsp_items, public.wsp_assessments, public.wsp_assessment_links,
  public.wsp_answers, public.wsp_results, public.wsp_flags, public.wsp_shares, public.wsp_permission_requests,
  public.wsp_audit_log, public.wsp_outbox from anon;
-- Signed in: reading follows the policies below; the only direct writes are
-- shares (made and withdrawn by the person). Everything else goes through functions.
revoke insert, update, delete, truncate on public.wsp_settings, public.wsp_items, public.wsp_assessments,
  public.wsp_assessment_links, public.wsp_answers, public.wsp_results, public.wsp_flags,
  public.wsp_permission_requests, public.wsp_audit_log from authenticated;
revoke delete, truncate on public.wsp_shares from authenticated;
revoke all on public.wsp_outbox from authenticated;

create policy "Staff read wsp settings" on public.wsp_settings
  for select to authenticated using (public.wsp_is_staff());

-- Staff and people with an Academy account linked to a candidate (the
-- personal link reads them through wsp_questionnaire). Not Work guests.
create policy "Staff and persons read statements" on public.wsp_items
  for select to authenticated using (public.wsp_is_staff() or public.wsp_my_person_id() is not null);

create policy "Staff and the person read assessments" on public.wsp_assessments
  for select to authenticated
  using (public.wsp_is_staff() or (person_id is not null and person_id = public.wsp_my_person_id()));

create policy "Staff and the person read links" on public.wsp_assessment_links
  for select to authenticated
  using (public.wsp_is_staff() or public.wsp_is_person(assessment_id));

create policy "Staff and the person read answers" on public.wsp_answers
  for select to authenticated
  using (public.wsp_is_staff() or public.wsp_is_person(assessment_id));

-- Clients: only with an active share (no answers, no flags, no assessment row).
create policy "Staff, the person and shared clients read results" on public.wsp_results
  for select to authenticated
  using (public.wsp_is_staff() or public.wsp_is_person(assessment_id) or public.wsp_client_has_share(assessment_id));

create policy "Staff read flags" on public.wsp_flags
  for select to authenticated using (public.wsp_is_staff());

create policy "Staff and the person read shares" on public.wsp_shares
  for select to authenticated
  using (public.wsp_is_staff() or consented_by = (select auth.uid()) or public.wsp_is_person(assessment_id));

-- Only the person, from their own account, for a completed assessment and a
-- client it is linked to. Staff cannot (consented_by would be the staff
-- member, who is not the person), and neither can anyone else through the API.
create policy "Person shares own profile" on public.wsp_shares
  for insert to authenticated
  with check (
    consented_by = (select auth.uid())
    and revoked_at is null
    and revoked_by is null
    and public.wsp_enabled()
    and public.wsp_is_person(assessment_id)
    and public.wsp_is_linked_client(assessment_id, client_id)
    and exists (select 1 from public.wsp_assessments a where a.id = assessment_id and a.status = 'completed')
  );

-- Withdrawing: the person sets revoked_by to themselves (the trigger sets the time and checks the rest).
create policy "Person withdraws own share" on public.wsp_shares
  for update to authenticated
  using (public.wsp_is_person(assessment_id) and revoked_at is null)
  with check (public.wsp_is_person(assessment_id) and revoked_by = (select auth.uid()));

create policy "Staff read permission requests" on public.wsp_permission_requests
  for select to authenticated using (public.wsp_is_staff());

create policy "Staff read the wsp audit log" on public.wsp_audit_log
  for select to authenticated using (public.wsp_is_staff());

-- ---------------------------------------------------------------------------
-- 7. Scoring (part 2), the same rules as src/lib/wsp/scoring.ts
-- ---------------------------------------------------------------------------

-- Score = afgerond((gemiddelde min 1) / 4 x 100); halves round up.
create or replace function wsp_private.score_from_mean(p_mean numeric)
returns integer
language sql
immutable
set search_path = ''
as $$
  select floor((p_mean - 1) * 25 + 0.5)::integer;
$$;

-- 0 to 34 lower, 35 to 65 middle, 66 to 100 higher.
create or replace function wsp_private.band(p_score integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_score <= 34 then 'lower' when p_score <= 65 then 'middle' else 'higher' end;
$$;

-- Per dimension: item score (answer, or 6 minus the answer when reversed),
-- the mean of the 10 item scores, the score and the band. Checks do not count.
create or replace function wsp_private.score_assessment(p_assessment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.wsp_results where assessment_id = p_assessment;
  insert into public.wsp_results (assessment_id, dimension, mean_score, score_0_100, band)
  select p_assessment, s.dimension, round(s.mean, 2), wsp_private.score_from_mean(s.mean),
         wsp_private.band(wsp_private.score_from_mean(s.mean))
  from (
    select i.dimension, avg(case when i.key = 'reversed' then 6 - x.answer else x.answer end)::numeric as mean
    from public.wsp_answers x
    join public.wsp_items i on i.id = x.item_id
    where x.assessment_id = p_assessment and i.dimension <> 'check'
    group by i.dimension
  ) s;
end;
$$;

-- Quality flags (staff only). The report is always made.
create or replace function wsp_private.compute_flags(p_assessment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text;
  v_failed jsonb;
  v_seconds numeric;
  v_run integer;
  v_run_answer integer;
  v_mean numeric;
begin
  select instrument_version into v_version from public.wsp_assessments where id = p_assessment;
  delete from public.wsp_flags where assessment_id = p_assessment;

  -- attention_check_failed: CHK1 is not 4, or CHK2 is not 1.
  select jsonb_object_agg(i.code, x.answer) into v_failed
  from public.wsp_items i
  left join public.wsp_answers x on x.item_id = i.id and x.assessment_id = p_assessment
  where i.instrument_version = v_version and i.dimension = 'check'
    and x.answer is distinct from i.expected_answer;
  if v_failed is not null then
    insert into public.wsp_flags (assessment_id, flag_type, details) values (p_assessment, 'attention_check_failed', v_failed);
  end if;

  -- too_fast: on average under 2 seconds per statement (time per page
  -- divided by the statements on that page; pages over 10 minutes do not count).
  select round(avg(p.ms / 1000.0 / p.items), 2) into v_seconds
  from (
    select ceil(i.position / 10.0)::integer as page, count(*) as items,
           max(x.page_duration_ms) as ms
    from public.wsp_items i
    left join public.wsp_answers x on x.item_id = i.id and x.assessment_id = p_assessment
    where i.instrument_version = v_version
    group by 1
  ) p
  where p.ms is not null and p.ms <= 600000;
  if v_seconds is not null and v_seconds < 2 then
    insert into public.wsp_flags (assessment_id, flag_type, details)
    values (p_assessment, 'too_fast', jsonb_build_object('seconds_per_statement', v_seconds));
  end if;

  -- straightlining: 12 or more times in a row the same answer (all 52, in order).
  select r.len, r.answer into v_run, v_run_answer
  from (
    select g.answer, count(*) as len
    from (
      select x.answer, i.position - row_number() over (partition by x.answer order by i.position) as grp
      from public.wsp_answers x
      join public.wsp_items i on i.id = x.item_id
      where x.assessment_id = p_assessment
    ) g
    group by g.answer, g.grp
  ) r
  order by r.len desc
  limit 1;
  if v_run >= 12 then
    insert into public.wsp_flags (assessment_id, flag_type, details)
    values (p_assessment, 'straightlining', jsonb_build_object('run', v_run, 'answer', v_run_answer));
  end if;

  -- yes_saying: the mean raw answer over the 50 statements is 4.2 or higher.
  select round(avg(x.answer), 2) into v_mean
  from public.wsp_answers x
  join public.wsp_items i on i.id = x.item_id
  where x.assessment_id = p_assessment and i.dimension <> 'check';
  if v_mean >= 4.2 then
    insert into public.wsp_flags (assessment_id, flag_type, details)
    values (p_assessment, 'yes_saying', jsonb_build_object('mean_answer', v_mean));
  end if;
end;
$$;

revoke all on all functions in schema wsp_private from public, anon, authenticated;

comment on table public.wsp_assessments is 'Working Style Profile: one questionnaire of one person (docs/working-style-profile.md). Never shown in lists, boards, search or the talent pool.';
comment on table public.wsp_results is 'Working Style Profile scores per dimension. Only in the report, the PDF and the staff view of the assessment.';
