-- Academy assignment, tasks, knowledge check and questionnaire blocks
-- (supabase/migrations/20261113100000_academy_learn_blocks.sql): who may
-- hand in, review, tick off, answer and read what. Learners never read the
-- correct answers or each other's submissions, readers see scores but never
-- answers, clients never see questionnaire answers. One transaction, rolled
-- back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000c001', 'admin.ln@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-00000000c002', 'hr.ln@nordavo.nl', '{"full_name": "HR"}'),
  ('00000000-0000-0000-0000-00000000c003', 'recruiter.ln@nordavo.nl', '{"full_name": "Recruiter"}'),
  ('00000000-0000-0000-0000-00000000c004', 'boss.ln@kg.nl', '{"full_name": "Klant Beheer"}'),
  ('00000000-0000-0000-0000-00000000c005', 'manager.ln@kg.nl', '{"full_name": "Klant Lid"}'),
  ('00000000-0000-0000-0000-00000000c006', 'board.ln@kg.nl', '{"full_name": "Meelezer"}'),
  ('00000000-0000-0000-0000-00000000c007', 'dev.ln@example.in', '{"full_name": "Asha"}'),
  ('00000000-0000-0000-0000-00000000c008', 'cand.ln@example.in', '{"full_name": "Ravi"}'),
  ('00000000-0000-0000-0000-00000000c009', 'top.ln@example.in', '{"full_name": "Priya"}');

insert into public.clients (id, name, status) values ('00000000-0000-0000-0000-00000000cc01', 'KG', 'active');

update public.profiles set role = 'admin' where email = 'admin.ln@nordavo.nl';
update public.profiles set role = 'member', modules = array['academy'] where email = 'hr.ln@nordavo.nl';
update public.profiles set role = 'member', modules = array['recruitment'] where email = 'recruiter.ln@nordavo.nl';
update public.profiles set time_zone = 'Asia/Kolkata' where email in ('dev.ln@example.in', 'cand.ln@example.in', 'top.ln@example.in');

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

-- Runs a statement that must fail (any error).
create or replace function pg_temp.fails(p_sql text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FAIL: % (no error)', p_what;
end $$;

-- Is a block done for the signed in user?
create or replace function pg_temp.done(p_lesson uuid, p_block uuid) returns boolean language sql as $$
  select done from public.academy_lesson_blocks_state(p_lesson) where block_id = p_block;
$$;

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.fails(text, text), pg_temp.done(uuid, uuid) to authenticated;

-- The real deadline of "by day 1" and "in week 2" (same as deadlineFromOffset).
select pg_temp.check(public.academy_deadline('2026-11-16', 0, 'Asia/Kolkata') = '2026-11-16 18:29:59+00', 'day 1 ends at midnight in Kolkata');
select pg_temp.check(public.academy_deadline('2026-11-16', 7, 'Europe/Amsterdam') = '2026-11-23 22:59:59+00', 'week 2 in Amsterdam (winter time)');
select pg_temp.check(public.academy_deadline(null, 7, 'Europe/Amsterdam') is null, 'no start date, no deadline');

-- ---------------------------------------------------------------------------
-- HR builds a developer course and a client course with the four block types.
-- ---------------------------------------------------------------------------
insert into public.candidates (id, full_name) values
  ('00000000-0000-0000-0000-00000000cd01', 'Asha'),
  ('00000000-0000-0000-0000-00000000cd02', 'Ravi'),
  ('00000000-0000-0000-0000-00000000cd03', 'Priya');
insert into public.placements (id, client_id, candidate_id, start_date, monthly_rate) values
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cd01', current_date - 40, 4200);

select pg_temp.act('hr.ln@nordavo.nl');
set role authenticated;

insert into public.academy_courses (id, title, language, audience, status) values
  ('00000000-0000-0000-0000-00000000c0c1', 'Dev', 'en', 'developer', 'published'),
  ('00000000-0000-0000-0000-00000000c0c2', 'Klant', 'nl', 'client', 'published');
insert into public.academy_modules (id, course_id, title, position, status, in_default_access, requires_previous) values
  ('00000000-0000-0000-0000-00000000c0d1', '00000000-0000-0000-0000-00000000c0c1', 'Welcome', 1, 'published', true, false),
  ('00000000-0000-0000-0000-00000000c0d2', '00000000-0000-0000-0000-00000000c0c2', 'Start', 1, 'published', true, false);
insert into public.academy_lessons (id, title, status) values
  ('00000000-0000-0000-0000-00000000c0e1', 'First week', 'published'),
  ('00000000-0000-0000-0000-00000000c0e2', 'Before the start', 'published');
insert into public.academy_module_lessons (module_id, lesson_id, position) values
  ('00000000-0000-0000-0000-00000000c0d1', '00000000-0000-0000-0000-00000000c0e1', 1),
  ('00000000-0000-0000-0000-00000000c0d2', '00000000-0000-0000-0000-00000000c0e2', 1);
insert into public.academy_lesson_blocks (id, lesson_id, type, position, required, completion, content) values
  ('00000000-0000-0000-0000-00000000c0b1', '00000000-0000-0000-0000-00000000c0e1', 'assignment', 1, true, '{"require": "approved"}',
   '{"prompt": "Write your first task with the 5W template", "formats": ["text", "link"]}'),
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-00000000c0e1', 'tasks', 2, true, '{}', '{}'),
  ('00000000-0000-0000-0000-00000000c0b3', '00000000-0000-0000-0000-00000000c0e1', 'knowledge_check', 3, true, '{"min_percent": 60}', '{}'),
  ('00000000-0000-0000-0000-00000000c0b4', '00000000-0000-0000-0000-00000000c0e1', 'questionnaire', 4, true, '{}', '{
     "consent_text": "I agree",
     "dimensions": [{"key": "structure", "label": "Structure"}, {"key": "social", "label": "Social"}],
     "questions": [
       {"id": "q1", "kind": "scale", "text": "I plan my week", "dimension": "structure"},
       {"id": "q2", "kind": "scale", "text": "I improvise", "dimension": "structure", "reverse": true},
       {"id": "q3", "kind": "choice", "text": "In a meeting I", "options": ["listen", "talk"], "option_scores": [2, 5], "dimension": "social"},
       {"id": "q4", "kind": "open", "text": "Anything else?", "required": false}
     ]}'),
  ('00000000-0000-0000-0000-00000000c0b5', '00000000-0000-0000-0000-00000000c0e2', 'tasks', 1, true, '{}', '{}');
insert into public.academy_tasks (id, block_id, title, position, deadline_offset_days, shared, placement_only, required) values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-00000000c0b2', 'Overlap in your calendar', 1, 0, false, false, true),
  ('00000000-0000-0000-0000-00000000c0a2', '00000000-0000-0000-0000-00000000c0b2', 'Meet the team', 2, 7, false, true, true),
  ('00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000c0b5', 'Repo access for the developer', 1, 0, true, false, true);
insert into public.academy_check_questions (id, block_id, position, question, options, correct_index, explanation) values
  ('00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-00000000c0b3', 1, 'Who decides?', '["you", "the team", "nobody"]', 1, 'The team decides together.'),
  ('00000000-0000-0000-0000-00000000c0f2', '00000000-0000-0000-0000-00000000c0b3', 2, 'Saying no is', '["rude", "normal"]', 1, 'Dutch colleagues value a clear no.'),
  ('00000000-0000-0000-0000-00000000c0f3', '00000000-0000-0000-0000-00000000c0b3', 3, 'Blocked for an hour?', '["wait", "ask"]', 1, 'Ask early.');

select public.academy_add_person('00000000-0000-0000-0000-00000000c007', 'developer', null, current_date - 40, null,
  '00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000c0c1', 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c008', 'candidate', null, null, null,
  '00000000-0000-0000-0000-00000000cd02', '00000000-0000-0000-0000-00000000c0c1', 'default', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c009', 'candidate', null, null, null,
  '00000000-0000-0000-0000-00000000cd03', '00000000-0000-0000-0000-00000000c0c1', 'default', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c004', 'client_admin', null, current_date - 40,
  '00000000-0000-0000-0000-00000000cc01', null, '00000000-0000-0000-0000-00000000c0c2', 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c005', 'client_member', null, current_date - 40,
  '00000000-0000-0000-0000-00000000cc01', null, '00000000-0000-0000-0000-00000000c0c2', 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c006', 'client_reader', null, null,
  '00000000-0000-0000-0000-00000000cc01', null, null, 'all', '{}');
insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-00000000c004', 'client_admin'),
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-00000000c005', 'client_member'),
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-00000000c006', 'client_reader'),
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-00000000c007', 'developer');
reset role;

-- ---------------------------------------------------------------------------
-- Knowledge check: questions without answers, scored in the database.
-- ---------------------------------------------------------------------------
select pg_temp.act('dev.ln@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_check_questions) = 0, 'learners never read questions with the correct answer');
select pg_temp.check((select count(*) from public.academy_check_questions_for('00000000-0000-0000-0000-00000000c0b3')) = 3, 'three questions handed out');
select pg_temp.check(
  not exists (select 1 from public.academy_check_questions_for('00000000-0000-0000-0000-00000000c0b3') x where to_jsonb(x) ? 'correct_index'),
  'handed out without the answer');
select pg_temp.fails($$select public.academy_submit_check('00000000-0000-0000-0000-00000000c0b3', '{"00000000-0000-0000-0000-00000000c0f1": 1}')$$, 'every question must be answered');
select pg_temp.fails($$select public.academy_submit_check('00000000-0000-0000-0000-00000000c0b3',
  '{"00000000-0000-0000-0000-00000000c0f1": 9, "00000000-0000-0000-0000-00000000c0f2": 1, "00000000-0000-0000-0000-00000000c0f3": 1}')$$, 'unknown option');
-- One right of three: 33%, below the 60% rule.
select pg_temp.check((public.academy_submit_check('00000000-0000-0000-0000-00000000c0b3',
  '{"00000000-0000-0000-0000-00000000c0f1": 0, "00000000-0000-0000-0000-00000000c0f2": 0, "00000000-0000-0000-0000-00000000c0f3": 1}') ->> 'percent')::int = 33, 'scored 33%');
select pg_temp.check(not pg_temp.done('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0b3'), 'below the minimum score');
select pg_temp.check((select (r -> 'results' -> 0 ->> 'explanation') = 'The team decides together.' and (r -> 'results' -> 0 ->> 'correct')::boolean = false
  from public.academy_submit_check('00000000-0000-0000-0000-00000000c0b3',
  '{"00000000-0000-0000-0000-00000000c0f1": 0, "00000000-0000-0000-0000-00000000c0f2": 1, "00000000-0000-0000-0000-00000000c0f3": 1}') r), 'explanation after answering');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0b3'), '67% passes the check');
select pg_temp.check((select count(*) from public.academy_check_attempts) = 2, 'attempts stored');
select pg_temp.check((select score from public.academy_check_attempts order by created_at desc, score desc limit 1) = 2, 'score stored by the database');
select pg_temp.check((public.academy_check_results('00000000-0000-0000-0000-00000000c0b3') ->> 'attempts')::int = 2, 'last result with attempts');
select pg_temp.check((public.academy_check_results('00000000-0000-0000-0000-00000000c0b3') ->> 'best_percent')::int = 67, 'best score');
-- Writing an attempt directly is not possible (only through the function).
do $$ begin
  insert into public.academy_check_attempts (block_id, profile_id, answers, score, max_score)
  values ('00000000-0000-0000-0000-00000000c0b3', (select auth.uid()), '{}', 3, 3);
  raise exception 'FAIL: wrote own attempt';
exception when insufficient_privilege then null;
end $$;
reset role;

-- One transaction has one now(): put the first attempt a minute earlier.
update public.academy_check_attempts set created_at = now() - interval '1 minute' where score = 1;

-- The client reader sees the score, never the answers.
select pg_temp.act('board.ln@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_check_attempts) = 0, 'reader reads no attempts (answers)');
select pg_temp.check((select count(*) from public.academy_check_questions_for('00000000-0000-0000-0000-00000000c0b3')) = 0, 'reader gets no questions of a lesson he cannot open');
select pg_temp.check((select check_average_percent from public.academy_people_progress()
  where profile_id = '00000000-0000-0000-0000-00000000c007' and course_id = '00000000-0000-0000-0000-00000000c0c1') = 50, 'reader sees the score');
select pg_temp.check((select count(*) from public.academy_candidate_check_scores()) = 0, 'no ATS scores for clients');
reset role;

-- Another learner sees nothing of it.
select pg_temp.act('cand.ln@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_check_attempts) = 0, 'other learners read no attempts');
select pg_temp.check(public.academy_check_results('00000000-0000-0000-0000-00000000c0b3') is null, 'no own result yet');
reset role;

-- The ATS (recruitment module) reads the scores per candidate.
select pg_temp.act('recruiter.ln@nordavo.nl');
set role authenticated;
select pg_temp.check((select best_percent from public.academy_candidate_check_scores('00000000-0000-0000-0000-00000000cd01')) = 67, 'ATS best score');
select pg_temp.check((select last_percent from public.academy_candidate_check_scores('00000000-0000-0000-0000-00000000cd01')) = 67, 'ATS last score');
select pg_temp.check((select attempts from public.academy_candidate_check_scores('00000000-0000-0000-0000-00000000cd01')) = 2, 'ATS attempts');
select pg_temp.check((select check_average_percent from public.academy_candidate_learn_summary(array['00000000-0000-0000-0000-00000000cd01'::uuid])) = 67, 'ATS summary');
select pg_temp.check((select count(*) from public.academy_check_attempts) = 0, 'recruiter without academy reads no attempts');
reset role;

-- ---------------------------------------------------------------------------
-- Assignment: hand in, review, resubmit, history.
-- ---------------------------------------------------------------------------
select pg_temp.act('cand.ln@example.in');
set role authenticated;
select pg_temp.fails($$select public.academy_submit_assignment('00000000-0000-0000-0000-00000000c0b1')$$, 'empty submission');
select pg_temp.fails($$select public.academy_submit_assignment('00000000-0000-0000-0000-00000000c0b1', p_link_url => 'ftp://x')$$, 'link must be http');
select pg_temp.fails($$select public.academy_submit_assignment('00000000-0000-0000-0000-00000000c0b1',
  p_file_path => 'academy/submission/00000000-0000-0000-0000-00000000c007/x.pdf', p_file_name => 'x.pdf')$$, 'file of someone else / format not allowed');
select public.academy_submit_assignment('00000000-0000-0000-0000-00000000c0b1', 'What: deploy. Who: me.');
select public.academy_submit_assignment('00000000-0000-0000-0000-00000000c0b1', 'What: deploy. Who: me. When: Friday.');
select pg_temp.check((select count(*) from public.academy_assignment_submissions) = 1, 'edit while waiting keeps one attempt');
select pg_temp.check((select body from public.academy_assignment_submissions) like '%Friday%', 'edit saved');
select pg_temp.check(not pg_temp.done('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0b1'), 'needs approval');
select pg_temp.fails($$select public.academy_review_submission((select id from public.academy_assignment_submissions), 'approved')$$, 'learner cannot review');
do $$ begin
  update public.academy_assignment_submissions set status = 'approved', final_score = 100;
  raise exception 'FAIL: learner approved own work';
exception when insufficient_privilege then null;
end $$;
reset role;

select pg_temp.act('dev.ln@example.in');
set role authenticated;
select public.academy_submit_assignment('00000000-0000-0000-0000-00000000c0b1', p_link_url => 'https://docs.example.com/5w');
select pg_temp.check((select count(*) from public.academy_assignment_submissions) = 1, 'learners only see their own submissions');
reset role;

select pg_temp.act('board.ln@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_assignment_submissions) = 0, 'reader reads no submissions');
reset role;

select pg_temp.act('hr.ln@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_assignment_submissions where status = 'submitted') = 2, 'review queue');
select pg_temp.fails($$select public.academy_review_submission(
  (select id from public.academy_assignment_submissions where profile_id = '00000000-0000-0000-0000-00000000c008'), 'changes_requested')$$, 'feedback needed for changes');
insert into public.academy_assignment_assessments (submission_id, ai_scores, ai_total, ai_status)
select id, '{"clarity": 3, "proactivity": 2, "says_no": 3, "english": 4}', 60, 'ready'
from public.academy_assignment_submissions where profile_id = '00000000-0000-0000-0000-00000000c008';
select public.academy_review_submission(
  (select id from public.academy_assignment_submissions where profile_id = '00000000-0000-0000-0000-00000000c008'),
  'changes_requested', 'Add the Why.', null, null);
reset role;

select pg_temp.act('cand.ln@example.in');
set role authenticated;
select pg_temp.check((select feedback from public.academy_assignment_submissions) = 'Add the Why.', 'learner reads the feedback');
select pg_temp.check((select count(*) from public.academy_assignment_assessments) = 0, 'learner never sees the AI proposal');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'assignment_changes_requested') = 1, 'learner notified');
select public.academy_submit_assignment('00000000-0000-0000-0000-00000000c0b1', 'What, who, when and why: Friday.');
select pg_temp.check((select count(*) from public.academy_assignment_submissions) = 2, 'resubmission is a new attempt, history kept');
select pg_temp.check((select max(attempt) from public.academy_assignment_submissions) = 2, 'attempt 2');
reset role;

select pg_temp.act('hr.ln@nordavo.nl');
set role authenticated;
select pg_temp.fails($$select public.academy_review_submission(
  (select id from public.academy_assignment_submissions where profile_id = '00000000-0000-0000-0000-00000000c008' and attempt = 1), 'approved')$$, 'old attempt not reviewed');
select public.academy_review_submission(
  (select id from public.academy_assignment_submissions where profile_id = '00000000-0000-0000-0000-00000000c008' and attempt = 2),
  'approved', 'Clear.', 80, '{"clarity": 4, "proactivity": 4, "says_no": 3, "english": 9, "bogus": 2}');
select pg_temp.check((select rubric_scores from public.academy_assignment_assessments a join public.academy_assignment_submissions s on s.id = a.submission_id
  where s.attempt = 2) = '{"clarity": 4, "proactivity": 4, "says_no": 3}', 'rubric cleaned (1 to 5, known criteria)');
reset role;

select pg_temp.act('cand.ln@example.in');
set role authenticated;
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0b1'), 'approved assignment done');
select pg_temp.check((select final_score from public.academy_assignment_submissions where attempt = 2) = 80, 'final score is Nordavo''s');
select pg_temp.fails($$select public.academy_submit_assignment('00000000-0000-0000-0000-00000000c0b1', 'again')$$, 'approved is final');
reset role;

select pg_temp.act('recruiter.ln@nordavo.nl');
set role authenticated;
select pg_temp.check((select final_score from public.academy_candidate_assignments('00000000-0000-0000-0000-00000000cd02')) = 80, 'ATS sees the final score of the latest attempt');
select pg_temp.check((select count(*) from public.academy_assignment_submissions) = 0, 'recruiter without academy reads no submissions');
reset role;

-- ---------------------------------------------------------------------------
-- Tasks: per person, relative deadlines, placement only, shared.
-- ---------------------------------------------------------------------------
select pg_temp.act('cand.ln@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_my_tasks()) = 1, 'candidate sees only the personal task');
select pg_temp.check((select due_at from public.academy_my_tasks()) is null, 'no start date: no deadline yet');
select pg_temp.check((select count(*) from public.academy_tasks where placement_only) = 0, 'placement-only tasks hidden for candidates');
select pg_temp.fails($$select public.academy_set_task_done('00000000-0000-0000-0000-00000000c0a2')$$, 'candidate cannot tick placement-only task');
select pg_temp.fails($$select public.academy_set_task_done('00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000ce01')$$, 'candidate cannot tick a shared task');
select pg_temp.check(not pg_temp.done('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0b2'), 'tasks not done yet');
select public.academy_set_task_done('00000000-0000-0000-0000-00000000c0a1');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0b2'), 'candidate done without the placement-only task');
select public.academy_set_task_done('00000000-0000-0000-0000-00000000c0a1', null, false);
select pg_temp.check((select done_at from public.academy_my_tasks()) is null, 'untick');
select public.academy_set_task_done('00000000-0000-0000-0000-00000000c0a1');
select pg_temp.check((select count(*) from public.academy_task_status where placement_id is not null) = 0, 'candidate sees no placement task status');
reset role;

select pg_temp.act('dev.ln@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_my_tasks()) = 3, 'developer: personal, placement-only and shared task');
select pg_temp.check((select due_at from public.academy_my_tasks() where task_id = '00000000-0000-0000-0000-00000000c0a2')
  = public.academy_deadline(current_date - 40, 7, 'Asia/Kolkata'), 'real deadline in the own time zone');
select pg_temp.check((select can_tick from public.academy_my_tasks() where task_id = '00000000-0000-0000-0000-00000000c0a3'), 'developer may tick the shared task');
select pg_temp.check((select count(*) from public.academy_placement_tasks('00000000-0000-0000-0000-00000000ce01')) = 2, 'placement page: shared and placement-only tasks');
reset role;

select pg_temp.act('hr.ln@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_overdue_tasks()) = 3, 'Nordavo sees the overdue tasks');
select pg_temp.check((select days_overdue from public.academy_overdue_tasks() where task_id = '00000000-0000-0000-0000-00000000c0a2') >= 32, 'days overdue');
select pg_temp.check((select count(*) from public.academy_person_tasks('00000000-0000-0000-0000-00000000c007')) = 3, 'people page: tasks of the developer');
reset role;

select pg_temp.act('dev.ln@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_overdue_tasks()) = 0, 'learners get no overview');
select pg_temp.check((select count(*) from public.academy_person_tasks('00000000-0000-0000-0000-00000000c008')) = 0, 'learners get no tasks of others');
reset role;

-- The job reminds once, not again within a week.
select pg_temp.check(public.academy_remind_overdue_tasks() = 3, 'three overdue tasks reminded');
select pg_temp.check(public.academy_remind_overdue_tasks() = 0, 'not again within a week');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'task_overdue'
  and profile_id = '00000000-0000-0000-0000-00000000c007') = 3, 'developer: two own tasks and the shared one');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'task_overdue'
  and profile_id = '00000000-0000-0000-0000-00000000c004') = 1, 'client admin: the shared task');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'task_overdue'
  and profile_id = '00000000-0000-0000-0000-00000000c006') = 0, 'reader gets no task reminder');

-- The client ticks off the shared task; the developer and Nordavo see it.
select pg_temp.act('boss.ln@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_my_tasks() where shared) = 1, 'client sees the shared task');
select public.academy_set_task_done('00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000ce01');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c0e2', '00000000-0000-0000-0000-00000000c0b5'), 'shared task block done for the client');
reset role;

select pg_temp.act('dev.ln@example.in');
set role authenticated;
select pg_temp.check((select done_by_name from public.academy_my_tasks() where task_id = '00000000-0000-0000-0000-00000000c0a3') = 'Klant Beheer', 'developer sees who ticked it');
reset role;

select pg_temp.act('board.ln@kg.nl');
set role authenticated;
select pg_temp.check((select bool_and(not can_tick) from public.academy_placement_tasks('00000000-0000-0000-0000-00000000ce01')), 'reader cannot tick');
select pg_temp.check((select count(*) from public.academy_placement_tasks('00000000-0000-0000-0000-00000000ce01') where done_at is not null) = 1, 'reader sees the shared task done');
select pg_temp.fails($$select public.academy_set_task_done('00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000ce01', false)$$, 'reader cannot untick');
reset role;

select pg_temp.act('hr.ln@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_overdue_tasks()) = 2, 'done tasks leave the overview');
reset role;

-- ---------------------------------------------------------------------------
-- Questionnaire: consent first, scored here, answers for the person and
-- Academy managers only.
-- ---------------------------------------------------------------------------
select pg_temp.act('top.ln@example.in');
set role authenticated;
select pg_temp.fails($$select public.academy_save_questionnaire('00000000-0000-0000-0000-00000000c0b4', '{"q1": 4}')$$, 'no answers without consent');
do $$ begin
  insert into public.academy_questionnaire_consents (profile_id, block_id) values ((select auth.uid()), '00000000-0000-0000-0000-00000000c0b4');
  raise exception 'FAIL: consent written directly';
exception when insufficient_privilege then null;
end $$;
select public.academy_questionnaire_consent('00000000-0000-0000-0000-00000000c0b4', true);
select pg_temp.check((select consented_at is not null and withdrawn_at is null from public.academy_questionnaire_consents), 'consent stored with a timestamp');
select public.academy_save_questionnaire('00000000-0000-0000-0000-00000000c0b4', '{"q1": 4, "unknown": 1}', false);
select pg_temp.check((select answers from public.academy_questionnaire_responses) = '{"q1": 4}', 'draft saved, unknown questions dropped');
select pg_temp.fails($$select public.academy_save_questionnaire('00000000-0000-0000-0000-00000000c0b4', '{"q1": 4}', true)$$, 'required questions on submit');
select pg_temp.fails($$select public.academy_save_questionnaire('00000000-0000-0000-0000-00000000c0b4', '{"q1": 7, "q2": 2, "q3": 1}', true)$$, 'scale is 1 to 5');
select pg_temp.check(not pg_temp.done('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0b4'), 'not done before submitting');
select public.academy_save_questionnaire('00000000-0000-0000-0000-00000000c0b4', '{"q1": 4, "q2": 2, "q3": 1, "q4": "Nothing"}', true);
-- structure: q1 = 4, q2 reversed 6 - 2 = 4, average 4; social: option 1 scores 5.
select pg_temp.check((select result -> 'dimensions' -> 0 ->> 'score' from public.academy_questionnaire_responses)::numeric = 4, 'structure scored');
select pg_temp.check((select result -> 'dimensions' -> 1 ->> 'score' from public.academy_questionnaire_responses)::numeric = 5, 'social scored');
select pg_temp.check(pg_temp.done('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0b4'), 'questionnaire done');
select pg_temp.fails($$select public.academy_save_questionnaire('00000000-0000-0000-0000-00000000c0b4', '{"q1": 1, "q2": 1, "q3": 0}', true)$$, 'submitted answers stay');
do $$ begin
  update public.academy_questionnaire_responses set result = '{"dimensions": []}';
  if found then raise exception 'FAIL: learner changed the result'; end if;
end $$;
reset role;

-- Other learners, clients and readers never see the answers.
select pg_temp.act('cand.ln@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_questionnaire_responses) = 0, 'other learners read no questionnaire');
select pg_temp.check((select count(*) from public.academy_questionnaire_consents) = 0, 'other learners read no consent');
reset role;
select pg_temp.act('boss.ln@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_questionnaire_responses) = 0, 'clients read no questionnaire');
select pg_temp.check((select count(*) from public.academy_candidate_questionnaire_results()) = 0, 'clients get no questionnaire results');
reset role;
select pg_temp.act('board.ln@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_questionnaire_responses) = 0, 'readers read no questionnaire');
reset role;

-- Nordavo with module academy reads the answers; the ATS gets the summary only.
select pg_temp.act('hr.ln@nordavo.nl');
set role authenticated;
select pg_temp.check((select answers ->> 'q4' from public.academy_questionnaire_responses) = 'Nothing', 'Academy managers read the answers');
reset role;
select pg_temp.act('recruiter.ln@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_questionnaire_responses) = 0, 'recruiter without academy reads no answers');
select pg_temp.check((select result -> 'dimensions' -> 0 ->> 'key' from public.academy_candidate_questionnaire_results('00000000-0000-0000-0000-00000000cd03')) = 'structure', 'ATS result summary');
select pg_temp.check(not exists (select 1 from public.academy_candidate_questionnaire_results() x where to_jsonb(x) ? 'answers'), 'ATS never gets the answers');
select pg_temp.check((select questionnaire_done from public.academy_candidate_learn_summary(array['00000000-0000-0000-0000-00000000cd03'::uuid])), 'ATS summary flag');
reset role;

-- Withdrawing consent deletes the answers.
select pg_temp.act('top.ln@example.in');
set role authenticated;
select public.academy_questionnaire_consent('00000000-0000-0000-0000-00000000c0b4', false);
select pg_temp.check((select withdrawn_at is not null from public.academy_questionnaire_consents), 'consent withdrawn with a timestamp');
select pg_temp.check((select count(*) from public.academy_questionnaire_responses) = 0, 'answers deleted on withdrawal');
select pg_temp.check(not pg_temp.done('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0b4'), 'not done after withdrawal');
reset role;
select pg_temp.act('recruiter.ln@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_candidate_questionnaire_results('00000000-0000-0000-0000-00000000cd03')) = 0, 'no result after withdrawal');
reset role;

rollback;
