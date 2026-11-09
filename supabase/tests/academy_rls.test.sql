-- Academy roles and visibility (supabase/migrations/20261112*_academy_*.sql):
-- managers, team members without the academy module, client admin, client
-- member, reader, developer, candidate, another client, Work only. One
-- transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000a001', 'admin.ac@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-00000000a002', 'hr.ac@nordavo.nl', '{"full_name": "HR"}'),
  ('00000000-0000-0000-0000-00000000a003', 'sales.ac@nordavo.nl', '{"full_name": "Sales"}'),
  ('00000000-0000-0000-0000-00000000a004', 'boss.ac@kg.nl', '{"full_name": "Klant Beheer"}'),
  ('00000000-0000-0000-0000-00000000a005', 'manager.ac@kg.nl', '{"full_name": "Klant Lid"}'),
  ('00000000-0000-0000-0000-00000000a006', 'board.ac@kg.nl', '{"full_name": "Meelezer"}'),
  ('00000000-0000-0000-0000-00000000a007', 'dev.ac@example.in', '{"full_name": "Asha"}'),
  ('00000000-0000-0000-0000-00000000a008', 'cand.ac@example.in', '{"full_name": "Ravi"}'),
  ('00000000-0000-0000-0000-00000000a009', 'other.ac@acme.nl', '{"full_name": "Other Client"}'),
  ('00000000-0000-0000-0000-00000000a010', 'guest.ac@freelance.nl', '{"full_name": "Guest"}'),
  ('00000000-0000-0000-0000-00000000a011', 'new.ac@example.in', '{"full_name": "Nieuw"}');

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-00000000ac01', 'KG', 'active'),
  ('00000000-0000-0000-0000-00000000ac02', 'Acme', 'active');

update public.profiles set role = 'admin' where email = 'admin.ac@nordavo.nl';
update public.profiles set role = 'member', modules = array['recruitment', 'academy'] where email = 'hr.ac@nordavo.nl';
update public.profiles set role = 'member', modules = array['sales'] where email = 'sales.ac@nordavo.nl';
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-00000000ac01'
  where email in ('boss.ac@kg.nl', 'manager.ac@kg.nl', 'board.ac@kg.nl');
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-00000000ac02' where email = 'other.ac@acme.nl';
update public.profiles set role = 'developer' where email = 'dev.ac@example.in';
update public.profiles set role = 'candidate' where email = 'cand.ac@example.in';
update public.profiles set role = 'external' where email in ('guest.ac@freelance.nl', 'new.ac@example.in');

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

-- New members get the academy module by default; the check accepts it.
select pg_temp.check(
  (select 'academy' = any (modules) from public.profiles where email = 'hr.ac@nordavo.nl'),
  'members can have module academy');

-- ---------------------------------------------------------------------------
-- A team member without module academy sees and manages nothing.
-- ---------------------------------------------------------------------------
select pg_temp.act('sales.ac@nordavo.nl');
set role authenticated;
select pg_temp.check(not public.academy_is_manager(), 'sales is no academy manager');
select pg_temp.check((select count(*) from public.academy_courses) = 0, 'sales reads no courses');
do $$ begin
  insert into public.academy_courses (title, language, audience) values ('x', 'nl', 'client');
  raise exception 'FAIL: sales made a course';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- HR (member with academy) builds the content and adds people.
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.ac@nordavo.nl');
set role authenticated;
select pg_temp.check(public.academy_is_manager(), 'hr is an academy manager');
select pg_temp.check((select count(*) from public.academy_courses where slug in ('client', 'developer')) = 2, 'seeded courses visible to managers');
select pg_temp.check((select count(*) from public.academy_modules m join public.academy_courses c on c.id = m.course_id where c.slug = 'client') = 9, 'client course has 9 modules');
select pg_temp.check((select count(*) from public.academy_modules m join public.academy_courses c on c.id = m.course_id where c.slug = 'developer') = 4, 'developer course has 4 modules');
select pg_temp.check((select count(*) from public.academy_modules where seed_key in ('developer-1', 'developer-2') and in_default_access) = 2, 'developer modules 1 and 2 open by default');
select pg_temp.check((select required_before_start from public.academy_modules where seed_key = 'client-1'), 'client module 1 before the start');

update public.academy_courses set status = 'published' where slug in ('client', 'developer');

-- One lesson per developer module, one in client module 1, a block each.
insert into public.academy_lessons (id, title, language, status) values
  ('00000000-0000-0000-0000-00000000a1e1', 'Welcome', 'en', 'published'),
  ('00000000-0000-0000-0000-00000000a1e2', 'Talking Dutch', 'en', 'published'),
  ('00000000-0000-0000-0000-00000000a1e3', 'Escalating', 'en', 'published'),
  ('00000000-0000-0000-0000-00000000a1e4', 'Voordat je begint', 'nl', 'published'),
  ('00000000-0000-0000-0000-00000000a1e5', 'Draft lesson', 'en', 'draft');
insert into public.academy_module_lessons (module_id, lesson_id, position)
select m.id, x.lesson_id, 1
from (values
  ('developer-1', '00000000-0000-0000-0000-00000000a1e1'::uuid),
  ('developer-2', '00000000-0000-0000-0000-00000000a1e2'::uuid),
  ('developer-3', '00000000-0000-0000-0000-00000000a1e3'::uuid),
  ('client-1', '00000000-0000-0000-0000-00000000a1e4'::uuid),
  ('developer-1', '00000000-0000-0000-0000-00000000a1e5'::uuid)
) x (seed_key, lesson_id)
join public.academy_modules m on m.seed_key = x.seed_key;
insert into public.academy_lesson_blocks (id, lesson_id, type, content, required) values
  ('00000000-0000-0000-0000-00000000a1b1', '00000000-0000-0000-0000-00000000a1e1', 'explanation', '{"html": "<p>Hi</p>"}', true),
  ('00000000-0000-0000-0000-00000000a1b2', '00000000-0000-0000-0000-00000000a1e2', 'explanation', '{"html": "<p>Dutch</p>"}', false),
  ('00000000-0000-0000-0000-00000000a1b3', '00000000-0000-0000-0000-00000000a1e3', 'explanation', '{"html": "<p>Secret module 3</p>"}', false),
  ('00000000-0000-0000-0000-00000000a1b4', '00000000-0000-0000-0000-00000000a1e4', 'notes', '{}', false),
  ('00000000-0000-0000-0000-00000000a1b5', '00000000-0000-0000-0000-00000000a1e1', 'assignment', '{}', false),
  ('00000000-0000-0000-0000-00000000a1b6', '00000000-0000-0000-0000-00000000a1e1', 'knowledge_check', '{}', false),
  ('00000000-0000-0000-0000-00000000a1b7', '00000000-0000-0000-0000-00000000a1e1', 'questionnaire', '{}', false);
insert into public.academy_check_questions (block_id, question, options, correct_index) values
  ('00000000-0000-0000-0000-00000000a1b6', 'Who decides?', '["you", "the team"]', 1);

-- People: client admin, member, reader (KG), other client (Acme), developer, candidate.
select public.academy_add_person('00000000-0000-0000-0000-00000000a004', 'client_admin', null, current_date, '00000000-0000-0000-0000-00000000ac01',
  null, (select id from public.academy_courses where slug = 'client'), 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000a005', 'client_member', null, current_date, '00000000-0000-0000-0000-00000000ac01',
  null, (select id from public.academy_courses where slug = 'client'), 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000a006', 'client_reader', null, null, '00000000-0000-0000-0000-00000000ac01',
  null, null, 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000a009', 'client_admin', null, current_date, '00000000-0000-0000-0000-00000000ac02',
  null, (select id from public.academy_courses where slug = 'client'), 'all', '{}');
reset role;

-- Recruitment data for the developer: candidate, placement with a rate.
insert into public.candidates (id, full_name) values
  ('00000000-0000-0000-0000-00000000acd1', 'Asha'),
  ('00000000-0000-0000-0000-00000000acd2', 'Ravi');
insert into public.placements (id, client_id, candidate_id, start_date, monthly_rate, hours_per_week, overlap_start, overlap_end) values
  ('00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000acd1',
   current_date, 4200, 40, '09:00', '13:00');

select pg_temp.act('hr.ac@nordavo.nl');
set role authenticated;
select public.academy_add_person('00000000-0000-0000-0000-00000000a007', 'developer', null, current_date, null,
  '00000000-0000-0000-0000-00000000acd1', (select id from public.academy_courses where slug = 'developer'), 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000a008', 'candidate', null, null, null,
  '00000000-0000-0000-0000-00000000acd2', (select id from public.academy_courses where slug = 'developer'), 'default', '{}');
select public.academy_add_person(p_profile_id => '00000000-0000-0000-0000-00000000a008', p_academy_role => 'candidate', p_time_zone => 'Asia/Kolkata');
select pg_temp.check((select time_zone from public.profiles where id = '00000000-0000-0000-0000-00000000a008') = 'Asia/Kolkata', 'time zone set on adding');
select pg_temp.check((select scope from public.academy_course_access where profile_id = '00000000-0000-0000-0000-00000000a008') = 'default', 'adding again keeps access');
insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000a004', 'client_admin'),
  ('00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000a005', 'client_member'),
  ('00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000a006', 'client_reader'),
  ('00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000a007', 'developer');
insert into public.academy_pulses (id, placement_id, profile_id, period_start) values
  ('00000000-0000-0000-0000-00000000ac51', '00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000a007', current_date);
insert into public.academy_documents (id, title, scope, placement_id, category) values
  ('00000000-0000-0000-0000-00000000ac61', 'Contract summary', 'placement', '00000000-0000-0000-0000-00000000ac91', 'contract_summary');

-- Placement-only and shared tasks for the developer course, module 1.
insert into public.academy_lesson_blocks (id, lesson_id, type, required) values
  ('00000000-0000-0000-0000-00000000a1b8', '00000000-0000-0000-0000-00000000a1e1', 'tasks', false);
insert into public.academy_tasks (id, block_id, title, shared, placement_only) values
  ('00000000-0000-0000-0000-00000000ac71', '00000000-0000-0000-0000-00000000a1b8', 'Put the overlap window in your calendar', false, false),
  ('00000000-0000-0000-0000-00000000ac72', '00000000-0000-0000-0000-00000000a1b8', 'Give the developer repo access', true, true);
reset role;

select pg_temp.check((select role from public.profiles where email = 'dev.ac@example.in') = 'developer', 'developer role kept');
select pg_temp.check((select role from public.profiles where email = 'boss.ac@kg.nl') = 'client', 'client user stays client');
select pg_temp.check((select academy_role from public.academy_members where profile_id = '00000000-0000-0000-0000-00000000a006') = 'client_reader', 'reader added');
select pg_temp.check((select locale from public.academy_members where profile_id = '00000000-0000-0000-0000-00000000a004') = 'nl', 'clients get Dutch');
select pg_temp.check((select locale from public.academy_members where profile_id = '00000000-0000-0000-0000-00000000a008') = 'en', 'candidates get English');
select pg_temp.check(
  (select raw_app_meta_data ->> 'portal_role' from auth.users where email = 'cand.ac@example.in') = 'candidate',
  'the portal role reaches the session token (proxy routing)');

-- ---------------------------------------------------------------------------
-- Candidate: only the open modules of the developer course.
-- ---------------------------------------------------------------------------
select pg_temp.act('cand.ac@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_courses) = 1, 'candidate sees only the developer course');
select pg_temp.check((select slug from public.academy_courses) = 'developer', 'candidate course is the developer course');
select pg_temp.check((select count(*) from public.academy_modules) = 4, 'candidate sees the module titles (locked ones with a lock)');
select pg_temp.check((select count(*) from public.academy_lessons where status = 'draft') = 0, 'candidate sees no draft lessons');
select pg_temp.check(
  (select module_state from public.academy_course_outline((select id from public.academy_courses where slug = 'developer'))
   where module_title = 'Working independently and escalating' limit 1) = 'locked_scope',
  'module 3 is outside the candidate scope');
select pg_temp.check(
  (select count(*) from public.academy_lesson_blocks where id = '00000000-0000-0000-0000-00000000a1b3') = 0,
  'candidate cannot read block content of a locked module');
select pg_temp.check(
  (select count(*) from public.academy_lesson_blocks where id = '00000000-0000-0000-0000-00000000a1b1') = 1,
  'candidate reads block content of module 1');
select pg_temp.check((select count(*) from public.academy_check_questions) = 0, 'candidate reads no check answers');
select pg_temp.check((select count(*) from public.placements) = 0, 'candidate reads no placements');
select pg_temp.check((select count(*) from public.academy_my_placements()) = 0, 'candidate has no placement');
select pg_temp.check((select count(*) from public.academy_placement_members) = 0, 'candidate sees no placement members');
select pg_temp.check((select count(*) from public.academy_documents) = 0, 'candidate sees no placement documents');
select pg_temp.check((select count(*) from public.clients) = 0, 'candidate reads no clients');
select pg_temp.check((select count(*) from public.academy_members) = 1, 'candidate reads only their own academy row');
select pg_temp.check((select count(*) from public.academy_tasks where placement_only) = 0, 'candidate does not see placement-only shared tasks');
select pg_temp.check((select count(*) from public.academy_people_progress()) = 1, 'candidate follows only themselves');

-- Own language yes, own role or start date no.
update public.academy_members set locale = 'nl' where profile_id = '00000000-0000-0000-0000-00000000a008';
select pg_temp.check((select locale from public.academy_members) = 'nl', 'candidate switches language');
do $$ begin
  update public.academy_members set academy_role = 'developer' where profile_id = '00000000-0000-0000-0000-00000000a008';
  raise exception 'FAIL: candidate changed own academy role';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.academy_members set start_date = current_date - 365 where profile_id = '00000000-0000-0000-0000-00000000a008';
  raise exception 'FAIL: candidate changed own start date';
exception when insufficient_privilege then null;
end $$;

-- No self invite and no extra access.
do $$ begin
  perform public.academy_add_person('00000000-0000-0000-0000-00000000a011', 'candidate');
  raise exception 'FAIL: candidate invited someone';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.academy_course_access (course_id, profile_id, scope)
  values ((select id from public.academy_courses where slug = 'developer'), '00000000-0000-0000-0000-00000000a008', 'all');
  raise exception 'FAIL: candidate widened own access';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.academy_open_modules (profile_id, module_id)
  values ('00000000-0000-0000-0000-00000000a008', (select id from public.academy_modules where seed_key = 'developer-3'));
  raise exception 'FAIL: candidate opened a module';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.academy_lesson_progress (profile_id, lesson_id, completed_at)
  values ('00000000-0000-0000-0000-00000000a008', '00000000-0000-0000-0000-00000000a1e1', now());
  raise exception 'FAIL: candidate wrote own completion';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.academy_check_attempts (block_id, profile_id, score, max_score)
  values ('00000000-0000-0000-0000-00000000a1b6', '00000000-0000-0000-0000-00000000a008', 3, 3);
  raise exception 'FAIL: candidate wrote own check score';
exception when insufficient_privilege then null;
end $$;
-- A note on a lesson of a locked module is refused.
do $$ begin
  insert into public.academy_notes (profile_id, lesson_id, body)
  values ('00000000-0000-0000-0000-00000000a008', '00000000-0000-0000-0000-00000000a1e3', 'sneaky');
  raise exception 'FAIL: candidate wrote a note on a locked lesson';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Developer: developer course and own placement, never money.
-- ---------------------------------------------------------------------------
select pg_temp.act('dev.ac@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.placements) = 0, 'developer reads no placements table');
select pg_temp.check((select count(*) from public.academy_my_placements()) = 1, 'developer has one placement');
select pg_temp.check((select my_role from public.academy_my_placements()) = 'developer', 'developer role in placement');
select pg_temp.check((select hours_per_week from public.academy_my_placements()) = 40, 'placement facts: hours');
select pg_temp.check(
  not exists (
    select 1 from public.academy_my_placements() p, jsonb_object_keys(to_jsonb(p)) k
    where k ~ '(rate|salary|cost|fee|compensation|price)'
  ),
  'no money column in academy_my_placements()');
select pg_temp.check((select count(*) from public.academy_placement_people('00000000-0000-0000-0000-00000000ac91')) = 4, 'developer sees the triangle');
select pg_temp.check((select count(*) from public.academy_documents) = 1, 'developer sees the placement document');
select pg_temp.check((select count(*) from public.academy_courses) = 1, 'developer sees only the developer course');

-- Own note, own submission, own pulse, own leave request.
insert into public.academy_notes (profile_id, lesson_id, body)
values ('00000000-0000-0000-0000-00000000a007', '00000000-0000-0000-0000-00000000a1e1', 'private thoughts');
insert into public.academy_assignment_submissions (id, block_id, profile_id, body)
values ('00000000-0000-0000-0000-00000000ac81', '00000000-0000-0000-0000-00000000a1b5', '00000000-0000-0000-0000-00000000a007', 'my answer');
insert into public.academy_pulse_answers (pulse_id, score, friction)
values ('00000000-0000-0000-0000-00000000ac51', 4, 'standups are too early');
insert into public.academy_leave_requests (placement_id, profile_id, start_date, end_date, days)
values ('00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000a007', current_date + 10, current_date + 12, 3);
-- The developer cannot approve or score their own work.
do $$ begin
  update public.academy_assignment_submissions set status = 'approved', final_score = 100
  where id = '00000000-0000-0000-0000-00000000ac81';
  raise exception 'FAIL: developer approved own assignment';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.academy_leave_requests (placement_id, profile_id, start_date, end_date, status)
  values ('00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000a007', current_date, current_date, 'approved');
  raise exception 'FAIL: developer approved own leave';
exception when insufficient_privilege then null;
end $$;
-- Own personal task.
insert into public.academy_task_status (task_id, profile_id, done_at, done_by)
values ('00000000-0000-0000-0000-00000000ac71', '00000000-0000-0000-0000-00000000a007', now(), '00000000-0000-0000-0000-00000000a007');
-- A shared task cannot be ticked as a personal one.
do $$ begin
  insert into public.academy_task_status (task_id, profile_id, done_at)
  values ('00000000-0000-0000-0000-00000000ac72', '00000000-0000-0000-0000-00000000a007', now());
  raise exception 'FAIL: shared task ticked as personal';
exception when insufficient_privilege then null;
end $$;
-- The questionnaire needs consent first.
do $$ begin
  insert into public.academy_questionnaire_responses (block_id, profile_id, answers, submitted_at)
  values ('00000000-0000-0000-0000-00000000a1b7', '00000000-0000-0000-0000-00000000a007', '{"q1": 3}', now());
  raise exception 'FAIL: questionnaire without consent';
exception when insufficient_privilege then null;
end $$;
insert into public.academy_questionnaire_consents (profile_id, block_id) values
  ('00000000-0000-0000-0000-00000000a007', '00000000-0000-0000-0000-00000000a1b7');
insert into public.academy_questionnaire_responses (block_id, profile_id, answers, submitted_at)
values ('00000000-0000-0000-0000-00000000a1b7', '00000000-0000-0000-0000-00000000a007', '{"q1": 3}', now());
select public.academy_open_lesson('00000000-0000-0000-0000-00000000a1e1', (select id from public.academy_courses where slug = 'developer'));
reset role;

-- Nordavo reviews, the AI proposal stays with Nordavo.
select pg_temp.act('hr.ac@nordavo.nl');
set role authenticated;
update public.academy_assignment_submissions set status = 'changes_requested', feedback = 'Be more specific', feedback_by = (select auth.uid()), feedback_at = now()
where id = '00000000-0000-0000-0000-00000000ac81';
insert into public.academy_assignment_assessments (submission_id, ai_total, ai_status) values ('00000000-0000-0000-0000-00000000ac81', 72, 'ready');
select pg_temp.check((select count(*) from public.academy_notes) = 1, 'managers read notes');
select pg_temp.check((select count(*) from public.academy_pulse_answers) = 1, 'managers read pulse answers');
select pg_temp.check((select count(*) from public.academy_questionnaire_responses) = 0, 'academy members without admin read no questionnaire');
reset role;

select pg_temp.act('admin.ac@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_questionnaire_responses) = 1, 'admins read the questionnaire');
select pg_temp.check((select count(*) from public.academy_members) = 6, 'admins read every participant');
reset role;

select pg_temp.act('dev.ac@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_assignment_assessments) = 0, 'developer does not see the AI proposal');
select pg_temp.check((select feedback from public.academy_assignment_submissions) = 'Be more specific', 'developer reads feedback');
-- Re-submit after changes requested.
update public.academy_assignment_submissions set body = 'better answer', status = 'submitted' where id = '00000000-0000-0000-0000-00000000ac81';
reset role;

-- ---------------------------------------------------------------------------
-- Client admin: own placement and progress of colleagues and the developer.
-- ---------------------------------------------------------------------------
select pg_temp.act('boss.ac@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_courses) = 1, 'client admin sees the client course');
select pg_temp.check((select slug from public.academy_courses) = 'client', 'client sees the client course only');
select pg_temp.check((select count(*) from public.placements) = 0, 'client reads no placements table in the academy');
select pg_temp.check((select count(*) from public.academy_my_placements()) = 1, 'client admin has the placement');
select pg_temp.check((select developer_name from public.academy_my_placements()) = 'Asha', 'client sees the developer name');
select pg_temp.check((select count(*) from public.academy_lesson_progress where profile_id = '00000000-0000-0000-0000-00000000a007') = 1,
  'client admin sees developer progress');
select pg_temp.check((select count(*) from public.academy_notes) = 0, 'client admin never reads notes');
select pg_temp.check((select count(*) from public.academy_assignment_submissions) = 0, 'client admin never reads answers');
select pg_temp.check((select count(*) from public.academy_pulse_answers) = 0, 'pulse scores are only for Nordavo');
select pg_temp.check((select count(*) from public.academy_pulses) = 0, 'client does not see the developer pulse');
select pg_temp.check((select count(*) from public.academy_leave_requests) = 1, 'client sees the leave request');
select pg_temp.check((select count(*) from public.academy_task_status where profile_id = '00000000-0000-0000-0000-00000000a007') = 1,
  'client sees developer task progress');
select pg_temp.check(
  (select count(*) from public.academy_people_progress() where profile_id = '00000000-0000-0000-0000-00000000a007') = 1,
  'client admin follows the developer');
select pg_temp.check(
  (select count(*) from public.academy_people_progress() where profile_id = '00000000-0000-0000-0000-00000000a005') = 1,
  'client admin follows colleagues');
select pg_temp.check(
  (select count(*) from public.academy_people_progress() where profile_id = '00000000-0000-0000-0000-00000000a009') = 0,
  'client admin does not follow another client');
-- The client ticks off the shared task of the placement.
insert into public.academy_task_status (task_id, placement_id, done_at, done_by)
values ('00000000-0000-0000-0000-00000000ac72', '00000000-0000-0000-0000-00000000ac91', now(), (select auth.uid()));
select pg_temp.check((select count(*) from public.academy_tasks where id = '00000000-0000-0000-0000-00000000ac72') = 1,
  'client sees the shared task of the placement');
-- A client cannot add people or create content.
do $$ begin
  perform public.academy_add_person('00000000-0000-0000-0000-00000000a011', 'client_member', null, null, '00000000-0000-0000-0000-00000000ac01');
  raise exception 'FAIL: client invited a colleague';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.academy_lessons (title) values ('mine');
  raise exception 'FAIL: client created a lesson';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.academy_placement_members (placement_id, profile_id, role)
  values ('00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000a009', 'client_admin');
  raise exception 'FAIL: client added someone to the placement';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Client member: own course, the placement, but not the progress of others.
select pg_temp.act('manager.ac@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_courses) = 1, 'client member follows the client course');
select pg_temp.check((select count(*) from public.academy_lesson_progress where profile_id = '00000000-0000-0000-0000-00000000a007') = 0,
  'client member does not see developer progress');
select pg_temp.check((select count(*) from public.academy_people_progress()) = 1, 'client member follows only themselves');
reset role;

-- Reader (meelezer): progress and scores, never answers or notes.
select pg_temp.act('board.ac@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_courses) = 0, 'reader follows no course');
select pg_temp.check((select count(*) from public.academy_lesson_progress where profile_id = '00000000-0000-0000-0000-00000000a007') = 1,
  'reader sees developer progress');
select pg_temp.check(
  (select count(*) from public.academy_people_progress() where profile_id = '00000000-0000-0000-0000-00000000a007') = 1,
  'reader follows the developer');
select pg_temp.check((select count(*) from public.academy_notes) = 0, 'reader never reads notes');
select pg_temp.check((select count(*) from public.academy_assignment_submissions) = 0, 'reader never reads assignments');
select pg_temp.check((select count(*) from public.academy_worksheet_answers) = 0, 'reader never reads worksheets');
select pg_temp.check((select count(*) from public.academy_check_attempts) = 0, 'reader never reads check answers');
select pg_temp.check((select count(*) from public.academy_reviews) = 0, 'reader reads no reviews');
do $$ begin
  insert into public.academy_ritual_logs (ritual_id, placement_id, profile_id, period_date)
  select r.id, '00000000-0000-0000-0000-00000000ac91', '00000000-0000-0000-0000-00000000a006', current_date
  from public.academy_rituals r limit 1;
  if found then raise exception 'FAIL: reader logged a ritual'; end if;
exception when insufficient_privilege then null;
end $$;
reset role;

-- Another client sees nothing of KG.
select pg_temp.act('other.ac@acme.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_my_placements()) = 0, 'other client has no KG placement');
select pg_temp.check((select count(*) from public.academy_lesson_progress where profile_id <> (select auth.uid())) = 0, 'other client sees no KG progress');
select pg_temp.check((select count(*) from public.academy_leave_requests) = 0, 'other client sees no KG leave');
select pg_temp.check((select count(*) from public.academy_placement_people('00000000-0000-0000-0000-00000000ac91')) = 0, 'other client sees no KG people');
select pg_temp.check((select count(*) from public.academy_documents) = 0, 'other client sees no KG documents');
reset role;

-- Work only: nothing.
select pg_temp.act('guest.ac@freelance.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_courses) = 0, 'guest sees no courses');
select pg_temp.check((select count(*) from public.academy_modules) = 0, 'guest sees no modules');
select pg_temp.check((select count(*) from public.academy_my_courses()) = 0, 'guest has no courses');
select pg_temp.check((select count(*) from public.academy_holidays) = 0, 'no holidays yet, but readable');
reset role;

-- ---------------------------------------------------------------------------
-- Notifications: own, only read_at.
-- ---------------------------------------------------------------------------
select public.academy_notify('00000000-0000-0000-0000-00000000a007', 'task_overdue', 'A task is overdue', null, '/academy');
select public.academy_notify('00000000-0000-0000-0000-00000000a008', 'welcome', 'Welcome', null, '/academy');
select pg_temp.act('dev.ac@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_notifications) = 1, 'own notifications only');
update public.academy_notifications set read_at = now();
select pg_temp.check((select read_at is not null from public.academy_notifications), 'mark as read');
do $$ begin
  update public.academy_notifications set title = 'changed';
  raise exception 'FAIL: user changed a notification';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.academy_notify('00000000-0000-0000-0000-00000000a008', 'spam', 'spam');
  raise exception 'FAIL: user sent a notification';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Adding people: guard rails.
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.ac@nordavo.nl');
set role authenticated;
do $$ begin
  perform public.academy_add_person('00000000-0000-0000-0000-00000000a011', 'client_member');
  raise exception 'FAIL: client user without client';
exception when others then
  if sqlerrm not like '%linked to a client%' then raise; end if;
end $$;
do $$ begin
  perform public.academy_add_person('00000000-0000-0000-0000-00000000a004', 'developer');
  raise exception 'FAIL: client turned into developer';
exception when others then
  if sqlerrm not like '%client user%' then raise; end if;
end $$;
-- The team keeps its role.
select public.academy_add_person('00000000-0000-0000-0000-00000000a003', 'client_member', null, null, '00000000-0000-0000-0000-00000000ac01');
select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-00000000a003') = 'member', 'team member keeps role');
-- A developer stays a developer when added again as candidate.
select public.academy_add_person('00000000-0000-0000-0000-00000000a007', 'candidate');
select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-00000000a007') = 'developer', 'developer not demoted');
select pg_temp.check((select academy_role from public.academy_members where profile_id = '00000000-0000-0000-0000-00000000a007') = 'developer', 'academy role not demoted');
-- Candidate upgraded to developer with full access; earlier progress stays.
select public.academy_add_person('00000000-0000-0000-0000-00000000a008', 'developer', null, current_date, null, null,
  (select id from public.academy_courses where slug = 'developer'), 'all', '{}');
select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-00000000a008') = 'developer', 'candidate becomes developer');
select pg_temp.check((select scope from public.academy_course_access where profile_id = '00000000-0000-0000-0000-00000000a008') = 'all', 'developer gets the whole course');
select pg_temp.check((select candidate_id from public.academy_members where profile_id = '00000000-0000-0000-0000-00000000a008') = '00000000-0000-0000-0000-00000000acd2', 'candidate link kept');
-- Open modules must belong to the course.
do $$ begin
  perform public.academy_add_person('00000000-0000-0000-0000-00000000a011', 'candidate', null, null, null, null,
    (select id from public.academy_courses where slug = 'developer'), 'default',
    array[(select id from public.academy_modules where seed_key = 'client-5')]);
  raise exception 'FAIL: module of another course';
exception when others then
  if sqlerrm not like '%not part of this course%' then raise; end if;
end $$;
reset role;

-- Settings: admins can give the new roles; the module list accepts academy.
select pg_temp.act('admin.ac@nordavo.nl');
set role authenticated;
select public.admin_update_profile('00000000-0000-0000-0000-00000000a011', 'candidate', null);
select public.admin_set_profile_modules('00000000-0000-0000-0000-00000000a002', array['academy']);
reset role;
select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-00000000a011') = 'candidate', 'admin sets candidate role');
select pg_temp.check((select modules from public.profiles where id = '00000000-0000-0000-0000-00000000a002') = array['academy'], 'module academy alone');

rollback;
