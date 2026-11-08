-- Recruitment planning (supabase/migrations/*_recruitment_planning.sql),
-- played out with real RLS: modules per team member, interviews and the
-- Cal.com booking function. Run against a database with every migration
-- applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recruitment_planning.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000004a1', 'julius@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000004a2', 'judith@nordavo.nl', '{"full_name": "Judith"}'),
  ('00000000-0000-0000-0000-0000000004a3', 'sam@nordavo.nl', '{"full_name": "Sam"}'),
  ('00000000-0000-0000-0000-0000000004a4', 'floris@nordavo.nl', '{"full_name": "Floris"}');

update public.profiles set role = 'admin' where email = 'julius@nordavo.nl';
update public.profiles set role = 'member' where email in ('judith@nordavo.nl', 'sam@nordavo.nl', 'floris@nordavo.nl');

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

-- New members start with every module, so nothing changed for existing users.
select pg_temp.check((select modules = array['sales', 'recruitment', 'clients', 'report']
  from public.profiles where email = 'sam@nordavo.nl'), 'members start with every module');

-- Data of both worlds, written as the database owner.
insert into public.clients (id, name, status) values ('00000000-0000-0000-0000-0000000004c1', 'KG', 'active');
insert into public.companies (id, domain, name) values ('00000000-0000-0000-0000-0000000004d1', 'acme.nl', 'Acme');
insert into public.contacts (id, company_id, first_name, email) values
  ('00000000-0000-0000-0000-0000000004d2', '00000000-0000-0000-0000-0000000004d1', 'Jan', 'jan@acme.nl');
insert into public.campaigns (id, name, channel) values ('00000000-0000-0000-0000-0000000004d3', 'Autumn', 'mail');
insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000004e1', '00000000-0000-0000-0000-0000000004c1', 'Laravel developer');
insert into public.candidates (id, full_name, email) values
  ('00000000-0000-0000-0000-0000000004f1', 'Asha', 'asha@example.in'),
  ('00000000-0000-0000-0000-0000000004f2', 'Ravi', 'Ravi@Example.in');
insert into public.applications (id, vacancy_id, candidate_id, stage) values
  ('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000004e1', '00000000-0000-0000-0000-0000000004f1', 'video_review'),
  ('00000000-0000-0000-0000-0000000004b2', '00000000-0000-0000-0000-0000000004e1', '00000000-0000-0000-0000-0000000004f2', 'technical_test');
insert into public.notes (entity_type, entity_id, body) values
  ('company', '00000000-0000-0000-0000-0000000004d1', 'Sales note'),
  ('candidate', '00000000-0000-0000-0000-0000000004f1', 'Recruitment note');

-- ---------------------------------------------------------------------------
-- Only admins decide who sees what.
-- ---------------------------------------------------------------------------

select pg_temp.act('judith@nordavo.nl');
set role authenticated;
do $$ begin
  perform public.admin_set_profile_modules('00000000-0000-0000-0000-0000000004a2', array['sales', 'recruitment']);
  raise exception 'FAIL: a member changed modules';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;
do $$ begin
  update public.profiles set modules = '{sales}' where id = '00000000-0000-0000-0000-0000000004a2';
  raise exception 'FAIL: a member updated the modules column';
exception when insufficient_privilege then null;
end $$;
-- Own booking link is allowed, a non https link is not.
update public.profiles set booking_url = 'https://cal.com/judith/interview' where id = '00000000-0000-0000-0000-0000000004a2';
do $$ begin
  update public.profiles set booking_url = 'javascript:alert(1)' where id = '00000000-0000-0000-0000-0000000004a2';
  raise exception 'FAIL: unsafe booking link accepted';
exception when check_violation then null;
end $$;
reset role;

select pg_temp.act('julius@nordavo.nl');
set role authenticated;
select public.admin_set_profile_modules('00000000-0000-0000-0000-0000000004a2', array['recruitment']);
select public.admin_set_profile_modules('00000000-0000-0000-0000-0000000004a3', array['sales', 'sales']);
do $$ begin
  perform public.admin_set_profile_modules('00000000-0000-0000-0000-0000000004a3', array['finance']);
  raise exception 'FAIL: unknown module accepted';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;
-- The admin still sees everything.
select pg_temp.check((select count(*) from public.companies) = 1, 'admin sees companies');
select pg_temp.check((select count(*) from public.candidates) = 2, 'admin sees candidates');
reset role;

select pg_temp.check((select modules = '{sales}' from public.profiles where id = '00000000-0000-0000-0000-0000000004a3'), 'duplicates removed');

-- ---------------------------------------------------------------------------
-- Judith: recruitment only.
-- ---------------------------------------------------------------------------

select pg_temp.act('judith@nordavo.nl');
set role authenticated;
select pg_temp.check(public.has_module('recruitment') and not public.has_module('sales'), 'judith modules');
select pg_temp.check((select count(*) from public.companies) = 0, 'judith reads no GTM companies');
select pg_temp.check((select count(*) from public.contacts) = 0, 'judith reads no GTM contacts');
select pg_temp.check((select count(*) from public.campaigns) = 0, 'judith reads no campaigns');
select pg_temp.check((select count(*) from public.candidates) = 2, 'judith reads candidates');
select pg_temp.check((select count(*) from public.applications) = 2, 'judith reads applications');
select pg_temp.check((select count(*) from public.clients) = 1, 'judith sees which client a vacancy is for');
select pg_temp.check((select count(*) from public.notes) = 1, 'judith reads recruitment notes only');
update public.clients set name = 'Changed' where id = '00000000-0000-0000-0000-0000000004c1';
select pg_temp.check((select name from public.clients where id = '00000000-0000-0000-0000-0000000004c1') = 'KG', 'judith cannot change clients');
do $$ begin
  insert into public.companies (domain, name) values ('evil.nl', 'Evil');
  raise exception 'FAIL: judith created a company';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.notes (entity_type, entity_id, body) values ('company', '00000000-0000-0000-0000-0000000004d1', 'x');
  raise exception 'FAIL: judith wrote a sales note';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Sam: sales only.
-- ---------------------------------------------------------------------------

select pg_temp.act('sam@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.companies) = 1, 'sam reads companies');
select pg_temp.check((select count(*) from public.contacts) = 1, 'sam reads contacts');
select pg_temp.check((select count(*) from public.candidates) = 0, 'sam reads no candidates');
select pg_temp.check((select count(*) from public.applications) = 0, 'sam reads no applications');
select pg_temp.check((select count(*) from public.application_stage_events) = 0, 'sam reads no stage history');
select pg_temp.check((select count(*) from public.notes) = 1, 'sam reads sales notes only');
select pg_temp.check((select count(*) from public.clients) = 1, 'sam reads clients (lead conversion)');
insert into public.clients (name) values ('From a lead');
reset role;

-- ---------------------------------------------------------------------------
-- Interviews: Floris plans, Cal.com books.
-- ---------------------------------------------------------------------------

select pg_temp.act('floris@nordavo.nl');
set role authenticated;
insert into public.interviews (id, application_id, interviewer_id, kind) values
  ('00000000-0000-0000-0000-000000000491', '00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000004a4', 'english_interview'),
  ('00000000-0000-0000-0000-000000000492', '00000000-0000-0000-0000-0000000004b2', '00000000-0000-0000-0000-0000000004a4', 'interview');
select pg_temp.check((select count(*) from public.interviews where status = 'invited') = 2, 'two invitations');
do $$ begin
  perform public.interview_from_booking('BOOKING_CREATED', 'bk_1', null, '00000000-0000-0000-0000-000000000491');
  raise exception 'FAIL: a member called the webhook function';
exception when insufficient_privilege then null;
end $$;
reset role;

select pg_temp.act('sam@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.interviews) = 0, 'sales only member sees no interviews');
reset role;

-- The webhook runs with the service role.
select set_config('request.jwt.claims', '{"role": "service_role"}', false);
set role service_role;

-- 1. Matched on the interview id in the booking metadata.
select pg_temp.check((public.interview_from_booking('BOOKING_CREATED', 'bk_1', null, '00000000-0000-0000-0000-000000000491',
  'asha@example.in', '2026-11-12T09:00:00Z', '2026-11-12T09:30:00Z') ->> 'moved_to') = 'interview', 'booking moves to interview');
reset role;
select pg_temp.check((select stage = 'interview' and interview_at = '2026-11-12T09:00:00Z'
  from public.applications where id = '00000000-0000-0000-0000-0000000004b1'), 'stage and interview_at set');
select pg_temp.check((select status = 'scheduled' and cal_uid = 'bk_1' from public.interviews where id = '00000000-0000-0000-0000-000000000491'), 'scheduled');
select pg_temp.check((select actor_id = '00000000-0000-0000-0000-0000000004a4' from public.application_stage_events
  where application_id = '00000000-0000-0000-0000-0000000004b1' order by id desc limit 1), 'history shows the interviewer');
select pg_temp.check(current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role', 'claims restored');

set role service_role;
-- 2. Reschedule: found by the old uid, new time, status rescheduled.
select pg_temp.check((public.interview_from_booking('BOOKING_RESCHEDULED', 'bk_2', 'bk_1', null,
  'asha@example.in', '2026-11-13T10:00:00Z', '2026-11-13T10:30:00Z') ->> 'status') = 'rescheduled', 'rescheduled');
-- The old booking being cancelled does not cancel the new one.
select pg_temp.check((public.interview_from_booking('BOOKING_CANCELLED', 'bk_1') ->> 'ignored') = 'old booking', 'old uid ignored');

-- 3. No metadata: the attendee e-mail matches the open invitation (case insensitive).
select pg_temp.check((public.interview_from_booking('BOOKING_CREATED', 'bk_3', null, null,
  'ravi@example.in', '2026-11-14T08:00:00Z', '2026-11-14T08:45:00Z') ->> 'interview_id') = '00000000-0000-0000-0000-000000000492', 'matched by email');

-- 4. Not an interview: the sales flow takes it.
select pg_temp.check((public.interview_from_booking('BOOKING_CREATED', 'bk_9', null, null, 'jan@acme.nl') ->> 'matched') = 'false', 'sales booking not matched');
reset role;

select pg_temp.check((select interview_at = '2026-11-13T10:00:00Z' from public.applications where id = '00000000-0000-0000-0000-0000000004b1'), 'interview_at follows the reschedule');
select pg_temp.check((select stage from public.applications where id = '00000000-0000-0000-0000-0000000004b2') = 'interview', 'second moved to interview');

-- An application further along is never moved back.
update public.applications set stage = 'matched' where id = '00000000-0000-0000-0000-0000000004b2';
set role service_role;
select pg_temp.check((public.interview_from_booking('BOOKING_RESCHEDULED', 'bk_4', 'bk_3', null, null,
  '2026-11-15T08:00:00Z', '2026-11-15T08:45:00Z') ->> 'moved_to') is null, 'no move back');

-- 5. Cancel the current booking: interview_at is cleared.
select pg_temp.check((public.interview_from_booking('BOOKING_CANCELLED', 'bk_2', null, null, null, null, null, 'Sick') ->> 'status') = 'cancelled', 'cancelled');
reset role;
select pg_temp.check((select stage from public.applications where id = '00000000-0000-0000-0000-0000000004b2') = 'matched', 'still matched');
select pg_temp.check((select interview_at is null from public.applications where id = '00000000-0000-0000-0000-0000000004b1'), 'interview_at cleared on cancel');
select pg_temp.check((select cancellation_reason from public.interviews where id = '00000000-0000-0000-0000-000000000491') = 'Sick', 'reason kept');

-- Feedback by the interviewer.
select pg_temp.act('floris@nordavo.nl');
set role authenticated;
update public.interviews set status = 'done', rating = 4, communication = 5, feedback = 'Strong English', feedback_at = now()
  where id = '00000000-0000-0000-0000-000000000492';
select pg_temp.check((select rating = 4 from public.interviews where id = '00000000-0000-0000-0000-000000000492'), 'feedback saved');
do $$ begin
  update public.interviews set rating = 9 where id = '00000000-0000-0000-0000-000000000492';
  raise exception 'FAIL: rating out of range';
exception when check_violation then null;
end $$;
reset role;

-- Judith (recruitment) sees interviews; job runs follow modules.
insert into public.job_runs (job_name) values ('s2-qualify'), ('interview-reminders'), ('work-notify');
select pg_temp.act('judith@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.interviews) = 2, 'judith sees interviews');
select pg_temp.check((select count(*) from public.job_runs where job_name in ('interview-reminders', 'work-notify')) = 2
  and (select count(*) from public.job_runs where job_name = 's2-qualify') = 0, 'judith sees recruitment and shared job runs');
reset role;

rollback;
