-- Academy and the ATS (supabase/migrations/20261113300000_academy_ats_core.sql,
-- 20261113310000_academy_ats_read.sql, 20261113320000_academy_ats_manage.sql):
-- who reads and changes what, enrolment from the ATS, top candidates, the
-- talent pool columns with sort and filter, status placed (idempotent),
-- automatic enrolment on a vacancy, reminders, retention, AI drafts and the
-- overviews. One transaction, rolled back at the end.

begin;

-- Start from empty course content: the start curriculum (seeded by
-- 20261114000000_academy_start_content.sql) would change the counts below.
-- The courses and modules stay; everything is rolled back at the end.
delete from public.academy_lessons;
delete from public.academy_documents;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000c001', 'hr.ats@nordavo.nl', '{"full_name": "HR"}'),
  ('00000000-0000-0000-0000-00000000c002', 'rec.ats@nordavo.nl', '{"full_name": "Recruiter"}'),
  ('00000000-0000-0000-0000-00000000c003', 'sales.ats@nordavo.nl', '{"full_name": "Sales"}'),
  ('00000000-0000-0000-0000-00000000c004', 'ravi.ats@example.in', '{"full_name": "Ravi"}'),
  ('00000000-0000-0000-0000-00000000c005', 'boss.ats@kg.nl', '{"full_name": "Klant Beheer"}'),
  ('00000000-0000-0000-0000-00000000c006', 'lid.ats@kg.nl', '{"full_name": "Klant Lid"}'),
  ('00000000-0000-0000-0000-00000000c007', 'stuck.ats@example.in', '{"full_name": "Stuck"}'),
  ('00000000-0000-0000-0000-00000000c008', 'old.ats@example.in', '{"full_name": "Old"}'),
  ('00000000-0000-0000-0000-00000000c009', 'busy.ats@example.in', '{"full_name": "Busy"}'),
  ('00000000-0000-0000-0000-00000000c00a', 'linked.ats@example.in', '{"full_name": "Linked"}');

update public.profiles set role = 'member', modules = array['recruitment', 'academy'] where email = 'hr.ats@nordavo.nl';
update public.profiles set role = 'member', modules = array['recruitment'] where email = 'rec.ats@nordavo.nl';
update public.profiles set role = 'member', modules = array['sales'] where email = 'sales.ats@nordavo.nl';

insert into public.clients (id, name, status) values ('00000000-0000-0000-0000-0000000cc001', 'KG', 'active');
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000cc001'
  where email in ('boss.ats@kg.nl', 'lid.ats@kg.nl');

insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000c7001', '00000000-0000-0000-0000-0000000cc001', 'Backend'),
  ('00000000-0000-0000-0000-0000000c7002', '00000000-0000-0000-0000-0000000cc001', 'Data');

insert into public.candidates (id, full_name, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000ca001', 'Ravi Kumar', 'ravi.ats@example.in', now(), now()),
  ('00000000-0000-0000-0000-0000000ca002', 'Mina Rao', 'mina.ats@example.in', now(), now()),
  ('00000000-0000-0000-0000-0000000ca003', 'Stuck Person', 'stuck.ats@example.in', now(), now()),
  ('00000000-0000-0000-0000-0000000ca004', 'Old Person', 'old.ats@example.in', now() - interval '2 years', now() - interval '2 years'),
  ('00000000-0000-0000-0000-0000000ca005', 'Busy Person', 'busy.ats@example.in', now() - interval '2 years', now() - interval '2 years'),
  ('00000000-0000-0000-0000-0000000ca006', 'Linked Person', 'linked.ats@example.in', now(), now());

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

-- True when the statement fails with insufficient privilege (or a raised 42501).
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
end $$;

-- A pool row for one candidate.
create or replace function pg_temp.pool(p_candidate uuid) returns jsonb language sql as $$
  select to_jsonb(p) from public.academy_ats_pool(p_limit => 500) p where p.candidate_id = p_candidate;
$$;

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.denied(text), pg_temp.pool(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The start curriculum, published with lessons (rolled back at the end).
-- ---------------------------------------------------------------------------
update public.academy_courses set status = 'published' where slug in ('developer', 'client');

insert into public.academy_videos (id, title) values ('00000000-0000-0000-0000-0000000cd001', 'Welcome video');
insert into public.academy_video_versions (id, video_id, version, storage_path, duration_seconds) values
  ('00000000-0000-0000-0000-0000000cd011', '00000000-0000-0000-0000-0000000cd001', 1, 'academy/video/x/v1.mp4', 100);
update public.academy_videos set current_version_id = '00000000-0000-0000-0000-0000000cd011' where id = '00000000-0000-0000-0000-0000000cd001';

insert into public.academy_lessons (id, title, status) values
  ('00000000-0000-0000-0000-0000000ce001', 'Welcome', 'published'),
  ('00000000-0000-0000-0000-0000000ce002', 'How we work', 'published'),
  ('00000000-0000-0000-0000-0000000ce003', 'Escalating', 'published'),
  ('00000000-0000-0000-0000-0000000ce004', 'Voordat je begint', 'published');
insert into public.academy_module_lessons (module_id, lesson_id, position)
select m.id, l.lesson_id, l.position
from (values ('developer-1', '00000000-0000-0000-0000-0000000ce001'::uuid, 1),
             ('developer-1', '00000000-0000-0000-0000-0000000ce002'::uuid, 2),
             ('developer-3', '00000000-0000-0000-0000-0000000ce003'::uuid, 1),
             ('client-1', '00000000-0000-0000-0000-0000000ce004'::uuid, 1)) as l (seed_key, lesson_id, position)
join public.academy_modules m on m.seed_key = l.seed_key;

insert into public.academy_lesson_blocks (id, lesson_id, type, position, required, video_id, content) values
  ('00000000-0000-0000-0000-0000000cb001', '00000000-0000-0000-0000-0000000ce001', 'explanation', 1, true, null, '{"html": "<p>Hi</p>"}'),
  ('00000000-0000-0000-0000-0000000cb002', '00000000-0000-0000-0000-0000000ce001', 'video', 2, false, '00000000-0000-0000-0000-0000000cd001', '{}'),
  ('00000000-0000-0000-0000-0000000cb003', '00000000-0000-0000-0000-0000000ce001', 'knowledge_check', 3, false, null, '{}'),
  ('00000000-0000-0000-0000-0000000cb004', '00000000-0000-0000-0000-0000000ce001', 'assignment', 4, false, null, '{"prompt": "Write"}'),
  ('00000000-0000-0000-0000-0000000cb005', '00000000-0000-0000-0000-0000000ce001', 'tasks', 5, false, null, '{}'),
  ('00000000-0000-0000-0000-0000000cb006', '00000000-0000-0000-0000-0000000ce004', 'tasks', 1, false, null, '{}');
insert into public.academy_tasks (id, block_id, title, deadline_offset_days, shared, placement_only) values
  ('00000000-0000-0000-0000-0000000cf001', '00000000-0000-0000-0000-0000000cb005', 'Calendar', 0, false, false),
  ('00000000-0000-0000-0000-0000000cf002', '00000000-0000-0000-0000-0000000cb005', 'Repo access', 7, true, false),
  ('00000000-0000-0000-0000-0000000cf003', '00000000-0000-0000-0000-0000000cb005', 'Meet the team', null, false, true),
  ('00000000-0000-0000-0000-0000000cf004', '00000000-0000-0000-0000-0000000cb006', 'Plan the first week', 0, false, false);

insert into public.academy_rituals (course_id, title, cadence, weekday, audience)
select id, 'Week plan', 'weekly', 1, 'both' from public.academy_courses where slug = 'developer';

-- The seed: developer module 3 opens for top candidates.
select pg_temp.check(
  (select top_candidate_module_ids from public.academy_ats_settings)
    = array[(select id from public.academy_modules where seed_key = 'developer-3')],
  'top candidates get developer module 3 by default');
select pg_temp.check(public.academy_ats_developer_course() = (select id from public.academy_courses where slug = 'developer'), 'developer course from the slug');
select pg_temp.check(public.academy_ats_client_course() = (select id from public.academy_courses where slug = 'client'), 'client course from the slug');
select pg_temp.check(public.academy_ats_deadline('2026-12-01', 0, 'Asia/Kolkata') = '2026-12-01 18:29:59+00', 'day 1 ends at midnight in India');
select pg_temp.check(public.academy_ats_deadline('2026-12-01', 7, 'Europe/Amsterdam') = '2026-12-08 22:59:59+00', 'week 2 ends at midnight in Amsterdam');
select pg_temp.check(public.job_module('academy-reminders') = 'academy', 'academy jobs are module academy');
select pg_temp.check(public.job_module('forms-reminders') = 'recruitment', 'other jobs keep their module');

-- ---------------------------------------------------------------------------
-- Who reads and changes what.
-- ---------------------------------------------------------------------------
select pg_temp.act('sales.ats@nordavo.nl');
set role authenticated;
select pg_temp.check(not public.academy_ats_can_read(), 'sales does not read Academy results');
select pg_temp.check((select count(*) from public.academy_ats_settings) = 0, 'sales sees no settings');
select pg_temp.check((select count(*) from public.academy_ats_pool()) = 0, 'sales gets an empty pool');
select pg_temp.check(public.academy_ats_candidate_detail('00000000-0000-0000-0000-0000000ca001') is null, 'sales gets no candidate card');
select pg_temp.check((select count(*) from public.academy_admin_people()) = 0, 'sales gets no overview');
select pg_temp.check((select count(*) from public.academy_ats_columns(array['00000000-0000-0000-0000-0000000ca001'::uuid])) = 0, 'sales gets no list columns');
select pg_temp.check((select count(*) from public.academy_candidate_names(array['00000000-0000-0000-0000-0000000ca001'::uuid])) = 0, 'sales gets no candidate names');
select pg_temp.check((select count(*) from public.academy_lesson_funnel(public.academy_ats_developer_course())) = 0, 'sales gets no funnel');
select pg_temp.check(public.academy_group_report('00000000-0000-0000-0000-0000000c6001') is null, 'sales gets no group report');
select pg_temp.check((select count(*) from public.academy_admin_rollup('client')) = 0, 'sales gets no rollup');
select pg_temp.check(pg_temp.denied($$select public.academy_ats_queue_enrol(array['00000000-0000-0000-0000-0000000ca001'::uuid])$$), 'sales cannot enrol');
reset role;

select pg_temp.act('rec.ats@nordavo.nl');
set role authenticated;
select pg_temp.check(public.academy_ats_can_read(), 'recruitment reads Academy results');
select pg_temp.check((select count(*) from public.academy_ats_settings) = 1, 'recruitment reads the settings');
select pg_temp.check((select count(*) from public.academy_ats_pool(p_limit => 500)) = 6, 'recruitment sees every candidate in the pool');
update public.academy_ats_settings set reminder_max = 9;
select pg_temp.check(pg_temp.denied($$select public.academy_ats_enrol('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-0000000ca001')$$), 'recruitment alone cannot enrol');
select pg_temp.check(pg_temp.denied($$select public.academy_ats_enrol_core('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-0000000ca001')$$), 'the core function is internal');
select pg_temp.check(pg_temp.denied($$select public.academy_stuck_candidates()$$), 'reminders are for the job');
select pg_temp.check(pg_temp.denied($$select public.academy_retention_candidates()$$), 'retention is for the job');
select pg_temp.check((select count(*) from public.academy_admin_people()) = 0, 'recruitment alone gets no Academy overview');
select pg_temp.check(not public.can_see_job('academy-reminders'), 'recruitment alone cannot run academy jobs');
reset role;
select pg_temp.check((select reminder_max from public.academy_ats_settings) = 3, 'recruitment cannot change the settings');

select pg_temp.act('hr.ats@nordavo.nl');
set role authenticated;
update public.academy_ats_settings set reminder_after_days = 7, reminder_repeat_days = 7, reminder_max = 3;
select pg_temp.check((select updated_at > now() - interval '1 minute' from public.academy_ats_settings), 'managers change the settings');
select pg_temp.check(public.can_see_job('academy-reminders'), 'managers run academy jobs');
select pg_temp.check((select full_name from public.academy_candidate_names(array['00000000-0000-0000-0000-0000000ca001'::uuid])) = 'Ravi Kumar', 'managers get candidate names for the log');

-- ---------------------------------------------------------------------------
-- Enrolment from the ATS.
-- ---------------------------------------------------------------------------
select public.academy_ats_enrol('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-0000000ca001');
reset role;
select pg_temp.check((select role from public.profiles where email = 'ravi.ats@example.in') = 'candidate', 'external account becomes candidate');
select pg_temp.check((select time_zone from public.profiles where email = 'ravi.ats@example.in') = 'Asia/Kolkata', 'candidates in the India time zone');
select pg_temp.check((select academy_role = 'candidate' and candidate_id = '00000000-0000-0000-0000-0000000ca001'
  from public.academy_members where profile_id = '00000000-0000-0000-0000-00000000c004'), 'Academy row linked to the ATS candidate');
select pg_temp.check((select scope from public.academy_course_access where profile_id = '00000000-0000-0000-0000-00000000c004'
  and course_id = public.academy_ats_developer_course()) = 'default', 'developer course with the default modules');

select pg_temp.act('hr.ats@nordavo.nl');
set role authenticated;
do $$ begin
  perform public.academy_ats_enrol('00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-0000000ca001');
  raise exception 'FAIL: a candidate links to one account only';
exception when others then
  if sqlerrm not like '%already linked%' then raise; end if;
end $$;
do $$ begin
  perform public.academy_ats_enrol('00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-0000000ca002');
  raise exception 'FAIL: client users are refused';
exception when others then
  if sqlerrm not like '%client user%' then raise; end if;
end $$;
select public.academy_ats_enrol('00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-0000000ca003');
select public.academy_ats_enrol('00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-0000000ca004');
select public.academy_ats_enrol('00000000-0000-0000-0000-00000000c009', '00000000-0000-0000-0000-0000000ca005');

-- Queue: one open enrolment per candidate.
select pg_temp.check(public.academy_ats_queue_enrol(array['00000000-0000-0000-0000-0000000ca002'::uuid], null, '{}', true) = 1, 'one enrolment queued');
select pg_temp.check(public.academy_ats_queue_enrol(array['00000000-0000-0000-0000-0000000ca002'::uuid], null, '{}', true) = 0, 'not queued twice');
reset role;

-- ---------------------------------------------------------------------------
-- Top candidate: marked by recruitment, modules open, mail queued.
-- ---------------------------------------------------------------------------
select pg_temp.act('rec.ats@nordavo.nl');
set role authenticated;
update public.candidates set top_candidate = true where id = '00000000-0000-0000-0000-0000000ca001';
update public.candidates set top_candidate = true where id = '00000000-0000-0000-0000-0000000ca002';
reset role;
select pg_temp.check((select top_candidate_at is not null from public.candidates where id = '00000000-0000-0000-0000-0000000ca001'), 'marking keeps the date');
select pg_temp.check(exists (select 1 from public.academy_open_modules o join public.academy_modules m on m.id = o.module_id
  where o.profile_id = '00000000-0000-0000-0000-00000000c004' and m.seed_key = 'developer-3' and not o.force), 'module 3 open for the top candidate');
select pg_temp.check((select status from public.academy_ats_events where kind = 'top_candidate'
  and candidate_id = '00000000-0000-0000-0000-0000000ca001') = 'pending', 'the mail waits for the app');
select pg_temp.check((select status from public.academy_ats_events where kind = 'top_candidate'
  and candidate_id = '00000000-0000-0000-0000-0000000ca002') = 'skipped', 'not in the Academy: nothing to mail');
select pg_temp.check(exists (select 1 from public.academy_notifications where profile_id = '00000000-0000-0000-0000-00000000c004' and kind = 'top_candidate'), 'in-app notification');

select pg_temp.act('ravi.ats@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_ats_events) = 0, 'candidates read no events');
select pg_temp.check((select count(*) from public.academy_ats_settings) = 0, 'candidates read no settings');
select pg_temp.check((select count(*) from public.academy_ats_pool()) = 0, 'candidates get no pool');
select pg_temp.check(public.academy_person_detail('00000000-0000-0000-0000-00000000c004') is null, 'candidates get no detail, not even their own');
-- Learning: lesson 1 (explanation required) and lesson 2 (nothing required).
select public.academy_open_lesson('00000000-0000-0000-0000-0000000ce001');
select public.academy_record_block_view('00000000-0000-0000-0000-0000000cb001');
select public.academy_open_lesson('00000000-0000-0000-0000-0000000ce002');
select public.academy_record_watch('00000000-0000-0000-0000-0000000cd001', '00000000-0000-0000-0000-0000000cd011', 50, 50, 50);
reset role;

insert into public.academy_check_attempts (block_id, profile_id, score, max_score) values
  ('00000000-0000-0000-0000-0000000cb003', '00000000-0000-0000-0000-00000000c004', 1, 3),
  ('00000000-0000-0000-0000-0000000cb003', '00000000-0000-0000-0000-00000000c004', 2, 3);
insert into public.academy_assignment_submissions (id, block_id, profile_id, body, status, final_score, feedback_at) values
  ('00000000-0000-0000-0000-0000000c5001', '00000000-0000-0000-0000-0000000cb004', '00000000-0000-0000-0000-00000000c004', 'My answer', 'approved', 80, now());
insert into public.academy_assignment_assessments (submission_id, ai_total, ai_status) values
  ('00000000-0000-0000-0000-0000000c5001', 70, 'ready');
-- The stuck candidate handed in and waits for a reply.
insert into public.academy_assignment_submissions (block_id, profile_id, body) values
  ('00000000-0000-0000-0000-0000000cb004', '00000000-0000-0000-0000-00000000c007', 'Waiting');

-- ---------------------------------------------------------------------------
-- Talent pool: columns, sort, filter (recruitment).
-- ---------------------------------------------------------------------------
select pg_temp.act('rec.ats@nordavo.nl');
set role authenticated;
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'lessons_total')::int = 3, 'three published lessons');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'lessons_done')::int = 2, 'two lessons done');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'progress_percent')::int = 66, 'progress in percent');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'modules_done')::int = 1, 'module 1 done');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'check_avg_percent')::int = 33, 'first knowledge check attempt counts (33, not the best 67)');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'ai_avg_score')::int = 70, 'AI proposal score');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'final_avg_score')::int = 80, 'final score');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'watch_avg_percent')::int = 50, 'watch percent');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'inactive_14d')::boolean = false, 'active');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca001') ->> 'lead_time_days')::int = 0, 'lead time so far');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca002') ->> 'enrolled')::boolean = false, 'Mina is not enrolled');
select pg_temp.check((pg_temp.pool('00000000-0000-0000-0000-0000000ca003') ->> 'assignments_waiting')::int = 1, 'assignment waiting for a reply');

select pg_temp.check((select candidate_id from public.academy_ats_pool(p_sort => 'progress', p_desc => true) limit 1)
  = '00000000-0000-0000-0000-0000000ca001', 'sort by progress');
select pg_temp.check((select count(*) from public.academy_ats_pool(p_enrolled => false)) = 2, 'filter on not enrolled');
select pg_temp.check((select count(*) from public.academy_ats_pool(p_min_check => 40)) = 0, 'filter on check score (first attempt 33)');
select pg_temp.check((select count(*) from public.academy_ats_pool(p_min_check => 30)) = 1, 'filter on check score, met');
select pg_temp.check((select count(*) from public.academy_ats_pool(p_state => 'in_progress')) = 2, 'filter on started (handing in starts the lesson)');
select pg_temp.check((select count(*) from public.academy_ats_pool(p_state => 'not_started')) = 2, 'enrolled but not started');
select pg_temp.check((select count(*) from public.academy_ats_pool(p_top => true)) = 2, 'filter on top candidate');
select pg_temp.check((select count(*) from public.academy_ats_pool(p_search => 'ravi')) = 1, 'search by name');
select pg_temp.check((select total_count from public.academy_ats_pool(p_limit => 2) limit 1) = 6, 'total before paging');
select pg_temp.check((select count(*) from public.academy_ats_pool(p_limit => 2, p_offset => 4)) = 2, 'paging');
select pg_temp.check((select count(*) from public.academy_ats_columns(array['00000000-0000-0000-0000-0000000ca001'::uuid, '00000000-0000-0000-0000-0000000ca002'::uuid])) = 2, 'columns for a page of the list');

-- The card.
select pg_temp.check((public.academy_ats_candidate_detail('00000000-0000-0000-0000-0000000ca001') -> 'person' -> 'assignments' -> 0 ->> 'ai_total')::int = 70, 'card: assignment with AI score');
select pg_temp.check(jsonb_array_length(public.academy_ats_candidate_detail('00000000-0000-0000-0000-0000000ca001') -> 'person' -> 'lessons') = 2, 'card: lessons with dates');
select pg_temp.check((public.academy_ats_candidate_detail('00000000-0000-0000-0000-0000000ca001') -> 'person' -> 'checks' -> 0 ->> 'attempts')::int = 2, 'card: check attempts');
select pg_temp.check((public.academy_ats_candidate_detail('00000000-0000-0000-0000-0000000ca001') -> 'person' -> 'videos' -> 0 ->> 'percent')::int = 50, 'card: watch percent per video');
select pg_temp.check(jsonb_array_length(public.academy_ats_candidate_detail('00000000-0000-0000-0000-0000000ca001') -> 'events') >= 1, 'card: automation events');
reset role;

-- ---------------------------------------------------------------------------
-- Status placed: developer, client, placement page data. Idempotent.
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.ats@nordavo.nl');
set role authenticated;
select public.academy_add_person('00000000-0000-0000-0000-00000000c006', 'client_member', null, null, '00000000-0000-0000-0000-0000000cc001');
reset role;

insert into public.placements (id, client_id, candidate_id, vacancy_id, start_date) values
  ('00000000-0000-0000-0000-0000000c9001', '00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-0000000ca001',
   '00000000-0000-0000-0000-0000000c7001', current_date + 7);
select pg_temp.check((select status from public.academy_ats_events where dedupe_key = 'placed:00000000-0000-0000-0000-0000000c9001') = 'pending', 'placement queued for the app');
-- What the app (service role) does first: the database part.
select public.academy_ats_event_note(
  (select id from public.academy_ats_events where dedupe_key = 'placed:00000000-0000-0000-0000-0000000c9001'),
  jsonb_build_object('database', public.academy_ats_apply_placement('00000000-0000-0000-0000-0000000c9001')));

select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-00000000c004') = 'developer', 'candidate account becomes developer');
select pg_temp.check((select academy_role = 'developer' and start_date = current_date + 7 from public.academy_members
  where profile_id = '00000000-0000-0000-0000-00000000c004'), 'developer with the start date of the placement');
select pg_temp.check((select scope from public.academy_course_access where profile_id = '00000000-0000-0000-0000-00000000c004'
  and course_id = public.academy_ats_developer_course()) = 'all', 'the whole developer course');
select pg_temp.check((select count(*) from public.academy_lesson_progress where profile_id = '00000000-0000-0000-0000-00000000c004'
  and completed_at is not null) = 2, 'completed progress kept');
select pg_temp.check(public.academy_placement_role('00000000-0000-0000-0000-0000000c9001', '00000000-0000-0000-0000-00000000c004') = 'developer', 'developer in the placement');
select pg_temp.check(public.academy_placement_role('00000000-0000-0000-0000-0000000c9001', '00000000-0000-0000-0000-00000000c006') = 'client_member', 'colleague of the client in the placement');
select pg_temp.check((select count(*) from public.academy_milestones where placement_id = '00000000-0000-0000-0000-0000000c9001') = 4, 'four milestones');
select pg_temp.check((select due_date from public.academy_milestones where placement_id = '00000000-0000-0000-0000-0000000c9001' and kind = 'day_90') = current_date + 96, '90 day review');
select pg_temp.check((select count(*) from public.academy_rituals where placement_id = '00000000-0000-0000-0000-0000000c9001') = 1, 'rituals from the course template');
select pg_temp.check((select due_at from public.academy_task_status where task_id = '00000000-0000-0000-0000-0000000cf001'
  and profile_id = '00000000-0000-0000-0000-00000000c004') = public.academy_ats_deadline(current_date + 7, 0, 'Asia/Kolkata'), 'relative deadline gets a real date');
select pg_temp.check((select due_at from public.academy_task_status where task_id = '00000000-0000-0000-0000-0000000cf002'
  and placement_id = '00000000-0000-0000-0000-0000000c9001' and profile_id is null) = public.academy_ats_deadline(current_date + 7, 7, 'Europe/Amsterdam'), 'shared task for the placement');
select pg_temp.check((select status from public.academy_ats_events where dedupe_key = 'placed:00000000-0000-0000-0000-0000000c9001') = 'pending', 'placed waits for the app (client contact, mail)');
select pg_temp.check((select result -> 'database' ->> 'developer' from public.academy_ats_events where dedupe_key = 'placed:00000000-0000-0000-0000-0000000c9001') = 'ok', 'database part logged');

-- The app made the client contact's account; run it again with it.
select public.academy_ats_apply_placement('00000000-0000-0000-0000-0000000c9001', '00000000-0000-0000-0000-00000000c005');
select public.academy_ats_apply_placement('00000000-0000-0000-0000-0000000c9001', '00000000-0000-0000-0000-00000000c005');
select pg_temp.check((select academy_role from public.academy_members where profile_id = '00000000-0000-0000-0000-00000000c005') = 'client_admin', 'client contact is client admin');
select pg_temp.check((select academy_role from public.academy_members where profile_id = '00000000-0000-0000-0000-00000000c006') = 'client_member', 'an existing client role stays');
select pg_temp.check((select scope from public.academy_course_access where profile_id = '00000000-0000-0000-0000-00000000c005'
  and course_id = public.academy_ats_client_course()) = 'all', 'client gets the client course');
select pg_temp.check(public.academy_placement_role('00000000-0000-0000-0000-0000000c9001', '00000000-0000-0000-0000-00000000c005') = 'client_admin', 'client admin in the placement');
select pg_temp.check((select count(*) from public.academy_milestones where placement_id = '00000000-0000-0000-0000-0000000c9001') = 4, 'milestones not doubled');
select pg_temp.check((select count(*) from public.academy_rituals where placement_id = '00000000-0000-0000-0000-0000000c9001')
  = (select count(*) from public.academy_rituals where placement_id is null and active
     and course_id in (public.academy_ats_developer_course(), public.academy_ats_client_course())), 'one copy per ritual template of the courses in the placement');
select public.academy_ats_apply_placement('00000000-0000-0000-0000-0000000c9001', '00000000-0000-0000-0000-00000000c005');
select pg_temp.check((select count(*) from public.academy_rituals where placement_id = '00000000-0000-0000-0000-0000000c9001')
  = (select count(*) from public.academy_rituals where placement_id is null and active
     and course_id in (public.academy_ats_developer_course(), public.academy_ats_client_course())), 'rituals not doubled');
select pg_temp.check((select count(*) from public.academy_task_status where task_id = '00000000-0000-0000-0000-0000000cf002') = 1, 'shared task not doubled');
select pg_temp.check(exists (select 1 from public.academy_task_status where task_id = '00000000-0000-0000-0000-0000000cf004'
  and profile_id = '00000000-0000-0000-0000-00000000c005' and due_at is not null), 'client task with a real date');
select pg_temp.check((select count(*) from public.academy_ats_events where placement_id = '00000000-0000-0000-0000-0000000c9001') = 1, 'one event per placement');

select pg_temp.act('ravi.ats@example.in');
set role authenticated;
select pg_temp.check(public.academy_task_open('00000000-0000-0000-0000-0000000cf003'), 'placement-only task visible after placement');
reset role;

select pg_temp.act('rec.ats@nordavo.nl');
set role authenticated;
select pg_temp.check(pg_temp.denied($$select public.academy_ats_rerun_placement('00000000-0000-0000-0000-0000000c9001')$$), 'recruitment alone cannot rerun');
reset role;
select pg_temp.act('hr.ats@nordavo.nl');
set role authenticated;
select pg_temp.check((public.academy_ats_rerun_placement('00000000-0000-0000-0000-0000000c9001') ->> 'milestones_added')::int = 0, 'rerun adds nothing');
reset role;

-- ---------------------------------------------------------------------------
-- Linked to a vacancy whose group enrols automatically.
-- ---------------------------------------------------------------------------
insert into public.academy_groups (id, name, kind, vacancy_id) values
  ('00000000-0000-0000-0000-0000000c6001', 'Backend 2026', 'vacancy', '00000000-0000-0000-0000-0000000c7001');
insert into public.academy_group_settings (group_id, auto_enrol) values ('00000000-0000-0000-0000-0000000c6001', true);
-- Linked has an account but no Academy row: the app enrols (pending).
insert into public.applications (vacancy_id, candidate_id) values
  ('00000000-0000-0000-0000-0000000c7001', '00000000-0000-0000-0000-0000000ca006'),
  -- Stuck is in the Academy already: enrolled into the group right away.
  ('00000000-0000-0000-0000-0000000c7001', '00000000-0000-0000-0000-0000000ca003'),
  -- Another vacancy: nothing.
  ('00000000-0000-0000-0000-0000000c7002', '00000000-0000-0000-0000-0000000ca002');
select pg_temp.check((select status from public.academy_ats_events where kind = 'vacancy_linked'
  and candidate_id = '00000000-0000-0000-0000-0000000ca006') = 'pending', 'new account waits for the app');
select pg_temp.check((select status from public.academy_ats_events where kind = 'vacancy_linked'
  and candidate_id = '00000000-0000-0000-0000-0000000ca003') = 'done', 'existing member enrolled at once');
select pg_temp.check(exists (select 1 from public.academy_group_members where group_id = '00000000-0000-0000-0000-0000000c6001'
  and profile_id = '00000000-0000-0000-0000-00000000c007'), 'in the vacancy group');
select pg_temp.check(not exists (select 1 from public.academy_ats_events where kind = 'vacancy_linked'
  and candidate_id = '00000000-0000-0000-0000-0000000ca002'), 'no group, no enrolment');

-- ---------------------------------------------------------------------------
-- Overviews, funnel and group report (managers).
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.ats@nordavo.nl');
set role authenticated;
select pg_temp.check((select tasks_open from public.academy_admin_people() where profile_id = '00000000-0000-0000-0000-00000000c004') = 3, 'open tasks of the developer');
select pg_temp.check((select client_name from public.academy_admin_people() where profile_id = '00000000-0000-0000-0000-00000000c004') = 'KG', 'developer belongs to the client of the placement');
select pg_temp.check((select assignments_waiting from public.academy_admin_people() where profile_id = '00000000-0000-0000-0000-00000000c007') = 1, 'assignments waiting');
select pg_temp.check((select count(*) from public.academy_admin_people(p_client_id => '00000000-0000-0000-0000-0000000cc001')) = 3, 'people of one client');
select pg_temp.check((select people from public.academy_admin_rollup('client') where name = 'KG') = 3, 'rollup per client');
select pg_temp.check((select people from public.academy_admin_rollup('group') where name = 'Backend 2026') = 1, 'rollup per group');
select pg_temp.check((select reached from public.academy_lesson_funnel(public.academy_ats_developer_course()) where lesson_title = 'Welcome') = 2, 'funnel: reached');
select pg_temp.check((select completed from public.academy_lesson_funnel(public.academy_ats_developer_course()) where lesson_title = 'How we work') = 1, 'funnel: completed');
select pg_temp.check((select cohort from public.academy_lesson_funnel(public.academy_ats_developer_course()) limit 1) = 4, 'funnel: cohort with access');
select pg_temp.check((public.academy_group_report('00000000-0000-0000-0000-0000000c6001') ->> 'members')::int = 1, 'group report: members');
select pg_temp.check((public.academy_group_report('00000000-0000-0000-0000-0000000c6001') -> 'check_distribution' ->> 'none')::int = 1, 'group report: score distribution');
reset role;

-- ---------------------------------------------------------------------------
-- Reminders to candidates who get stuck.
-- ---------------------------------------------------------------------------
update public.academy_members set invited_at = now() - interval '10 days', created_at = now() - interval '10 days'
  where profile_id = '00000000-0000-0000-0000-00000000c007';
set session_replication_role = replica;
update public.academy_lesson_progress set started_at = now() - interval '10 days', updated_at = now() - interval '10 days'
  where profile_id = '00000000-0000-0000-0000-00000000c007';
set session_replication_role = origin;
select pg_temp.check(exists (select 1 from public.academy_stuck_candidates() where profile_id = '00000000-0000-0000-0000-00000000c007'
  and next_lesson_title = 'Welcome' and days_inactive = 10), 'stuck for 10 days, next lesson known');
select pg_temp.check(not exists (select 1 from public.academy_stuck_candidates() where profile_id = '00000000-0000-0000-0000-00000000c004'), 'developers get no candidate reminder');
insert into public.academy_reminders (profile_id, mailed) values ('00000000-0000-0000-0000-00000000c007', true);
select pg_temp.check(not exists (select 1 from public.academy_stuck_candidates() where profile_id = '00000000-0000-0000-0000-00000000c007'), 'not again within the repeat days');
select pg_temp.check(exists (select 1 from public.academy_stuck_candidates(now() + interval '8 days') where profile_id = '00000000-0000-0000-0000-00000000c007'), 'again after the repeat days');
insert into public.academy_reminders (profile_id, sent_at) values
  ('00000000-0000-0000-0000-00000000c007', now() - interval '1 day'), ('00000000-0000-0000-0000-00000000c007', now() - interval '2 days');
select pg_temp.check(not exists (select 1 from public.academy_stuck_candidates(now() + interval '30 days') where profile_id = '00000000-0000-0000-0000-00000000c007'), 'at most reminder_max');
select pg_temp.act('hr.ats@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_reminders) = 3, 'managers read the reminders');
reset role;

-- ---------------------------------------------------------------------------
-- Retention: Academy data of never placed candidates.
-- ---------------------------------------------------------------------------
update public.academy_members set invited_at = now() - interval '2 years', created_at = now() - interval '2 years'
  where profile_id in ('00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c009');
insert into public.academy_notes (profile_id, lesson_id, body) values
  ('00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-0000000ce001', 'personal note');
-- Busy has an application in the flow (timestamps kept old on purpose).
insert into public.applications (vacancy_id, candidate_id, stage, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000c7002', '00000000-0000-0000-0000-0000000ca005', 'interview', now() - interval '2 years', now() - interval '2 years'),
  ('00000000-0000-0000-0000-0000000c7002', '00000000-0000-0000-0000-0000000ca004', 'rejected', now() - interval '2 years', now() - interval '2 years');
set session_replication_role = replica;
update public.candidates set updated_at = now() - interval '2 years' where id in ('00000000-0000-0000-0000-0000000ca004', '00000000-0000-0000-0000-0000000ca005');
set session_replication_role = origin;

select pg_temp.check(exists (select 1 from public.academy_retention_candidates() where profile_id = '00000000-0000-0000-0000-00000000c008'), 'old, never placed candidate qualifies');
select pg_temp.check(not exists (select 1 from public.academy_retention_candidates() where profile_id = '00000000-0000-0000-0000-00000000c009'), 'application in the flow: kept');
select pg_temp.check(not exists (select 1 from public.academy_retention_candidates() where profile_id = '00000000-0000-0000-0000-00000000c004'), 'placed: kept');
select pg_temp.check(not exists (select 1 from public.academy_retention_candidates() where profile_id = '00000000-0000-0000-0000-00000000c007'), 'recent: kept');
select pg_temp.check(not exists (select 1 from public.academy_retention_candidates(36) where profile_id = '00000000-0000-0000-0000-00000000c008'), 'longer retention: kept');

select pg_temp.act('hr.ats@nordavo.nl');
set role authenticated;
select pg_temp.check((select due from public.academy_retention_preview()) = 1, 'managers see the count');
select pg_temp.check(pg_temp.denied($$select public.academy_retention_anonymise('00000000-0000-0000-0000-00000000c008')$$), 'only the job anonymises');
reset role;

select public.academy_retention_anonymise('00000000-0000-0000-0000-00000000c008');
select pg_temp.check(not exists (select 1 from public.academy_notes where profile_id = '00000000-0000-0000-0000-00000000c008'), 'notes removed');
select pg_temp.check((select full_name = 'Anonymised candidate' and email is null from public.profiles where id = '00000000-0000-0000-0000-00000000c008'), 'name and mail removed');
select pg_temp.check((select candidate_id is null from public.academy_members where profile_id = '00000000-0000-0000-0000-00000000c008'), 'link to the ATS removed');
select pg_temp.check((select action from public.academy_retention_log where profile_id = '00000000-0000-0000-0000-00000000c008') = 'anonymise', 'logged');
select pg_temp.check(not exists (select 1 from public.academy_retention_candidates() where profile_id = '00000000-0000-0000-0000-00000000c008'), 'not picked up twice');
do $$ begin
  perform public.academy_retention_anonymise('00000000-0000-0000-0000-00000000c009');
  raise exception 'FAIL: a person who does not qualify is refused';
exception when others then
  if sqlerrm not like '%does not qualify%' then raise; end if;
end $$;

select pg_temp.act('rec.ats@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_retention_log) = 0, 'recruitment alone reads no retention log');
reset role;

-- ---------------------------------------------------------------------------
-- AI drafts are hidden from learners until accepted.
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.ats@nordavo.nl');
set role authenticated;
insert into public.academy_lesson_blocks (id, lesson_id, type, position, content) values
  ('00000000-0000-0000-0000-0000000cb0d1', '00000000-0000-0000-0000-0000000ce002', 'explanation', 9, '{"html": "<p>Draft</p>"}'),
  ('00000000-0000-0000-0000-0000000cb0d2', '00000000-0000-0000-0000-0000000ce002', 'tasks', 10, '{}');
insert into public.academy_tasks (id, block_id, title) values ('00000000-0000-0000-0000-0000000cf0d1', '00000000-0000-0000-0000-0000000cb0d2', 'Draft task');
insert into public.academy_block_drafts (block_id, source) values
  ('00000000-0000-0000-0000-0000000cb0d1', 'ai'), ('00000000-0000-0000-0000-0000000cb0d2', 'ai');
select pg_temp.check((select count(*) from public.academy_lesson_blocks where lesson_id = '00000000-0000-0000-0000-0000000ce002') = 2, 'managers see drafts');
reset role;

select pg_temp.act('ravi.ats@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_lesson_blocks where lesson_id = '00000000-0000-0000-0000-0000000ce002') = 0, 'learners do not see drafts');
select pg_temp.check((select count(*) from public.academy_tasks where id = '00000000-0000-0000-0000-0000000cf0d1') = 0, 'learners do not see draft tasks');
select pg_temp.check((select count(*) from public.academy_block_drafts) = 0, 'learners do not read the drafts table');
select pg_temp.check((select count(*) from public.academy_lesson_blocks where lesson_id = '00000000-0000-0000-0000-0000000ce001') = 5, 'learners still see other blocks');
reset role;

select pg_temp.act('hr.ats@nordavo.nl');
set role authenticated;
delete from public.academy_block_drafts where block_id = '00000000-0000-0000-0000-0000000cb0d1';
reset role;
select pg_temp.act('ravi.ats@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_lesson_blocks where lesson_id = '00000000-0000-0000-0000-0000000ce002') = 1, 'accepted draft is visible');
reset role;

rollback;
