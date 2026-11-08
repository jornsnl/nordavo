-- Recruitment foundation (supabase/migrations/*_recruitment_foundation.sql),
-- played out with real RLS. Run against a database with every migration
-- applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recruitment_foundation.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000001a1', 'judith@nordavo.nl', '{"full_name": "Judith"}'),
  ('00000000-0000-0000-0000-0000000001a2', 'sabine@kg.nl', '{"full_name": "Sabine"}');

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-0000000001c1', 'KG', 'active');

update public.profiles set role = 'member' where email = 'judith@nordavo.nl';
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000001c1'
  where email = 'sabine@kg.nl';

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

select pg_temp.act('judith@nordavo.nl');
set role authenticated;

insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001c1', 'GTM engineer');
insert into public.candidates (id, full_name) values
  ('00000000-0000-0000-0000-0000000001f1', 'Asha'),
  ('00000000-0000-0000-0000-0000000001f2', 'Ravi'),
  ('00000000-0000-0000-0000-0000000001f3', 'Meera');
insert into public.applications (id, vacancy_id, candidate_id, origin, source) values
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001f1', 'applied', 'naukri'),
  ('00000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001f2', 'headhunted', 'linkedin'),
  ('00000000-0000-0000-0000-0000000001b3', '00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001f3', 'applied', 'linkedin');

-- New applications are in_process candidates and start the history.
select pg_temp.check((select status from public.candidates where id = '00000000-0000-0000-0000-0000000001f1') = 'in_process', 'candidate in process after applying');
select pg_temp.check((select count(*) from public.application_stage_events where vacancy_id = '00000000-0000-0000-0000-0000000001e1') = 3, 'three history rows');

-- Bulk move.
select pg_temp.check(public.move_applications(array[
  '00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-0000000001b3'
]::uuid[], 'video_review') = 3, 'moved three');
select pg_temp.check((select count(*) from public.applications where stage = 'video_review') = 3, 'all in video review');

-- Park with a reason, remembers the stage it left.
select public.move_applications(array['00000000-0000-0000-0000-0000000001b1']::uuid[], 'parked', 'Good, but notice period of 90 days', '2027-01-01');
select pg_temp.check((select stage = 'parked' and exit_from_stage = 'video_review' and park_reason like 'Good%' and parked_at is not null and park_until = '2027-01-01'
  from public.applications where id = '00000000-0000-0000-0000-0000000001b1'), 'parked with reason and exit stage');
select pg_temp.check((select status from public.candidates where id = '00000000-0000-0000-0000-0000000001f1') = 'available', 'parked application frees the candidate');

-- Reject: candidate no longer stays on in_process.
select public.move_applications(array['00000000-0000-0000-0000-0000000001b3']::uuid[], 'rejected', 'Frontend profile');
select pg_temp.check((select status from public.candidates where id = '00000000-0000-0000-0000-0000000001f3') = 'available', 'rejected candidate is available again');
select pg_temp.check((select rejection_reason from public.applications where id = '00000000-0000-0000-0000-0000000001b3') = 'Frontend profile', 'rejection reason stored');

-- Resume returns to the stage that was left.
select pg_temp.check(public.move_applications(array['00000000-0000-0000-0000-0000000001b1']::uuid[], 'resume') = 1, 'resumed one');
select pg_temp.check((select stage = 'video_review' and exit_from_stage is null and parked_at is null
  from public.applications where id = '00000000-0000-0000-0000-0000000001b1'), 'back in video review');

-- A candidate parked by hand stays parked when nothing is active.
update public.candidates set status = 'parked', park_reason = 'Wants to stay at current employer until March' where id = '00000000-0000-0000-0000-0000000001f3';
select public.move_applications(array['00000000-0000-0000-0000-0000000001b3']::uuid[], 'rejected', 'still no');
select pg_temp.check((select status from public.candidates where id = '00000000-0000-0000-0000-0000000001f3') = 'parked', 'manual park kept');

-- Matched: presented_at set, client can see it.
select public.move_applications(array['00000000-0000-0000-0000-0000000001b2']::uuid[], 'matched');
select pg_temp.check((select presented_at is not null from public.applications where id = '00000000-0000-0000-0000-0000000001b2'), 'presented_at set on matched');

-- Mixing vacancies is refused.
insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000001e2', '00000000-0000-0000-0000-0000000001c1', 'Other');
insert into public.applications (id, vacancy_id, candidate_id) values
  ('00000000-0000-0000-0000-0000000001b4', '00000000-0000-0000-0000-0000000001e2', '00000000-0000-0000-0000-0000000001f1');
do $$ begin
  perform public.move_applications(array['00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000001b4']::uuid[], 'interview');
  raise exception 'FAIL: two vacancies at once should be refused';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- History holds every step.
select pg_temp.check((select count(*) from public.application_stage_events where application_id = '00000000-0000-0000-0000-0000000001b1') = 4,
  'history: sourced, video_review, parked, video_review');

reset role;

-- Client: sees the matched candidate only, cannot move anything.
select pg_temp.act('sabine@kg.nl');
set role authenticated;

select pg_temp.check((select count(*) from public.applications) = 1, 'client sees one presented application');
select pg_temp.check((select count(*) from public.candidates) = 1, 'client sees one candidate');
select pg_temp.check((select count(*) from public.application_stage_events) = 0, 'client sees no history');
do $$ begin
  perform public.move_applications(array['00000000-0000-0000-0000-0000000001b2']::uuid[], 'placed');
  raise exception 'FAIL: client moved a candidate';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;
select public.client_review_application('00000000-0000-0000-0000-0000000001b2', 'approved', 'Looks good');

reset role;
select pg_temp.check((select client_decision from public.applications where id = '00000000-0000-0000-0000-0000000001b2') = 'approved', 'client review on matched');

rollback;
