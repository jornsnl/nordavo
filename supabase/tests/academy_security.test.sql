-- Academy security fixes (supabase/migrations/20261115000000_academy_security.sql):
-- portal only for client users without an Academy role or with client_admin,
-- no moving client users between clients, no Work for developers and
-- candidates, calendar links that end with the membership, helpers that only
-- answer for the caller, one event per vacancy group, the worksheet lock, and
-- first attempts in the ATS. One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000d101', 'hr.sec@nordavo.nl', '{"full_name": "HR"}'),
  ('00000000-0000-0000-0000-00000000d102', 'plain.sec@kg.nl', '{"full_name": "Plain Client"}'),
  ('00000000-0000-0000-0000-00000000d103', 'boss.sec@kg.nl', '{"full_name": "Client Admin"}'),
  ('00000000-0000-0000-0000-00000000d104', 'lid.sec@kg.nl', '{"full_name": "Client Member"}'),
  ('00000000-0000-0000-0000-00000000d105', 'board.sec@kg.nl', '{"full_name": "Reader"}'),
  ('00000000-0000-0000-0000-00000000d106', 'dev.sec@example.in', '{"full_name": "Asha"}'),
  ('00000000-0000-0000-0000-00000000d107', 'cand.sec@example.in', '{"full_name": "Ravi"}'),
  ('00000000-0000-0000-0000-00000000d108', 'other.sec@acme.nl', '{"full_name": "Acme Admin"}'),
  ('00000000-0000-0000-0000-00000000d109', 'guest.sec@example.in', '{"full_name": "Guest"}'),
  ('00000000-0000-0000-0000-00000000d110', 'admin.sec@nordavo.nl', '{"full_name": "Admin"}');

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-00000000d1c1', 'KG', 'active'),
  ('00000000-0000-0000-0000-00000000d1c2', 'Acme', 'active');

update public.profiles set role = 'member', modules = array['recruitment', 'academy'] where email = 'hr.sec@nordavo.nl';
update public.profiles set role = 'admin' where email = 'admin.sec@nordavo.nl';
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-00000000d1c1' where email = 'plain.sec@kg.nl';

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

create or replace function pg_temp.refused(p_sql text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FAIL: %', p_what;
end $$;

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.refused(text, text) to authenticated;

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;
insert into ctx values ('devcourse', (select id::text from public.academy_courses where slug = 'developer'));

-- ---------------------------------------------------------------------------
-- Setup: a presented candidate with a CV and a placement of KG, the Academy
-- people (client admin, member, reader, developer, candidate).
-- ---------------------------------------------------------------------------
insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-00000000d1e1', '00000000-0000-0000-0000-00000000d1c1', 'Laravel developer');
insert into public.candidates (id, full_name, cv_path) values
  ('00000000-0000-0000-0000-00000000d1f1', 'Asha', 'candidate/00000000-0000-0000-0000-00000000d1f1/cv.pdf'),
  ('00000000-0000-0000-0000-00000000d1f2', 'Ravi', null);
insert into public.applications (id, vacancy_id, candidate_id, stage) values
  ('00000000-0000-0000-0000-00000000d1b1', '00000000-0000-0000-0000-00000000d1e1', '00000000-0000-0000-0000-00000000d1f1', 'matched');
insert into public.placements (id, client_id, candidate_id, start_date, monthly_rate) values
  ('00000000-0000-0000-0000-00000000d191', '00000000-0000-0000-0000-00000000d1c1', '00000000-0000-0000-0000-00000000d1f1', current_date - 10, 4200);
insert into storage.objects (bucket_id, name) values
  ('attachments', 'candidate/00000000-0000-0000-0000-00000000d1f1/cv.pdf');

select pg_temp.act('hr.sec@nordavo.nl');
set role authenticated;
select public.academy_add_person('00000000-0000-0000-0000-00000000d103', 'client_admin', null, current_date, '00000000-0000-0000-0000-00000000d1c1');
select public.academy_add_person('00000000-0000-0000-0000-00000000d104', 'client_member', null, current_date, '00000000-0000-0000-0000-00000000d1c1');
select public.academy_add_person('00000000-0000-0000-0000-00000000d105', 'client_reader', null, null, '00000000-0000-0000-0000-00000000d1c1');
select public.academy_add_person('00000000-0000-0000-0000-00000000d108', 'client_admin', null, null, '00000000-0000-0000-0000-00000000d1c2');
select public.academy_add_person('00000000-0000-0000-0000-00000000d106', 'developer', null, current_date, null,
  '00000000-0000-0000-0000-00000000d1f1', (select id from public.academy_courses where slug = 'developer'), 'all', '{}');
reset role;
insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000d191', '00000000-0000-0000-0000-00000000d103', 'client_admin'),
  ('00000000-0000-0000-0000-00000000d191', '00000000-0000-0000-0000-00000000d104', 'client_member'),
  ('00000000-0000-0000-0000-00000000d191', '00000000-0000-0000-0000-00000000d105', 'client_reader'),
  ('00000000-0000-0000-0000-00000000d191', '00000000-0000-0000-0000-00000000d106', 'developer');

-- ---------------------------------------------------------------------------
-- 1. Client portal: plain client and client_admin yes, member and reader no.
-- ---------------------------------------------------------------------------
select pg_temp.check((select raw_app_meta_data ->> 'academy_role' from auth.users where email = 'board.sec@kg.nl') = 'client_reader',
  'the Academy role is in the session token');

select pg_temp.act('plain.sec@kg.nl');
set role authenticated;
select pg_temp.check(public.current_client_id() = '00000000-0000-0000-0000-00000000d1c1', 'plain client: own client');
select pg_temp.check((select monthly_rate from public.portal_placements()) = 4200, 'plain client: portal placements');
select pg_temp.check((select count(*) from public.portal_candidates()) = 1, 'plain client: portal candidates');
select pg_temp.check((select count(*) from storage.objects where name like 'candidate/%') = 1, 'plain client: opens the CV');
reset role;

select pg_temp.act('boss.sec@kg.nl');
set role authenticated;
select pg_temp.check((select monthly_rate from public.portal_placements()) = 4200, 'client admin: portal placements');
select pg_temp.check((select count(*) from public.portal_candidates()) = 1, 'client admin: portal candidates');
select pg_temp.check(public.portal_cv_path('00000000-0000-0000-0000-00000000d1b1') is not null, 'client admin: CV path');
select pg_temp.check((select count(*) from storage.objects where name like 'candidate/%') = 1, 'client admin: opens the CV');
select pg_temp.check((select name from public.portal_company()) = 'KG', 'client admin: portal company');
reset role;

select pg_temp.act('lid.sec@kg.nl');
set role authenticated;
select pg_temp.check(public.current_client_id() is null, 'client member: no portal client');
select pg_temp.check((select count(*) from public.portal_placements()) = 0, 'client member: no portal placements (no monthly rate)');
select pg_temp.check((select count(*) from public.portal_candidates()) = 0, 'client member: no portal candidates');
select pg_temp.check((select count(*) from public.portal_vacancies()) = 0, 'client member: no portal vacancies');
select pg_temp.check((select count(*) from public.portal_company()) = 0, 'client member: no portal company');
select pg_temp.check(public.portal_cv_path('00000000-0000-0000-0000-00000000d1b1') is null, 'client member: no CV path');
select pg_temp.check(not public.client_can_open_file('candidate/00000000-0000-0000-0000-00000000d1f1/cv.pdf'), 'client member: may not open the CV');
select pg_temp.check((select count(*) from storage.objects where name like 'candidate/%') = 0, 'client member: reads no CV object');
-- The Academy still works for them: the placement and its people.
select pg_temp.check((select count(*) from public.academy_my_placements()) = 1, 'client member: still sees the placement in the Academy');
reset role;

select pg_temp.act('board.sec@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.portal_placements()) = 0, 'reader: no portal placements (no monthly rate)');
select pg_temp.check((select count(*) from public.portal_candidates()) = 0, 'reader: no portal candidates');
select pg_temp.check((select count(*) from storage.objects where name like 'candidate/%') = 0, 'reader: reads no CV object');
select pg_temp.check(public.academy_member_role() = 'client_reader' and public.academy_can_view_progress('00000000-0000-0000-0000-00000000d106'), 'reader: still follows the developer in the Academy');
reset role;

-- ---------------------------------------------------------------------------
-- 2. Client users are never moved to another client; stale memberships go.
-- ---------------------------------------------------------------------------
select pg_temp.act('hr.sec@nordavo.nl');
set role authenticated;
select pg_temp.refused($$select public.academy_add_person('00000000-0000-0000-0000-00000000d103', 'client_admin', null, null,
  '00000000-0000-0000-0000-00000000d1c2')$$, 'a client user of KG was moved to Acme');
select pg_temp.refused($$select public.academy_add_person_check(null, 'client_member', null)$$, 'check: client role without client');
select pg_temp.refused($$select public.academy_add_person_check(null, 'developer', null,
  (select id from public.academy_courses where slug = 'developer'), 'all', array['00000000-0000-0000-0000-00000000dead'::uuid])$$,
  'check: module of another course');
select pg_temp.refused($$select public.academy_add_person_check('00000000-0000-0000-0000-00000000d103', 'client_admin',
  '00000000-0000-0000-0000-00000000d1c2')$$, 'check: client user of another client');
select public.academy_add_person_check(null, 'candidate', null, (select id from public.academy_courses where slug = 'developer'), 'default', '{}');
select public.academy_add_person_check('00000000-0000-0000-0000-00000000d103', 'client_admin', '00000000-0000-0000-0000-00000000d1c1');
reset role;
select pg_temp.check((select client_id from public.profiles where email = 'boss.sec@kg.nl') = '00000000-0000-0000-0000-00000000d1c1', 'still at KG');

select pg_temp.act('lid.sec@kg.nl');
set role authenticated;
select pg_temp.refused($$select public.academy_add_person_check(null, 'candidate')$$, 'check: only managers');
reset role;

-- The calendar link of the placement exists before anyone leaves.
select pg_temp.act('boss.sec@kg.nl');
set role authenticated;
insert into ctx values ('token', public.academy_calendar_token('00000000-0000-0000-0000-00000000d191'));
select pg_temp.check((select count(*) from public.academy_calendar_feed((select v from ctx where k = 'token'))) > 0, 'the feed works');
reset role;

-- The member moves to Acme (an admin changes the profile): KG's placement loses him.
update public.profiles set client_id = '00000000-0000-0000-0000-00000000d1c2' where email = 'lid.sec@kg.nl';
select pg_temp.check(not exists (select 1 from public.academy_placement_members
  where profile_id = '00000000-0000-0000-0000-00000000d104'), 'no membership of the old client''s placement');
select pg_temp.check(exists (select 1 from public.academy_placement_members
  where profile_id = '00000000-0000-0000-0000-00000000d103'), 'the others stay');

-- ---------------------------------------------------------------------------
-- 4. Calendar link: rotated when a member leaves and when the placement ends.
-- ---------------------------------------------------------------------------
select pg_temp.check((select token from public.academy_placement_calendars where placement_id = '00000000-0000-0000-0000-00000000d191')
  <> (select v from ctx where k = 'token'), 'the token changed when the member left');
select pg_temp.check((select count(*) from public.academy_calendar_feed((select v from ctx where k = 'token'))) = 0, 'the old link stops working');

update ctx set v = (select token from public.academy_placement_calendars where placement_id = '00000000-0000-0000-0000-00000000d191') where k = 'token';
delete from public.academy_placement_members
where placement_id = '00000000-0000-0000-0000-00000000d191' and profile_id = '00000000-0000-0000-0000-00000000d105';
select pg_temp.check((select count(*) from public.academy_calendar_feed((select v from ctx where k = 'token'))) = 0, 'removing the reader rotates too');

update ctx set v = (select token from public.academy_placement_calendars where placement_id = '00000000-0000-0000-0000-00000000d191') where k = 'token';
select pg_temp.check((select count(*) from public.academy_calendar_feed((select v from ctx where k = 'token'))) > 0, 'the new link works');
update public.placements set status = 'ended', end_date = current_date where id = '00000000-0000-0000-0000-00000000d191';
select pg_temp.check((select token from public.academy_placement_calendars where placement_id = '00000000-0000-0000-0000-00000000d191')
  <> (select v from ctx where k = 'token'), 'the token changed when the placement ended');
select pg_temp.check((select count(*) from public.academy_calendar_feed(
  (select token from public.academy_placement_calendars where placement_id = '00000000-0000-0000-0000-00000000d191'))) = 0,
  'an ended placement has no feed, not even with the new token');
update public.placements set status = 'active', end_date = null where id = '00000000-0000-0000-0000-00000000d191';

-- ---------------------------------------------------------------------------
-- 3. Work: a guest who becomes a candidate or developer loses Work.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('admin.sec@nordavo.nl');
insert into ctx values ('ws', public.work_create_workspace('Security', 'security-test'));
reset role;
insert into public.work_members (workspace_id, user_id, role) values
  ((select v::uuid from ctx where k = 'ws'), '00000000-0000-0000-0000-00000000d109', 'guest'),
  ((select v::uuid from ctx where k = 'ws'), '00000000-0000-0000-0000-00000000d107', 'guest');
insert into public.work_api_tokens (user_id, name, token_hash, token_prefix) values
  ('00000000-0000-0000-0000-00000000d109', 'cli', 'hash-security-test', 'wrk_xxxxxxx');

select pg_temp.act('guest.sec@example.in');
set role authenticated;
select pg_temp.check(public.work_my_role((select v::uuid from ctx where k = 'ws')) = 'guest', 'the guest is in Work');
reset role;

-- The guest becomes a candidate (Academy), the other one a developer (placed).
select pg_temp.act('hr.sec@nordavo.nl');
set role authenticated;
select public.academy_add_person('00000000-0000-0000-0000-00000000d109', 'candidate', null, null, null,
  '00000000-0000-0000-0000-00000000d1f2', (select id from public.academy_courses where slug = 'developer'), 'default', '{}');
reset role;
select pg_temp.check((select deactivated_at is not null from public.work_members where user_id = '00000000-0000-0000-0000-00000000d109'),
  'candidate: Work membership deactivated');
select pg_temp.check((select revoked_at is not null from public.work_api_tokens where user_id = '00000000-0000-0000-0000-00000000d109'),
  'candidate: Work API token revoked');
select pg_temp.check(exists (select 1 from public.work_access_log where user_id = '00000000-0000-0000-0000-00000000d109' and action = 'deactivated'),
  'logged as deactivated');
select pg_temp.refused($$update public.work_members set deactivated_at = null where user_id = '00000000-0000-0000-0000-00000000d109'$$,
  'a candidate got an active Work membership again');

-- Even an active row (from before) gives no access: role_in checks the portal role.
alter table public.work_members disable trigger work_members_portal_role_guard;
update public.work_members set deactivated_at = null where user_id = '00000000-0000-0000-0000-00000000d109';
alter table public.work_members enable trigger work_members_portal_role_guard;
select pg_temp.act('guest.sec@example.in');
set role authenticated;
select pg_temp.check(public.work_my_role((select v::uuid from ctx where k = 'ws')) is null, 'candidate: no Work role');
select pg_temp.check((select count(*) from public.work_workspaces) = 0, 'candidate: sees no workspace');
reset role;

update public.profiles set role = 'developer' where id = '00000000-0000-0000-0000-00000000d107';
select pg_temp.check((select deactivated_at is not null from public.work_members where user_id = '00000000-0000-0000-0000-00000000d107'),
  'developer: Work membership deactivated');

-- ---------------------------------------------------------------------------
-- 5. Helpers with a profile id answer only for the caller (or a manager).
-- ---------------------------------------------------------------------------
select pg_temp.act('dev.sec@example.in');
set role authenticated;
select pg_temp.check(public.academy_member_role() = 'developer', 'own role');
select pg_temp.check(public.academy_member_role('00000000-0000-0000-0000-00000000d106') = 'developer', 'own role by id');
select pg_temp.check(public.academy_member_role('00000000-0000-0000-0000-00000000d103') is null, 'no role of someone else');
select pg_temp.check(public.academy_has_course((select v::uuid from ctx where k = 'devcourse')), 'own course');
select pg_temp.check(not public.academy_has_course((select v::uuid from ctx where k = 'devcourse'),
  '00000000-0000-0000-0000-00000000d109'), 'no course of someone else');
select pg_temp.check(public.academy_placement_role('00000000-0000-0000-0000-00000000d191') = 'developer', 'own placement role');
select pg_temp.check(public.academy_placement_role('00000000-0000-0000-0000-00000000d191', '00000000-0000-0000-0000-00000000d103') is null,
  'no placement role of someone else');
select pg_temp.check(public.academy_person_client('00000000-0000-0000-0000-00000000d103') is null, 'no client of someone else');
select pg_temp.check(public.academy_person_client('00000000-0000-0000-0000-00000000d106') = '00000000-0000-0000-0000-00000000d1c1', 'own client via the placement');
-- RLS that uses them still works: the developer reads the people of the placement.
select pg_temp.check((select count(*) from public.academy_placement_people('00000000-0000-0000-0000-00000000d191')) >= 2, 'placement people');
reset role;

select pg_temp.act('hr.sec@nordavo.nl');
set role authenticated;
select pg_temp.check(public.academy_member_role('00000000-0000-0000-0000-00000000d103') = 'client_admin', 'manager: anyone''s role');
select pg_temp.check(public.academy_placement_role('00000000-0000-0000-0000-00000000d191', '00000000-0000-0000-0000-00000000d103') = 'client_admin',
  'manager: anyone''s placement role');
select pg_temp.check(public.academy_person_client('00000000-0000-0000-0000-00000000d103') = '00000000-0000-0000-0000-00000000d1c1', 'manager: anyone''s client');
reset role;

-- ---------------------------------------------------------------------------
-- 6. A vacancy with two auto-enrol groups: a group whose event already
-- exists is not enrolled again with the previous group's event.
-- ---------------------------------------------------------------------------
insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-00000000d1e2', '00000000-0000-0000-0000-00000000d1c1', 'React developer');
insert into public.academy_groups (id, name, kind, vacancy_id) values
  ('00000000-0000-0000-0000-00000000d1a1', 'React A', 'vacancy', '00000000-0000-0000-0000-00000000d1e2'),
  ('00000000-0000-0000-0000-00000000d1a2', 'React B', 'vacancy', '00000000-0000-0000-0000-00000000d1e2');
insert into public.academy_group_settings (group_id, auto_enrol) values
  ('00000000-0000-0000-0000-00000000d1a1', true),
  ('00000000-0000-0000-0000-00000000d1a2', true);
-- Group B was handled before (skipped): its event exists.
insert into public.academy_ats_events (kind, dedupe_key, candidate_id, vacancy_id, group_id, status)
values ('vacancy_linked', 'vacancy_linked:00000000-0000-0000-0000-00000000d1f2:00000000-0000-0000-0000-00000000d1a2',
  '00000000-0000-0000-0000-00000000d1f2', '00000000-0000-0000-0000-00000000d1e2', '00000000-0000-0000-0000-00000000d1a2', 'skipped');
insert into public.applications (vacancy_id, candidate_id) values
  ('00000000-0000-0000-0000-00000000d1e2', '00000000-0000-0000-0000-00000000d1f2');
select pg_temp.check(exists (select 1 from public.academy_group_members where group_id = '00000000-0000-0000-0000-00000000d1a1'
  and profile_id = '00000000-0000-0000-0000-00000000d109'), 'group A enrolled');
select pg_temp.check(not exists (select 1 from public.academy_group_members where group_id = '00000000-0000-0000-0000-00000000d1a2'
  and profile_id = '00000000-0000-0000-0000-00000000d109'), 'group B (event existed) not enrolled with group A''s event');
select pg_temp.check((select status from public.academy_ats_events where group_id = '00000000-0000-0000-0000-00000000d1a2') = 'skipped',
  'group B''s event untouched');

-- ---------------------------------------------------------------------------
-- 7. Worksheet answers: submitted answers cannot be deleted (and re-made).
-- ---------------------------------------------------------------------------
insert into public.academy_documents (id, title, kind, worksheet_fields) values
  ('00000000-0000-0000-0000-00000000d1d1', 'Plan', 'worksheet', '[]'),
  ('00000000-0000-0000-0000-00000000d1d2', 'Draft', 'worksheet', '[]');
select pg_temp.act('hr.sec@nordavo.nl');
insert into public.academy_worksheet_answers (document_id, profile_id, answers, submitted_at) values
  ('00000000-0000-0000-0000-00000000d1d1', '00000000-0000-0000-0000-00000000d106', '{"a": "locked"}', now()),
  ('00000000-0000-0000-0000-00000000d1d2', '00000000-0000-0000-0000-00000000d106', '{"a": "draft"}', null);
select pg_temp.act('dev.sec@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_worksheet_answers) = 2, 'the developer reads own answers');
delete from public.academy_worksheet_answers;
reset role;
select pg_temp.check(exists (select 1 from public.academy_worksheet_answers where document_id = '00000000-0000-0000-0000-00000000d1d1'
  and answers ->> 'a' = 'locked'), 'submitted answers stay');
select pg_temp.check(not exists (select 1 from public.academy_worksheet_answers where document_id = '00000000-0000-0000-0000-00000000d1d2'),
  'a draft may be deleted');

-- ---------------------------------------------------------------------------
-- 8. Knowledge checks in the ATS: the first attempt counts.
-- ---------------------------------------------------------------------------
insert into public.academy_lessons (id, title) values ('00000000-0000-0000-0000-00000000d1d5', 'Check lesson');
insert into public.academy_lesson_blocks (id, lesson_id, type, position) values
  ('00000000-0000-0000-0000-00000000d1d6', '00000000-0000-0000-0000-00000000d1d5', 'knowledge_check', 1);
insert into public.academy_check_attempts (block_id, profile_id, score, max_score, created_at) values
  ('00000000-0000-0000-0000-00000000d1d6', '00000000-0000-0000-0000-00000000d106', 1, 4, now() - interval '2 hours'),
  ('00000000-0000-0000-0000-00000000d1d6', '00000000-0000-0000-0000-00000000d106', 4, 4, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000d1d6', '00000000-0000-0000-0000-00000000d106', 3, 4, now());
select pg_temp.act('hr.sec@nordavo.nl');
set role authenticated;
select pg_temp.check((select first_percent = 25 and best_percent = 100 and last_percent = 75 and attempts = 3
  from public.academy_candidate_check_scores('00000000-0000-0000-0000-00000000d1f1')), 'card: first, best and last');
select pg_temp.check((select check_average_percent from public.academy_candidate_learn_summary(array['00000000-0000-0000-0000-00000000d1f1'::uuid])) = 25,
  'summary: average of first attempts');
select pg_temp.check((select (c ->> 'first_percent')::int = 25 and (c ->> 'best_percent')::int = 100
  from jsonb_array_elements(public.academy_person_detail('00000000-0000-0000-0000-00000000d106') -> 'checks') c),
  'person detail: first next to best');
reset role;

rollback;
