-- Recruitment pipeline (supabase/migrations/*_recruitment_pipeline.sql),
-- played out with real RLS. Run against a database with every migration
-- applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recruitment_pipeline.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000002a1', 'judith@nordavo.nl', '{"full_name": "Judith"}'),
  ('00000000-0000-0000-0000-0000000002a2', 'sabine@kg.nl', '{"full_name": "Sabine"}'),
  ('00000000-0000-0000-0000-0000000002a3', 'floris@nordavo.nl', '{"full_name": "Floris"}');

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-0000000002c1', 'KG', 'active');

update public.profiles set role = 'member' where email in ('judith@nordavo.nl', 'floris@nordavo.nl');
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000002c1'
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

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text) to authenticated, service_role;

select pg_temp.act('judith@nordavo.nl');
set role authenticated;

insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000002e1', '00000000-0000-0000-0000-0000000002c1', 'GTM engineer');
insert into public.candidates (id, full_name) values
  ('00000000-0000-0000-0000-0000000002f1', 'Asha'),
  ('00000000-0000-0000-0000-0000000002f2', 'Ravi');
insert into public.applications (id, vacancy_id, candidate_id) values
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000002e1', '00000000-0000-0000-0000-0000000002f1'),
  ('00000000-0000-0000-0000-0000000002b2', '00000000-0000-0000-0000-0000000002e1', '00000000-0000-0000-0000-0000000002f2');

-- ---------------------------------------------------------------------------
-- Assessment
-- ---------------------------------------------------------------------------

insert into public.application_assessments (application_id, screening_tools, screening_communication_score, test_score)
values ('00000000-0000-0000-0000-0000000002b2', '[{"tool": "Clay", "years": 2}, {"tool": "n8n", "years": 2}, {"tool": "Python", "years": 4.5}]', 80, 72);
select pg_temp.check((select technical_score from public.applications where id = '00000000-0000-0000-0000-0000000002b2') = 72,
  'technical_score follows the test score');
update public.application_assessments set test_score = 85 where application_id = '00000000-0000-0000-0000-0000000002b2';
select pg_temp.check((select technical_score from public.applications where id = '00000000-0000-0000-0000-0000000002b2') = 85,
  'technical_score follows a changed test score');

update public.applications set video_score = 64 where id = '00000000-0000-0000-0000-0000000002b2';
select pg_temp.check((select english_score from public.applications where id = '00000000-0000-0000-0000-0000000002b2') = 64,
  'english_score follows the video score');

-- Invalid screening tools are refused.
do $$ begin
  insert into public.application_assessments (application_id, screening_tools)
  values ('00000000-0000-0000-0000-0000000002b1', '[{"tool": "Clay", "years": 80}]');
  raise exception 'FAIL: 80 years accepted';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.application_assessments (application_id, screening_tools)
  values ('00000000-0000-0000-0000-0000000002b1', '[{"tool": "Clay", "years": "two"}]');
  raise exception 'FAIL: text years accepted';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.application_assessments (application_id, screening_tools)
  values ('00000000-0000-0000-0000-0000000002b1', '{"tool": "Clay"}');
  raise exception 'FAIL: object instead of array accepted';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.application_assessments (application_id, test_url)
  values ('00000000-0000-0000-0000-0000000002b1', 'javascript:alert(1)');
  raise exception 'FAIL: non http link accepted';
exception when check_violation then null;
end $$;

-- ---------------------------------------------------------------------------
-- Notes record the stage
-- ---------------------------------------------------------------------------

select public.move_applications(array['00000000-0000-0000-0000-0000000002b2']::uuid[], 'video_review');
insert into public.notes (entity_type, entity_id, body, kind)
values ('application', '00000000-0000-0000-0000-0000000002b2', 'Called, notice period 30 days', 'call');
select pg_temp.check((select stage = 'video_review' and kind = 'call' from public.notes
  where entity_id = '00000000-0000-0000-0000-0000000002b2'), 'application note records the current stage');
insert into public.notes (entity_type, entity_id, body)
values ('candidate', '00000000-0000-0000-0000-0000000002f2', 'General note');
select pg_temp.check((select stage is null from public.notes where entity_id = '00000000-0000-0000-0000-0000000002f2'),
  'candidate note has no stage');

-- ---------------------------------------------------------------------------
-- Toppers
-- ---------------------------------------------------------------------------

do $$ begin
  update public.candidates set is_topper = true where id = '00000000-0000-0000-0000-0000000002f2';
  raise exception 'FAIL: topper without a reason';
exception when check_violation then null;
end $$;
update public.candidates set is_topper = true, topper_reason = 'Strong video, 4 years Python', topper_at = '2000-01-01'
  where id = '00000000-0000-0000-0000-0000000002f2';
select pg_temp.check((select is_topper and topper_by = '00000000-0000-0000-0000-0000000002a1' and topper_at > now() - interval '1 minute'
  from public.candidates where id = '00000000-0000-0000-0000-0000000002f2'), 'topper by and at set by the database');
update public.candidates set is_topper = false where id = '00000000-0000-0000-0000-0000000002f2';
select pg_temp.check((select not is_topper and topper_reason is null and topper_by is null and topper_at is null
  from public.candidates where id = '00000000-0000-0000-0000-0000000002f2'), 'unmarking clears the topper');
update public.candidates set is_topper = true, topper_reason = 'Back on top'
  where id = '00000000-0000-0000-0000-0000000002f2';

-- ---------------------------------------------------------------------------
-- Parking candidates and vacancies
-- ---------------------------------------------------------------------------

update public.candidates set status = 'parked', park_reason = 'Wants to wait until March' where id = '00000000-0000-0000-0000-0000000002f1';
select pg_temp.check((select parked_at is not null from public.candidates where id = '00000000-0000-0000-0000-0000000002f1'), 'candidate parked_at set');
update public.candidates set status = 'available' where id = '00000000-0000-0000-0000-0000000002f1';
select pg_temp.check((select parked_at is null and park_reason is null from public.candidates where id = '00000000-0000-0000-0000-0000000002f1'),
  'unparking clears the candidate reason');

insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000002e2', '00000000-0000-0000-0000-0000000002c1', 'Parked role');
update public.vacancies set status = 'on_hold', park_reason = 'Client budget freeze' where id = '00000000-0000-0000-0000-0000000002e2';
select pg_temp.check((select parked_at is not null and park_reason = 'Client budget freeze' from public.vacancies
  where id = '00000000-0000-0000-0000-0000000002e2'), 'vacancy parked');
update public.vacancies set status = 'open' where id = '00000000-0000-0000-0000-0000000002e2';
select pg_temp.check((select parked_at is null and park_reason is null from public.vacancies
  where id = '00000000-0000-0000-0000-0000000002e2'), 'vacancy unparked');

-- ---------------------------------------------------------------------------
-- Background check report and files
-- ---------------------------------------------------------------------------

select public.move_applications(array['00000000-0000-0000-0000-0000000002b2']::uuid[], 'final_screening');
update public.applications set background_check_status = 'requested' where id = '00000000-0000-0000-0000-0000000002b2';
insert into public.attachments (entity_type, entity_id, storage_path, file_name, kind) values
  ('application', '00000000-0000-0000-0000-0000000002b2', 'application/00000000-0000-0000-0000-0000000002b2/x-report.pdf', 'report.pdf', 'background_check'),
  ('candidate', '00000000-0000-0000-0000-0000000002f2', 'candidate/00000000-0000-0000-0000-0000000002f2/y-report.pdf', 'report.pdf', 'background_check'),
  ('candidate', '00000000-0000-0000-0000-0000000002f2', 'candidate/00000000-0000-0000-0000-0000000002f2/z-cv.pdf', 'cv.pdf', 'cv');
insert into storage.objects (bucket_id, name) values
  ('attachments', 'application/00000000-0000-0000-0000-0000000002b2/x-report.pdf'),
  ('attachments', 'candidate/00000000-0000-0000-0000-0000000002f2/y-report.pdf'),
  ('attachments', 'candidate/00000000-0000-0000-0000-0000000002f2/z-cv.pdf');

-- Staff see everything they wrote.
select pg_temp.check((select count(*) from public.application_assessments) = 1, 'staff see the assessment');
select pg_temp.check((select count(*) from public.notes) = 2, 'staff see the notes');
select pg_temp.check((select count(*) from storage.objects) = 3, 'staff see the files');

-- Staff cannot call the MCP wrapper directly.
select pg_temp.check(not has_function_privilege('authenticated', 'public.move_applications_as(uuid, uuid[], text, text, date)', 'execute'),
  'authenticated cannot execute move_applications_as');

reset role;

-- ---------------------------------------------------------------------------
-- Client: sees the presented candidate, nothing internal
-- ---------------------------------------------------------------------------

select pg_temp.act('sabine@kg.nl');
set role authenticated;

select pg_temp.check((select count(*) from public.applications) = 1, 'client sees the presented application');
select pg_temp.check((select count(*) from public.application_assessments) = 0, 'client sees no assessments');
select pg_temp.check((select count(*) from public.notes) = 0, 'client sees no notes');
select pg_temp.check((select count(*) from public.attachments) = 0, 'client sees no attachment records');
select pg_temp.check((select count(*) from storage.objects) = 1, 'client opens only the CV file');
select pg_temp.check((select name like '%z-cv.pdf' from storage.objects), 'and that file is the CV');

do $$ begin
  insert into public.application_assessments (application_id, test_score) values ('00000000-0000-0000-0000-0000000002b1', 100);
  raise exception 'FAIL: client wrote an assessment';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.candidates set is_topper = false;
  if exists (select 1 from public.candidates where not is_topper) then
    raise exception 'FAIL: client changed a topper';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- MCP: the service role moves in the name of a team member
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role": "service_role"}', false);
set role service_role;

select pg_temp.check(public.move_applications_as('00000000-0000-0000-0000-0000000002a3',
  array['00000000-0000-0000-0000-0000000002b1']::uuid[], 'parked', 'Notice period of 90 days', '2027-02-01') = 1, 'service role parks as Floris');
select pg_temp.check((select stage = 'parked' and park_reason = 'Notice period of 90 days' and park_until = '2027-02-01'
  from public.applications where id = '00000000-0000-0000-0000-0000000002b1'), 'parked with reason');
select pg_temp.check((select actor_id = '00000000-0000-0000-0000-0000000002a3' from public.application_stage_events
  where application_id = '00000000-0000-0000-0000-0000000002b1' and to_stage = 'parked'), 'history names Floris');
select pg_temp.check(current_setting('request.jwt.claims', true)::json ->> 'role' = 'service_role', 'claims restored after the call');

-- A client as actor is refused.
do $$ begin
  perform public.move_applications_as('00000000-0000-0000-0000-0000000002a2',
    array['00000000-0000-0000-0000-0000000002b1']::uuid[], 'resume');
  raise exception 'FAIL: client actor moved a candidate';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

reset role;

rollback;
