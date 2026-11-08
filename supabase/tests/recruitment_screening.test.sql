-- Recruitment screening (supabase/migrations/*_recruitment_screening.sql),
-- played out with real RLS. Run against a database with every migration
-- applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recruitment_screening.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000003a1', 'judith.s@nordavo.nl', '{"full_name": "Judith"}'),
  ('00000000-0000-0000-0000-0000000003a2', 'floris.s@nordavo.nl', '{"full_name": "Floris"}'),
  ('00000000-0000-0000-0000-0000000003a3', 'sabine.s@kg.nl', '{"full_name": "Sabine"}');

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-0000000003c1', 'KG screening', 'active');

update public.profiles set role = 'member' where email = 'judith.s@nordavo.nl';
update public.profiles set role = 'admin' where email = 'floris.s@nordavo.nl';
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000003c1'
  where email = 'sabine.s@kg.nl';

create or replace function pg_temp.act(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = p_email),
    'role', 'authenticated',
    'email', p_email)::text, false);
end $$;

create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_what; end if;
end $$;

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff member: requirements, techstack checks, scores, dedupe lookup
-- ---------------------------------------------------------------------------

select pg_temp.act('judith.s@nordavo.nl');
set role authenticated;

insert into public.vacancies (id, client_id, title, stack, excluded_profiles, techstack_min_hits, screening_model) values
  ('00000000-0000-0000-0000-0000000003e1', '00000000-0000-0000-0000-0000000003c1', 'Backend engineer', '{Node.js,PostgreSQL}', '{Frontend only}', 2, 'claude-haiku-5-5');
insert into public.candidates (id, full_name, email, phone, linkedin_url, cv_text, source, origin) values
  ('00000000-0000-0000-0000-0000000003f1', 'Asha', 'Asha@Example.com', '+91 98450 12345', 'https://in.linkedin.com/in/asha/', 'Node.js and PostgreSQL for six years.', 'naukri', 'applied'),
  ('00000000-0000-0000-0000-0000000003f2', 'Ravi', null, '080 4455 6677', null, null, 'linkedin', 'headhunted');
insert into public.applications (id, vacancy_id, candidate_id, source, origin, stage) values
  ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-0000000003e1', '00000000-0000-0000-0000-0000000003f1', 'naukri', 'applied', 'sourced'),
  ('00000000-0000-0000-0000-0000000003b2', '00000000-0000-0000-0000-0000000003e1', '00000000-0000-0000-0000-0000000003f2', 'linkedin', 'headhunted', 'sourced');

select pg_temp.check((select has_cv_text from public.candidates where id = '00000000-0000-0000-0000-0000000003f1'), 'has_cv_text follows cv_text');
select pg_temp.check((select not has_cv_text from public.candidates where id = '00000000-0000-0000-0000-0000000003f2'), 'no cv text');

-- Dedupe lookup: email case-insensitive, phone on the last 10 digits, LinkedIn normalised.
select pg_temp.check((select count(*) from public.screening_find_candidates(array['asha@example.com'], '{}', '{}')) = 1, 'find by email');
select pg_temp.check((select count(*) from public.screening_find_candidates('{}', array['8044556677'], '{}')) = 1, 'find by phone key');
select pg_temp.check((select count(*) from public.screening_find_candidates('{}', '{}', array['linkedin.com/in/asha'])) = 1, 'find by LinkedIn');
select pg_temp.check((select count(*) from public.screening_find_candidates(array['nobody@example.com'], '{}', '{}')) = 0, 'no match');

insert into public.vacancy_requirements (vacancy_id, label, kind, alternatives, position) values
  ('00000000-0000-0000-0000-0000000003e1', 'Node.js', 'must_have', '{}', 0),
  ('00000000-0000-0000-0000-0000000003e1', 'PostgreSQL', 'alternative', '{MySQL}', 1);
select pg_temp.check((select count(*) from public.vacancy_requirements) = 2, 'staff writes requirements');

insert into public.techstack_checks (application_id, vacancy_id, result, reason, hits) values
  ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-0000000003e1', 'pass', 'Has 2 of 2', '{Node.js,PostgreSQL}');
select pg_temp.check((select checked_by = '00000000-0000-0000-0000-0000000003a1' from public.techstack_checks), 'checked_by is the staff member');

-- A real score lands on the application; a comparison does not.
insert into public.cv_scores (application_id, vacancy_id, candidate_id, purpose, score, verdict, breakdown, model, prompt_version) values
  ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-0000000003e1', '00000000-0000-0000-0000-0000000003f1', 'score', 82, 'fit', '[{"label":"Node.js","status":"met"}]', 'claude-haiku-5-5', 0);
select pg_temp.check((select cv_score = 82 and cv_verdict = 'fit' and cv_scored_at is not null from public.applications where id = '00000000-0000-0000-0000-0000000003b1'), 'score copied to the application');
insert into public.cv_scores (application_id, vacancy_id, candidate_id, purpose, score, verdict, model, prompt_version) values
  ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-0000000003e1', '00000000-0000-0000-0000-0000000003f1', 'compare', 40, 'no_fit', 'claude-opus-5-5', 1);
select pg_temp.check((select cv_score = 82 from public.applications where id = '00000000-0000-0000-0000-0000000003b1'), 'comparison leaves the application alone');

-- Staff read prompts but cannot write or activate them.
select pg_temp.check((select count(*) from public.screening_prompts) = 0, 'no prompts yet');
do $$ begin
  insert into public.screening_prompts (instructions) values ('A member tries to add a prompt version here.');
  raise exception 'FAIL: a member added a prompt';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.activate_screening_prompt(null);
  raise exception 'FAIL: a member activated a prompt';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- Bulk moves through move_applications still work for screening results.
select pg_temp.check(public.move_applications(array['00000000-0000-0000-0000-0000000003b2']::uuid[], 'rejected', 'Techstack mismatch: None of the stack found') = 1, 'rejected with reason');

reset role;

-- ---------------------------------------------------------------------------
-- Admin: prompt versions and activation
-- ---------------------------------------------------------------------------

select pg_temp.act('floris.s@nordavo.nl');
set role authenticated;

insert into public.screening_prompts (instructions, notes) values ('First version of the CV scoring instructions.', 'v1');
insert into public.screening_prompts (instructions, notes, version) values ('Second version of the CV scoring instructions.', 'v2', 99);
select pg_temp.check((select array_agg(version order by version) = array[1, 2] from public.screening_prompts), 'versions handed out by the database');

select public.activate_screening_prompt((select id from public.screening_prompts where version = 1));
select public.activate_screening_prompt((select id from public.screening_prompts where version = 2));
select pg_temp.check((select count(*) from public.screening_prompts where is_active) = 1, 'one active version');
select pg_temp.check((select version from public.screening_prompts where is_active) = 2, 'version 2 active');

delete from public.screening_prompts where version = 2;
select pg_temp.check((select count(*) from public.screening_prompts) = 2, 'the active version cannot be deleted');
delete from public.screening_prompts where version = 1;
select pg_temp.check((select count(*) from public.screening_prompts) = 1, 'an inactive version can be deleted');

select public.activate_screening_prompt(null);
select pg_temp.check((select count(*) from public.screening_prompts where is_active) = 0, 'back to built-in');

reset role;

-- ---------------------------------------------------------------------------
-- Client: sees nothing of screening, even for a presented candidate
-- ---------------------------------------------------------------------------

update public.applications set stage = 'matched' where id = '00000000-0000-0000-0000-0000000003b1';

select pg_temp.act('sabine.s@kg.nl');
set role authenticated;

select pg_temp.check((select count(*) from public.portal_candidates()) = 1, 'client sees the presented application in the portal');
select pg_temp.check((select count(*) from public.applications) = 0 and (select count(*) from public.candidates) = 0, 'client cannot read internal rows directly');
select pg_temp.check((select count(*) from public.cv_scores) = 0, 'client sees no scores');
select pg_temp.check((select count(*) from public.screening_prompts) = 0, 'client sees no prompts');
select pg_temp.check((select count(*) from public.techstack_checks) = 0, 'client sees no techstack checks');
select pg_temp.check((select count(*) from public.vacancy_requirements) = 0, 'client sees no requirements');
select pg_temp.check((select count(*) from public.screening_find_candidates(array['asha@example.com'], '{}', '{}')) = 0,
  'the lookup is RLS bound: clients find nobody');
select pg_temp.check((select count(*) from public.screening_find_candidates('{}', array['8044556677'], '{}')) = 0, 'client cannot find other candidates');
do $$ begin
  insert into public.cv_scores (application_id, vacancy_id, candidate_id, score, verdict, model)
  values ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-0000000003e1', '00000000-0000-0000-0000-0000000003f1', 100, 'fit', 'x');
  raise exception 'FAIL: client wrote a score';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.screening_prompts (instructions) values ('A client tries to add a prompt version here.');
  raise exception 'FAIL: client added a prompt';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.activate_screening_prompt(null);
  raise exception 'FAIL: client activated a prompt';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

reset role;

-- Anonymous: no access to the lookup at all.
set role anon;
do $$ begin
  perform public.screening_find_candidates(array['asha@example.com'], '{}', '{}');
  raise exception 'FAIL: anon used the lookup';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
