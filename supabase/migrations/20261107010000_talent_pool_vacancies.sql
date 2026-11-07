-- Talent pool vacancies (client feedback, point 5).
--
-- A vacancy belongs to a client, to a GTM prospect (company), or to the
-- talent pool: a role Nordavo recruits for without a client yet. A talent
-- pool vacancy has no three-week clock and does not count on the dashboard
-- or in the report. Later it can be linked to a client or prospect, which
-- turns it into a normal vacancy (the app restarts the clock at that moment).
--
-- Stored as an explicit flag rather than derived from "no client and no
-- company": the intent is visible in every query and policy, and a bug that
-- drops the owner of a normal vacancy is refused by the check below instead
-- of silently turning that vacancy into a talent pool one.

alter table public.vacancies
  add column is_talent_pool boolean not null default false;

-- Exactly one of: talent pool (no owner at all) or an owner (client and/or
-- prospect company), replacing the check that always required an owner.
alter table public.vacancies drop constraint vacancies_owner_company_check;
alter table public.vacancies
  add constraint vacancies_owner_check check (
    case
      when is_talent_pool then client_id is null and company_id is null
      else client_id is not null or company_id is not null
    end
  );

create index vacancies_is_talent_pool_idx on public.vacancies (is_talent_pool) where is_talent_pool;

comment on column public.vacancies.is_talent_pool is
  'Talent pool vacancy: no client or prospect, no three-week clock, left out of dashboard and report.';

-- ---------------------------------------------------------------------------
-- Client portal. A talent pool vacancy has no client_id, so the existing
-- policies already never match it. The policies are recreated with an
-- explicit "not is_talent_pool" so that stays true even if the owner check
-- above is ever relaxed. Staff policies are unchanged.
-- ---------------------------------------------------------------------------

drop policy "Clients read own vacancies" on public.vacancies;
create policy "Clients read own vacancies" on public.vacancies
  for select to authenticated using (
    client_id = public.current_client_id()
    and not is_talent_pool
  );

drop policy "Clients read presented applications" on public.applications;
create policy "Clients read presented applications" on public.applications
  for select to authenticated using (
    stage in ('presented', 'final_interview', 'placed')
    and exists (
      select 1 from public.vacancies v
      where v.id = applications.vacancy_id
        and v.client_id = public.current_client_id()
        and not v.is_talent_pool
    )
  );

drop policy "Clients read presented candidates" on public.candidates;
create policy "Clients read presented candidates" on public.candidates
  for select to authenticated using (
    exists (
      select 1
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
      where a.candidate_id = candidates.id
        and a.stage in ('presented', 'final_interview', 'placed')
        and v.client_id = public.current_client_id()
        and not v.is_talent_pool
    )
  );

drop policy "Clients read presented candidate files" on storage.objects;
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
        and not v.is_talent_pool
    )
  );
