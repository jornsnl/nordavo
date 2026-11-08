-- Recruitment forms (recruitment brief of 2026-11-08, sections 2.8, 2.9,
-- 2.6.4 and the form examples in section 3). Builds on the foundation
-- migration (form_sent_at, form_completed_at, form_reminded_at, origin,
-- source, attachment kinds).
--
-- 1. Candidate fields the form asks for (current company, notice period, relocate).
-- 2. One application form per vacancy: blocks and questions as jsonb, a
--    draft that staff edit and immutable published versions.
-- 3. Links: a general link and a headhunted link per form, and a personal
--    link per application (form_invites), with sending and reminders.
-- 4. Responses: answers keyed by question id plus the form version.
-- 5. Compensation per application: asked (from the form) and negotiated
--    (by staff), payslip requested. Staff only, never visible to clients.
-- 6. Exchange rate INR per EUR, admin editable, with its date.
-- 7. Public submission: one service role function that matches or creates
--    the candidate and the application, stores the answers and advances
--    the stage. A simple rate limit per IP lives next to it.
-- 8. Fix: clients could open payslips through the storage policy.
--
-- Clients never read anything defined here: every table is staff only, the
-- public form is served by the server with the service role key.

-- ---------------------------------------------------------------------------
-- 1. Candidate fields
-- ---------------------------------------------------------------------------

alter table public.candidates
  add column current_company text check (char_length(current_company) <= 200),
  add column notice_period text check (char_length(notice_period) <= 200),
  add column willing_to_relocate boolean;

-- ---------------------------------------------------------------------------
-- 2. Forms and published versions
-- ---------------------------------------------------------------------------

-- 64 hex characters from two random uuids: unguessable link tokens.
create or replace function public.forms_new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

create table public.recruitment_forms (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null unique references public.vacancies (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  -- Limited markdown: paragraphs, bold, italic and http(s) links.
  intro text check (char_length(intro) <= 5000),
  role_type text not null default 'fulltime' check (role_type in ('fulltime', 'freelance')),
  -- published: the latest version is live; draft: the link shows "closed".
  status text not null default 'draft' check (status in ('draft', 'published')),
  -- The draft: [{ id, title, description, questions: [...] }], see src/lib/forms/schema.ts.
  blocks jsonb not null default '[]' check (jsonb_typeof(blocks) = 'array'),
  header_image_path text check (char_length(header_image_path) <= 500),
  logo_path text check (char_length(logo_path) <= 500),
  -- Latest published version (0 = never published).
  version integer not null default 0,
  published_at timestamptz,
  public_token text not null unique default public.forms_new_token(),
  headhunted_token text not null unique default public.forms_new_token(),
  -- Reminders: at most max_reminders after the deadline, reminder_interval_days apart.
  max_reminders integer not null default 1 check (max_reminders between 0 and 5),
  reminder_interval_days integer not null default 3 check (reminder_interval_days between 1 and 60),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger recruitment_forms_set_updated_at before update on public.recruitment_forms
  for each row execute function public.set_updated_at();

create table public.recruitment_form_versions (
  form_id uuid not null references public.recruitment_forms (id) on delete cascade,
  version integer not null check (version > 0),
  title text not null,
  intro text,
  role_type text not null check (role_type in ('fulltime', 'freelance')),
  blocks jsonb not null check (jsonb_typeof(blocks) = 'array'),
  header_image_path text,
  logo_path text,
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  primary key (form_id, version)
);

alter table public.recruitment_forms enable row level security;
alter table public.recruitment_form_versions enable row level security;

create policy "Staff manage forms" on public.recruitment_forms
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- Versions are immutable: read here, written by publish_recruitment_form().
create policy "Staff read form versions" on public.recruitment_form_versions
  for select to authenticated using (public.is_staff());

-- Publish the current draft as a new version and open the form.
create or replace function public.publish_recruitment_form(p_form_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.recruitment_forms;
  v_version integer;
begin
  if not public.is_staff() then
    raise exception 'Only the Nordavo team can publish forms';
  end if;
  select * into v_form from public.recruitment_forms where id = p_form_id for update;
  if v_form.id is null then
    raise exception 'Form not found';
  end if;
  if jsonb_array_length(v_form.blocks) = 0 then
    raise exception 'Add at least one question before publishing';
  end if;

  v_version := v_form.version + 1;
  insert into public.recruitment_form_versions
    (form_id, version, title, intro, role_type, blocks, header_image_path, logo_path, published_by)
  values
    (v_form.id, v_version, v_form.title, v_form.intro, v_form.role_type, v_form.blocks,
     v_form.header_image_path, v_form.logo_path, (select auth.uid()));

  update public.recruitment_forms
  set version = v_version, status = 'published', published_at = now(), updated_by = (select auth.uid())
  where id = v_form.id;
  return v_version;
end;
$$;

revoke execute on function public.publish_recruitment_form(uuid) from public, anon;
grant execute on function public.publish_recruitment_form(uuid) to authenticated;
revoke execute on function public.forms_new_token() from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Personal links (one per application)
-- ---------------------------------------------------------------------------

create table public.form_invites (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.recruitment_forms (id) on delete cascade,
  application_id uuid not null unique references public.applications (id) on delete cascade,
  token text not null unique default public.forms_new_token(),
  sent_at timestamptz,
  sent_to text check (char_length(sent_to) <= 320),
  cc text check (char_length(cc) <= 1000),
  -- Reminders start after this date when the form is still not filled in.
  deadline date,
  reminded_at timestamptz,
  reminder_count integer not null default 0 check (reminder_count >= 0),
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index on public.form_invites (form_id);
create index on public.form_invites (deadline) where completed_at is null;

alter table public.form_invites enable row level security;
create policy "Staff manage form invites" on public.form_invites
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 4. Responses
-- ---------------------------------------------------------------------------

create table public.form_responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.recruitment_forms (id) on delete cascade,
  form_version integer not null,
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  -- One response per application; filling in again replaces the answers.
  application_id uuid not null unique references public.applications (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  -- { "<question id>": value }, value as typed (text, number, boolean, list, file).
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  via text not null check (via in ('general', 'headhunted', 'personal')),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (form_id, form_version) references public.recruitment_form_versions (form_id, version)
);

create index on public.form_responses (vacancy_id, submitted_at desc);
create index on public.form_responses (candidate_id);

alter table public.form_responses enable row level security;
create policy "Staff read form responses" on public.form_responses
  for select to authenticated using (public.is_staff());
create policy "Staff delete form responses" on public.form_responses
  for delete to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
-- 5. Compensation (staff only)
-- ---------------------------------------------------------------------------
--
-- Fulltime: CTC per year in INR, current and expected (asked, from the form)
-- and negotiated (staff). Freelance: hourly rate in INR, asked and negotiated.
-- The rate used for a negotiated amount is kept with it, so the EUR value of
-- an agreed salary does not move with the exchange rate.

create table public.application_compensation (
  application_id uuid primary key references public.applications (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  role_type text not null default 'fulltime' check (role_type in ('fulltime', 'freelance')),
  current_ctc_inr_year numeric(14, 2) check (current_ctc_inr_year >= 0),
  expected_ctc_inr_year numeric(14, 2) check (expected_ctc_inr_year >= 0),
  asked_hourly_inr numeric(12, 2) check (asked_hourly_inr >= 0),
  negotiated_ctc_inr_year numeric(14, 2) check (negotiated_ctc_inr_year >= 0),
  negotiated_hourly_inr numeric(12, 2) check (negotiated_hourly_inr >= 0),
  negotiated_inr_per_eur numeric(10, 4) check (negotiated_inr_per_eur > 0),
  negotiated_rate_date date,
  negotiated_at timestamptz,
  negotiated_by uuid references public.profiles (id) on delete set null,
  payslip_requested_at date,
  notes text check (char_length(notes) <= 2000),
  updated_at timestamptz not null default now()
);

create index on public.application_compensation (candidate_id);

create trigger application_compensation_set_updated_at before update on public.application_compensation
  for each row execute function public.set_updated_at();

-- candidate_id and vacancy_id always follow the application.
create or replace function public.application_compensation_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select a.candidate_id, a.vacancy_id into new.candidate_id, new.vacancy_id
  from public.applications a where a.id = new.application_id;
  return new;
end;
$$;

create trigger application_compensation_fill before insert or update of application_id on public.application_compensation
  for each row execute function public.application_compensation_fill();

alter table public.application_compensation enable row level security;
create policy "Staff manage compensation" on public.application_compensation
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 6. Exchange rate
-- ---------------------------------------------------------------------------

-- History of INR per EUR rates; the newest row (by rate_date, then id) is current.
create table public.exchange_rates (
  id bigint generated always as identity primary key,
  inr_per_eur numeric(10, 4) not null check (inr_per_eur > 0 and inr_per_eur < 10000),
  rate_date date not null,
  note text check (char_length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index on public.exchange_rates (rate_date desc, id desc);

alter table public.exchange_rates enable row level security;
create policy "Staff read exchange rates" on public.exchange_rates
  for select to authenticated using (public.is_staff());
create policy "Admins add exchange rates" on public.exchange_rates
  for insert to authenticated with check (public.is_admin());
create policy "Admins remove exchange rates" on public.exchange_rates
  for delete to authenticated using (public.is_admin());

-- Snapshot the current rate on the row when a negotiated amount changes.
create or replace function public.application_compensation_snapshot_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
  v_date date;
begin
  if tg_op = 'UPDATE'
     and new.negotiated_ctc_inr_year is not distinct from old.negotiated_ctc_inr_year
     and new.negotiated_hourly_inr is not distinct from old.negotiated_hourly_inr then
    return new;
  end if;
  if new.negotiated_ctc_inr_year is null and new.negotiated_hourly_inr is null then
    new.negotiated_inr_per_eur := null;
    new.negotiated_rate_date := null;
    new.negotiated_at := null;
    new.negotiated_by := null;
    return new;
  end if;
  select inr_per_eur, rate_date into v_rate, v_date
  from public.exchange_rates order by rate_date desc, id desc limit 1;
  new.negotiated_inr_per_eur := v_rate;
  new.negotiated_rate_date := v_date;
  new.negotiated_at := now();
  new.negotiated_by := (select auth.uid());
  return new;
end;
$$;

create trigger application_compensation_snapshot_rate before insert or update on public.application_compensation
  for each row execute function public.application_compensation_snapshot_rate();

-- ---------------------------------------------------------------------------
-- 7. Public submission
-- ---------------------------------------------------------------------------

-- Successful submissions per hashed IP, for the rate limit. Service role only.
create table public.form_submission_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null check (char_length(ip_hash) <= 128),
  form_id uuid,
  created_at timestamptz not null default now()
);

create index on public.form_submission_attempts (ip_hash, created_at desc);
alter table public.form_submission_attempts enable row level security;
-- No policies: only the service role (which bypasses RLS) reads and writes.

-- Digits of a phone number, last ten (the Indian mobile number without +91).
create or replace function public.forms_phone_key(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
      then right(regexp_replace(p_phone, '\D', '', 'g'), 10)
  end;
$$;

-- Moves one application to p_stage at the bottom of that column. Used for
-- automatic moves outside a staff session (the public form): the service
-- role has no user, so move_applications() (staff only) cannot be used
-- there. The same stage triggers keep history and candidate status.
create or replace function public.forms_advance_application(p_application_id uuid, p_from text[], p_to text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy uuid;
  v_base double precision;
begin
  select vacancy_id into v_vacancy from public.applications
  where id = p_application_id and stage = any (p_from);
  if v_vacancy is null then
    return false;
  end if;
  select coalesce(max(position), 0) into v_base
  from public.applications where vacancy_id = v_vacancy and stage = p_to;
  update public.applications set stage = p_to, position = v_base + 1024
  where id = p_application_id and stage = any (p_from);
  return found;
end;
$$;

-- The whole submission in one transaction. Called by the server with the
-- service role after strict validation (src/lib/forms/answers.ts):
--
--   p_token    the token from the link (general, headhunted or personal)
--   p_payload  { form_version, answers, candidate: {...}, compensation: {...},
--                source, ip_hash }
--
-- Personal link: the application of the invite, the candidate's details are
-- updated with what they filled in. General and headhunted link: the
-- candidate is matched by email, else by phone, else created; existing
-- details are only filled in where empty (anyone can type an email address).
-- Returns { candidate_id, application_id, response_id, via, created }.
create or replace function public.submit_recruitment_form(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.recruitment_forms;
  v_invite public.form_invites;
  v_via text;
  v_version integer := (p_payload ->> 'form_version')::integer;
  v_cand jsonb := coalesce(p_payload -> 'candidate', '{}');
  v_comp jsonb := coalesce(p_payload -> 'compensation', '{}');
  v_email text := nullif(lower(trim(v_cand ->> 'email')), '');
  v_phone text := nullif(trim(v_cand ->> 'phone'), '');
  v_ip text := coalesce(nullif(p_payload ->> 'ip_hash', ''), 'unknown');
  v_source text := nullif(p_payload ->> 'source', '');
  v_candidate uuid;
  v_application uuid;
  v_response uuid;
  v_created boolean := false;
  v_base double precision;
  v_origin text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'form_not_found';
  end if;

  -- Resolve the link.
  select * into v_invite from public.form_invites where token = p_token;
  if v_invite.id is not null then
    v_via := 'personal';
    select * into v_form from public.recruitment_forms where id = v_invite.form_id;
  else
    select * into v_form from public.recruitment_forms where public_token = p_token or headhunted_token = p_token;
    v_via := case when v_form.headhunted_token = p_token then 'headhunted' else 'general' end;
  end if;
  if v_form.id is null then
    raise exception 'form_not_found';
  end if;
  if v_form.status <> 'published' or v_form.version = 0 then
    raise exception 'form_closed';
  end if;
  if v_version is null or not exists (
    select 1 from public.recruitment_form_versions where form_id = v_form.id and version = v_version
  ) then
    raise exception 'form_changed';
  end if;

  -- Rate limit: five submissions per IP per ten minutes.
  delete from public.form_submission_attempts where created_at < now() - interval '1 day';
  if (select count(*) from public.form_submission_attempts
      where ip_hash = v_ip and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'rate_limited';
  end if;
  insert into public.form_submission_attempts (ip_hash, form_id) values (v_ip, v_form.id);

  if v_source is not null and v_source not in (
    'linkedin', 'naukri', 'manatal', 'indeed', 'monster', 'instagram', 'referral', 'website', 'headhunted', 'other'
  ) then
    v_source := null;
  end if;
  if v_via = 'headhunted' then
    v_source := 'headhunted';
  end if;
  v_origin := case when v_via = 'headhunted' then 'headhunted' else 'applied' end;

  if v_via = 'personal' then
    select a.id, a.candidate_id into v_application, v_candidate
    from public.applications a where a.id = v_invite.application_id;
    if v_application is null then
      raise exception 'form_not_found';
    end if;
    -- The invited candidate: what they fill in now is the latest.
    update public.candidates c set
      full_name = coalesce(nullif(trim(v_cand ->> 'full_name'), ''), c.full_name),
      email = coalesce(v_email, c.email),
      phone = coalesce(v_phone, c.phone),
      linkedin_url = coalesce(nullif(v_cand ->> 'linkedin_url', ''), c.linkedin_url),
      video_url = coalesce(nullif(v_cand ->> 'video_url', ''), c.video_url),
      current_company = coalesce(nullif(v_cand ->> 'current_company', ''), c.current_company),
      years_experience = coalesce((v_cand ->> 'years_experience')::integer, c.years_experience),
      notice_period = coalesce(nullif(v_cand ->> 'notice_period', ''), c.notice_period),
      willing_to_relocate = coalesce((v_cand ->> 'willing_to_relocate')::boolean, c.willing_to_relocate),
      location = coalesce(nullif(trim(v_cand ->> 'location'), ''), c.location)
    where c.id = v_candidate;
  else
    if v_email is not null then
      select id into v_candidate from public.candidates
      where lower(email) = v_email order by created_at limit 1;
    end if;
    if v_candidate is null and public.forms_phone_key(v_phone) is not null then
      select id into v_candidate from public.candidates
      where public.forms_phone_key(phone) = public.forms_phone_key(v_phone) order by created_at limit 1;
    end if;

    if v_candidate is null then
      insert into public.candidates (
        full_name, email, phone, linkedin_url, video_url, current_company, years_experience,
        notice_period, willing_to_relocate, location, source, origin
      ) values (
        coalesce(nullif(trim(v_cand ->> 'full_name'), ''), v_email, 'Applicant'),
        v_email, v_phone,
        nullif(v_cand ->> 'linkedin_url', ''), nullif(v_cand ->> 'video_url', ''),
        nullif(v_cand ->> 'current_company', ''), (v_cand ->> 'years_experience')::integer,
        nullif(v_cand ->> 'notice_period', ''), (v_cand ->> 'willing_to_relocate')::boolean,
        coalesce(nullif(trim(v_cand ->> 'location'), ''), 'Bangalore'),
        v_source, v_origin
      ) returning id into v_candidate;
      v_created := true;
    else
      -- Somebody we know: only fill what is empty.
      update public.candidates c set
        email = coalesce(c.email, v_email),
        phone = coalesce(c.phone, v_phone),
        linkedin_url = coalesce(c.linkedin_url, nullif(v_cand ->> 'linkedin_url', '')),
        video_url = coalesce(c.video_url, nullif(v_cand ->> 'video_url', '')),
        current_company = coalesce(c.current_company, nullif(v_cand ->> 'current_company', '')),
        years_experience = coalesce(c.years_experience, (v_cand ->> 'years_experience')::integer),
        notice_period = coalesce(c.notice_period, nullif(v_cand ->> 'notice_period', '')),
        willing_to_relocate = coalesce(c.willing_to_relocate, (v_cand ->> 'willing_to_relocate')::boolean),
        source = coalesce(c.source, v_source)
      where c.id = v_candidate;
    end if;

    select id into v_application from public.applications
    where vacancy_id = v_form.vacancy_id and candidate_id = v_candidate;
    if v_application is null then
      -- New applicants start in Sourced, so the techstack check still happens.
      select coalesce(max(position), 0) into v_base
      from public.applications where vacancy_id = v_form.vacancy_id and stage = 'sourced';
      insert into public.applications (vacancy_id, candidate_id, stage, position, source, origin)
      values (v_form.vacancy_id, v_candidate, 'sourced', v_base + 1024, v_source, v_origin)
      returning id into v_application;
    else
      update public.applications set
        source = case when v_via = 'headhunted' then 'headhunted' else coalesce(source, v_source) end,
        origin = case when v_via = 'headhunted' then 'headhunted' else origin end
      where id = v_application;
    end if;
  end if;

  insert into public.form_responses (form_id, form_version, vacancy_id, application_id, candidate_id, answers, via)
  values (v_form.id, v_version, v_form.vacancy_id, v_application, v_candidate,
          coalesce(p_payload -> 'answers', '{}'), v_via)
  on conflict (application_id) do update set
    form_id = excluded.form_id, form_version = excluded.form_version, candidate_id = excluded.candidate_id,
    answers = excluded.answers, via = excluded.via, submitted_at = now()
  returning id into v_response;

  -- Asked compensation comes from the form; negotiated amounts stay untouched.
  insert into public.application_compensation (
    application_id, candidate_id, vacancy_id, role_type, current_ctc_inr_year, expected_ctc_inr_year, asked_hourly_inr
  ) values (
    v_application, v_candidate, v_form.vacancy_id, v_form.role_type,
    (v_comp ->> 'current_ctc_inr_year')::numeric, (v_comp ->> 'expected_ctc_inr_year')::numeric,
    (v_comp ->> 'asked_hourly_inr')::numeric
  )
  on conflict (application_id) do update set
    role_type = excluded.role_type,
    current_ctc_inr_year = coalesce(excluded.current_ctc_inr_year, public.application_compensation.current_ctc_inr_year),
    expected_ctc_inr_year = coalesce(excluded.expected_ctc_inr_year, public.application_compensation.expected_ctc_inr_year),
    asked_hourly_inr = coalesce(excluded.asked_hourly_inr, public.application_compensation.asked_hourly_inr);

  update public.applications set form_completed_at = now() where id = v_application;
  update public.form_invites set completed_at = now() where application_id = v_application;

  -- Auto advance: a completed form moves Fill out to Video review.
  perform public.forms_advance_application(v_application, array['fill_out'], 'video_review');

  return jsonb_build_object(
    'candidate_id', v_candidate,
    'application_id', v_application,
    'response_id', v_response,
    'via', v_via,
    'created', v_created
  );
end;
$$;

-- Records an uploaded CV (already in storage under candidate/<id>/) on the
-- candidate and in the response. The newest CV becomes the main one unless
-- the candidate already had one and came in through a general link.
create or replace function public.attach_form_cv(
  p_response_id uuid,
  p_question_id text,
  p_path text,
  p_file_name text,
  p_mime_type text,
  p_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response public.form_responses;
  v_attachment uuid;
begin
  select * into v_response from public.form_responses where id = p_response_id;
  if v_response.id is null then
    raise exception 'response_not_found';
  end if;
  if p_path is null or p_path not like 'candidate/' || v_response.candidate_id || '/%' or p_path like '%..%' then
    raise exception 'invalid_path';
  end if;

  insert into public.attachments (entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, kind)
  values ('candidate', v_response.candidate_id, p_path, left(p_file_name, 255), left(p_mime_type, 200), p_size, 'cv')
  returning id into v_attachment;

  update public.candidates
  set cv_path = case when cv_path is null or v_response.via = 'personal' then p_path else cv_path end
  where id = v_response.candidate_id;

  update public.form_responses
  set answers = answers || jsonb_build_object(p_question_id, jsonb_build_object(
    'attachment_id', v_attachment, 'file_name', left(p_file_name, 255), 'size', p_size))
  where id = p_response_id;

  return v_attachment;
end;
$$;

revoke execute on function public.submit_recruitment_form(text, jsonb) from public, anon, authenticated;
revoke execute on function public.attach_form_cv(uuid, text, text, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.forms_advance_application(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.submit_recruitment_form(text, jsonb) to service_role;
grant execute on function public.attach_form_cv(uuid, text, text, text, text, bigint) to service_role;
grant execute on function public.forms_advance_application(uuid, text[], text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Payslips stay out of the client portal
-- ---------------------------------------------------------------------------
--
-- The client storage policy of the foundation looked up the attachment kind
-- in public.attachments, but clients cannot read that table (RLS), so the
-- "not a CV" check never matched and a payslip of a presented candidate could
-- be opened. The kind is now read by a security definer helper. Files without
-- an attachments row are CVs uploaded on the candidate form (cv_path).

create or replace function public.storage_attachment_kind(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select kind from public.attachments where storage_path = p_name limit 1;
$$;

revoke execute on function public.storage_attachment_kind(text) from public, anon;
grant execute on function public.storage_attachment_kind(text) to authenticated;

drop policy "Clients read presented candidate files" on storage.objects;
create policy "Clients read presented candidate files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'candidate'
    and coalesce(public.storage_attachment_kind(name), 'cv') = 'cv'
    and exists (
      select 1
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
      where a.candidate_id::text = (storage.foldername(name))[2]
        and public.is_presented_stage(a.stage)
        and v.client_id = public.current_client_id()
        and not v.is_talent_pool
    )
  );

comment on table public.recruitment_forms is 'Application form per vacancy. blocks is the draft; recruitment_form_versions holds what was published.';
comment on table public.form_responses is 'Answers per application, keyed by question id, with the form version they were given on.';
comment on table public.application_compensation is 'Asked and negotiated CTC or hourly rate in INR. Staff only, never shown to clients.';
comment on table public.exchange_rates is 'INR per EUR; the newest row by rate_date is used. Negotiated amounts keep the rate they were saved with.';
