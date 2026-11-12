-- Recruitment, feedback Julius round 3 (vacancies, candidates, clients).
--
-- 1. Seniority: one list for vacancies and candidates (intern, fresher,
--    junior, medior, senior, lead, manager, senior_manager, freelance).
-- 2. Notice period as a choice (immediate, 15, 30, 45, 60, 90_plus):
--    normalize_notice_period() maps free text, a trigger keeps new values
--    in that shape (forms, imports, MCP) and existing text is migrated.
--    Text that cannot be read stays as it was.
-- 3. Vacancies: deadline to present the top 3 to 5 candidates
--    (presentation_deadline) and the desired start time in India
--    (start_time_ist; the portal shows the Dutch time for summer and winter).
-- 4. On hold with a required reason and a start date, kept per period in
--    vacancy_holds. The clock (days open, lead time) skips these periods.
-- 5. Candidates: current and expected CTC (INR per year) on the candidate.
-- 6. Attachments: kind job_description (the client's vacancy file), and a
--    larger bucket limit so a video intro copy fits.
-- 7. Duplicate check on name for imports and the new candidate form.
-- 8. Custom fields: the vacancy fields notice_period and linkedin_profile
--    were candidate data; they are removed with their values.

-- ---------------------------------------------------------------------------
-- 1. Seniority
-- ---------------------------------------------------------------------------

alter table public.vacancies drop constraint if exists vacancies_seniority_check;
alter table public.vacancies
  add constraint vacancies_seniority_check check (seniority in (
    'intern', 'fresher', 'junior', 'medior', 'senior', 'lead', 'manager', 'senior_manager', 'freelance'
  ));

alter table public.candidates drop constraint if exists candidates_seniority_check;
alter table public.candidates
  add constraint candidates_seniority_check check (seniority in (
    'intern', 'fresher', 'junior', 'medior', 'senior', 'lead', 'manager', 'senior_manager', 'freelance'
  ));

-- ---------------------------------------------------------------------------
-- 2. Notice period
-- ---------------------------------------------------------------------------

-- Same rules as parseNoticePeriod() in src/lib/recruitment/candidate-fields.ts.
create or replace function public.normalize_notice_period(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_text, '')));
  v_number text;
  v_days numeric;
begin
  if v = '' then
    return null;
  end if;
  if v in ('immediate', '15', '30', '45', '60', '90_plus') then
    return v;
  end if;
  if v ~ '(immediate|asap|right away|no notice|available now)' then
    return 'immediate';
  end if;
  v_number := substring(v from '(\d+(\.\d+)?)');
  if v_number is null then
    return null;
  end if;
  if v ~ 'month' then
    v_days := v_number::numeric * 30;
  elsif v ~ 'week' then
    v_days := v_number::numeric * 7;
  elsif v ~ 'day' or v ~ '^\d+(\.\d+)?\s*\+?$' then
    v_days := v_number::numeric;
  else
    return null;
  end if;
  return case
    when v_days <= 0 then 'immediate'
    when v_days <= 15 then '15'
    when v_days <= 30 then '30'
    when v_days <= 45 then '45'
    when v_days <= 60 then '60'
    else '90_plus'
  end;
end;
$$;

revoke execute on function public.normalize_notice_period(text) from public, anon;
grant execute on function public.normalize_notice_period(text) to authenticated, service_role;

create or replace function public.candidates_normalize_notice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.notice_period is not null then
    new.notice_period := coalesce(public.normalize_notice_period(new.notice_period), btrim(new.notice_period));
  end if;
  return new;
end;
$$;

drop trigger if exists candidates_normalize_notice on public.candidates;
create trigger candidates_normalize_notice before insert or update of notice_period on public.candidates
  for each row execute function public.candidates_normalize_notice();

update public.candidates
set notice_period = public.normalize_notice_period(notice_period)
where notice_period is not null
  and public.normalize_notice_period(notice_period) is not null
  and public.normalize_notice_period(notice_period) is distinct from notice_period;

-- ---------------------------------------------------------------------------
-- 3. Vacancy deadline and start time
-- ---------------------------------------------------------------------------

alter table public.vacancies
  add column if not exists presentation_deadline date,
  add column if not exists start_time_ist time;

comment on column public.vacancies.presentation_deadline is
  'Date by which Nordavo presents the top 3 to 5 candidates to the client. Shown next to the intro meeting.';
comment on column public.vacancies.start_time_ist is
  'Desired daily start time in India (IST). The portal shows the Dutch start time for winter and summer time.';

-- ---------------------------------------------------------------------------
-- 4. On hold periods
-- ---------------------------------------------------------------------------

create table if not exists public.vacancy_holds (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  started_on date not null,
  -- Null while the vacancy is on hold; the date it resumed otherwise.
  ended_on date,
  reason text not null check (char_length(btrim(reason)) between 1 and 2000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  ended_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);

create index if not exists vacancy_holds_vacancy_idx on public.vacancy_holds (vacancy_id, started_on);
create unique index if not exists vacancy_holds_one_open on public.vacancy_holds (vacancy_id) where ended_on is null;

comment on table public.vacancy_holds is
  'Periods a vacancy was on hold, with the reason. Days open and lead time leave these periods out.';

alter table public.vacancy_holds enable row level security;
drop policy if exists "Recruitment manages vacancy holds" on public.vacancy_holds;
create policy "Recruitment manages vacancy holds" on public.vacancy_holds
  for all to authenticated using (public.has_module('recruitment')) with check (public.has_module('recruitment'));

grant select, insert, update, delete on public.vacancy_holds to authenticated;

-- Vacancies on hold without a reason get a placeholder, so the rule below holds.
update public.vacancies
set park_reason = 'No reason given (put on hold before a reason was required)'
where status = 'on_hold' and nullif(btrim(coalesce(park_reason, '')), '') is null;

alter table public.vacancies drop constraint if exists vacancies_on_hold_needs_reason;
alter table public.vacancies
  add constraint vacancies_on_hold_needs_reason
  check (status <> 'on_hold' or nullif(btrim(coalesce(park_reason, '')), '') is not null);

-- The start date may be chosen (parked_at); without one it is now.
create or replace function public.vacancies_track_park()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'on_hold' then
    if tg_op = 'INSERT' then
      new.parked_at := coalesce(new.parked_at, now());
    elsif old.status <> 'on_hold' then
      new.parked_at := case when new.parked_at is distinct from old.parked_at and new.parked_at is not null then new.parked_at else now() end;
    end if;
  else
    new.parked_at := null;
    new.park_reason := null;
  end if;
  return new;
end;
$$;

-- Keep vacancy_holds in step with the status: open a period when the
-- vacancy goes on hold, close it when it resumes.
create or replace function public.vacancies_track_holds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
begin
  if new.status = 'on_hold' and (tg_op = 'INSERT' or old.status <> 'on_hold') then
    v_start := (coalesce(new.parked_at, now()) at time zone 'Europe/Amsterdam')::date;
    update public.vacancy_holds
      set ended_on = greatest(started_on, v_start), ended_by = auth.uid()
      where vacancy_id = new.id and ended_on is null;
    insert into public.vacancy_holds (vacancy_id, started_on, reason, created_by)
    values (new.id, v_start, coalesce(nullif(btrim(new.park_reason), ''), 'No reason given'), auth.uid());
  elsif tg_op = 'UPDATE' and old.status = 'on_hold' and new.status <> 'on_hold' then
    update public.vacancy_holds
      set ended_on = greatest(started_on, (now() at time zone 'Europe/Amsterdam')::date), ended_by = auth.uid()
      where vacancy_id = new.id and ended_on is null;
  elsif tg_op = 'UPDATE' and new.status = 'on_hold' and new.park_reason is distinct from old.park_reason then
    update public.vacancy_holds
      set reason = coalesce(nullif(btrim(new.park_reason), ''), reason)
      where vacancy_id = new.id and ended_on is null;
  end if;
  return null;
end;
$$;

revoke execute on function public.vacancies_track_holds() from public, anon, authenticated;

drop trigger if exists vacancies_track_holds on public.vacancies;
create trigger vacancies_track_holds after insert or update of status, park_reason on public.vacancies
  for each row execute function public.vacancies_track_holds();

-- Vacancies already on hold get their open period.
insert into public.vacancy_holds (vacancy_id, started_on, reason, created_by)
select v.id, (coalesce(v.parked_at, v.updated_at) at time zone 'Europe/Amsterdam')::date, v.park_reason, null
from public.vacancies v
where v.status = 'on_hold'
  and not exists (select 1 from public.vacancy_holds h where h.vacancy_id = v.id and h.ended_on is null);

-- ---------------------------------------------------------------------------
-- 5. CTC on the candidate
-- ---------------------------------------------------------------------------

alter table public.candidates
  add column if not exists current_ctc_inr_year numeric(14, 2) check (current_ctc_inr_year >= 0),
  add column if not exists expected_ctc_inr_year numeric(14, 2) check (expected_ctc_inr_year >= 0);

comment on column public.candidates.current_ctc_inr_year is 'Current CTC in INR per year, as the candidate told us (optional). Per vacancy CTC lives in application_compensation.';
comment on column public.candidates.expected_ctc_inr_year is 'Expected CTC in INR per year (optional).';

-- ---------------------------------------------------------------------------
-- 6. Attachments
-- ---------------------------------------------------------------------------

alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments
  add constraint attachments_kind_check check (kind in (
    'cv', 'payslip', 'background_check', 'video', 'test_result', 'job_description', 'other'
  ));

-- Video intro copies can be larger than 20 MB; the app keeps 20 MB for other files.
update storage.buckets set file_size_limit = 209715200 where id = 'attachments' and coalesce(file_size_limit, 0) < 209715200;

-- ---------------------------------------------------------------------------
-- 7. Duplicates on name
-- ---------------------------------------------------------------------------

-- Candidates whose name matches one of these (lower case, spaces squeezed).
create or replace function public.screening_find_candidates_by_name(p_names text[] default '{}')
returns table (id uuid, full_name text, email text, phone text)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.full_name, c.email, c.phone
  from public.candidates c
  where cardinality(p_names) > 0
    and lower(regexp_replace(btrim(c.full_name), '\s+', ' ', 'g')) = any (p_names)
  limit 5000;
$$;

revoke execute on function public.screening_find_candidates_by_name(text[]) from public, anon;
grant execute on function public.screening_find_candidates_by_name(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Custom fields that were candidate data on vacancies
-- ---------------------------------------------------------------------------

update public.vacancies
set custom_fields = custom_fields - 'notice_period' - 'linkedin_profile'
where custom_fields ?| array['notice_period', 'linkedin_profile'];

delete from public.custom_field_definitions
where entity = 'vacancy' and key in ('notice_period', 'linkedin_profile');
