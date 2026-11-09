-- Nordavo Working Style Profile (supabase/migrations/20261116000000_wsp_core.sql,
-- 20261116010000_wsp_flow.sql): scoring test cases, quality flags,
-- settings on three levels, automatic and manual invitations, the
-- questionnaire through the personal link, the report per role, sharing
-- only by the person (RLS), withdrawing with the mail, permission requests,
-- placements, reminders, deleting, retention and the audit log. Every
-- acceptance criterion of part 4 that lives in the database is here.
-- One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000e0001', 'admin.wsp@nordavo.nl', '{"full_name": "Admin"}'),
  ('00000000-0000-0000-0000-0000000e0002', 'rec.wsp@nordavo.nl', '{"full_name": "Recruiter"}'),
  ('00000000-0000-0000-0000-0000000e0003', 'sales.wsp@nordavo.nl', '{"full_name": "Sales"}'),
  ('00000000-0000-0000-0000-0000000e0004', 'boss.wsp@kg.nl', '{"full_name": "Klant KG"}'),
  ('00000000-0000-0000-0000-0000000e0005', 'boss.wsp@acme.nl', '{"full_name": "Klant Acme"}'),
  ('00000000-0000-0000-0000-0000000e0006', 'ravi.wsp@example.in', '{"full_name": "Ravi Kumar"}'),
  ('00000000-0000-0000-0000-0000000e0007', 'lid.wsp@kg.nl', '{"full_name": "Klant lid"}'),
  ('00000000-0000-0000-0000-0000000e0008', 'mina.wsp@example.in', '{"full_name": "Mina Rao"}'),
  ('00000000-0000-0000-0000-0000000e0009', 'hr.wsp@nordavo.nl', '{"full_name": "HR"}');

update public.profiles set role = 'admin' where email = 'admin.wsp@nordavo.nl';
update public.profiles set role = 'member', modules = array['recruitment'] where email = 'rec.wsp@nordavo.nl';
update public.profiles set role = 'member', modules = array['sales'] where email = 'sales.wsp@nordavo.nl';
update public.profiles set role = 'member', modules = array['recruitment', 'academy'] where email = 'hr.wsp@nordavo.nl';

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-0000000e1001', 'KG', 'active'),
  ('00000000-0000-0000-0000-0000000e1002', 'Acme', 'active');
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000e1001' where email in ('boss.wsp@kg.nl', 'lid.wsp@kg.nl');
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000e1002' where email = 'boss.wsp@acme.nl';
insert into public.client_contacts (client_id, full_name, email, is_primary) values
  ('00000000-0000-0000-0000-0000000e1001', 'Klant KG', 'boss.wsp@kg.nl', true);

insert into public.candidates (id, full_name, email, current_title) values
  ('00000000-0000-0000-0000-0000000e3001', 'Ravi Kumar', 'ravi.wsp@example.in', 'Backend developer'),
  ('00000000-0000-0000-0000-0000000e3002', 'Mina Rao', 'mina.wsp@example.in', null),
  ('00000000-0000-0000-0000-0000000e3003', 'Never Person', 'never.wsp@example.in', null),
  ('00000000-0000-0000-0000-0000000e3004', 'Always Person', 'always.wsp@example.in', null),
  ('00000000-0000-0000-0000-0000000e3005', 'High Scorer', 'high.wsp@example.in', null),
  ('00000000-0000-0000-0000-0000000e3006', 'Low Scorer', 'low.wsp@example.in', null),
  ('00000000-0000-0000-0000-0000000e3007', 'Yes Sayer', 'yes.wsp@example.in', null),
  ('00000000-0000-0000-0000-0000000e3008', 'Dev Without', 'dev1.wsp@example.in', null),
  ('00000000-0000-0000-0000-0000000e3009', 'Dev Auto', 'dev2.wsp@example.in', null),
  ('00000000-0000-0000-0000-0000000e300a', 'Old Candidate', 'old.wsp@example.in', null),
  ('00000000-0000-0000-0000-0000000e300b', 'Pool Candidate', 'pool.wsp@example.in', null);

create or replace function pg_temp.act(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = p_email),
    'role', 'authenticated',
    'email', p_email)::text, false);
end $$;

create or replace function pg_temp.anon() returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', false);
end $$;

create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_what; end if;
end $$;

-- True when the statement raises (any error).
create or replace function pg_temp.fails(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

-- Answer all 52 statements through the personal link, like the page does.
--   all3: every statement 3, the checks as asked
--   high: normal 5, reversed 1, the checks as asked
--   low:  normal 1, reversed 5, the checks as asked
--   yes:  everything 5 (also the checks)
--   mixed: varied answers, the checks as asked
create or replace function pg_temp.fill(p_token text, p_rule text, p_ms integer) returns void language plpgsql security definer as $$
declare
  v_item record;
  v_answer integer;
begin
  for v_item in select * from public.wsp_items where instrument_version = 'nordavo-wsp-v1' order by position loop
    v_answer := case
      when p_rule = 'yes' then 5
      when v_item.dimension = 'check' then v_item.expected_answer
      when p_rule = 'all3' then 3
      when p_rule = 'high' then case when v_item.key = 'normal' then 5 else 1 end
      when p_rule = 'low' then case when v_item.key = 'normal' then 1 else 5 end
      else 1 + (v_item.position * 7) % 5
    end;
    perform public.wsp_save_answer(p_token, null, v_item.id, v_answer, ceil(v_item.position / 10.0)::integer, p_ms);
  end loop;
end $$;

create or replace function pg_temp.token(p_person uuid) returns text language sql security definer as $$
  select invite_token from public.wsp_assessments where person_id = p_person and status <> 'deleted' order by created_at desc limit 1;
$$;
create or replace function pg_temp.aid(p_person uuid) returns uuid language sql security definer as $$
  select id from public.wsp_assessments where person_id = p_person and status <> 'deleted' order by created_at desc limit 1;
$$;
create or replace function pg_temp.count_for(p_person uuid) returns integer language sql security definer as $$
  select count(*)::integer from public.wsp_assessments where person_id = p_person;
$$;

create or replace function pg_temp.item(p_code text) returns uuid language sql security definer as $$
  select id from public.wsp_items where code = p_code and instrument_version = 'nordavo-wsp-v1';
$$;

-- Academy accounts: Ravi and Mina are candidates in the Academy, linked to their ATS candidate.
select pg_temp.act('hr.wsp@nordavo.nl');
set role authenticated;
select public.academy_add_person('00000000-0000-0000-0000-0000000e0006', 'candidate', null, null, null,
  '00000000-0000-0000-0000-0000000e3001', (select id from public.academy_courses where slug = 'developer'), 'default', '{}');
select public.academy_add_person('00000000-0000-0000-0000-0000000e0008', 'candidate', null, null, null,
  '00000000-0000-0000-0000-0000000e3002', (select id from public.academy_courses where slug = 'developer'), 'default', '{}');
select public.academy_add_person('00000000-0000-0000-0000-0000000e0007', 'client_member', null, null, '00000000-0000-0000-0000-0000000e1001');
reset role;

-- ---------------------------------------------------------------------------
-- 1. Scoring test cases (part 2) and the statements.
-- ---------------------------------------------------------------------------
select pg_temp.check(wsp_private.score_from_mean(3.6) = 65 and wsp_private.band(65) = 'middle', 'mean 3.6: score 65, Middle');
select pg_temp.check(wsp_private.score_from_mean(3.64) = 66 and wsp_private.band(66) = 'higher', 'mean 3.64: score 66, Higher side');
select pg_temp.check(wsp_private.score_from_mean(3) = 50 and wsp_private.score_from_mean(5) = 100 and wsp_private.score_from_mean(1) = 0, 'mean 3, 5, 1');
select pg_temp.check(wsp_private.band(34) = 'lower' and wsp_private.band(35) = 'middle' and wsp_private.band(0) = 'lower' and wsp_private.band(100) = 'higher', 'band limits');
select pg_temp.check((select count(*) from public.wsp_items where instrument_version = 'nordavo-wsp-v1') = 52, '52 statements');
select pg_temp.check((select count(*) from public.wsp_items where dimension <> 'check') = 50, '50 scored statements');
select pg_temp.check((select bool_and(n = 10) from (select count(*) as n from public.wsp_items where dimension <> 'check' group by dimension) d), '10 per dimension');
select pg_temp.check((select position = 23 and expected_answer = 4 from public.wsp_items where code = 'CHK1'), 'CHK1 at 23, expects 4');
select pg_temp.check((select position = 44 and expected_answer = 1 from public.wsp_items where code = 'CHK2'), 'CHK2 at 44, expects 1');

-- ---------------------------------------------------------------------------
-- 2. System off (the default): no invitation at all.
-- ---------------------------------------------------------------------------
select pg_temp.check(not public.wsp_enabled(), 'off by default');
insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000e2009', '00000000-0000-0000-0000-0000000e1001', 'Off test');
insert into public.applications (id, vacancy_id, candidate_id, stage, shortlisted_at) values
  ('00000000-0000-0000-0000-0000000e4009', '00000000-0000-0000-0000-0000000e2009', '00000000-0000-0000-0000-0000000e3004', 'interview', now());
update public.candidates set wsp_mode = 'always' where id = '00000000-0000-0000-0000-0000000e3004';
update public.applications set shortlisted_at = null where id = '00000000-0000-0000-0000-0000000e4009';
update public.applications set shortlisted_at = now() where id = '00000000-0000-0000-0000-0000000e4009';
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3004') = 0, 'system off: no automatic invitation, also not for Always');
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check(pg_temp.fails($$select public.wsp_send('00000000-0000-0000-0000-0000000e3004')$$), 'system off: no manual invitation');
reset role;
delete from public.applications where id = '00000000-0000-0000-0000-0000000e4009';

-- ---------------------------------------------------------------------------
-- 3. Settings: only admins; staff reads them; every change is logged.
-- ---------------------------------------------------------------------------
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.wsp_settings) = 1, 'staff reads the settings');
select pg_temp.check(pg_temp.fails($$select public.wsp_update_settings('{"enabled": true}')$$), 'staff cannot change the settings');
select pg_temp.check(pg_temp.fails($$update public.wsp_settings set enabled = true$$), 'no direct update');
reset role;
select pg_temp.act('sales.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.wsp_settings) = 0, 'sales does not read the settings');
reset role;
select pg_temp.act('boss.wsp@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.wsp_settings) = 0, 'clients do not read the settings');
reset role;

select pg_temp.act('admin.wsp@nordavo.nl');
set role authenticated;
select public.wsp_update_settings('{"enabled": true}');
reset role;
select pg_temp.check(public.wsp_enabled(), 'admin switched it on');
select pg_temp.check((select trigger_stage_id = 'shortlist' and default_for_new_vacancies and not auto_invite_developers_on_placement
  from public.wsp_settings), 'defaults: Shortlist, on for new vacancies, developers off');
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'settings_changed' and details ->> 'scope' = 'system'
  and actor = '00000000-0000-0000-0000-0000000e0001' and actor_role = 'admin') = 1, 'settings change logged with the admin');

-- Vacancies: new ones follow the system default.
insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000e2001', '00000000-0000-0000-0000-0000000e1001', 'Backend'),
  ('00000000-0000-0000-0000-0000000e2002', '00000000-0000-0000-0000-0000000e1001', 'Data'),
  ('00000000-0000-0000-0000-0000000e2003', '00000000-0000-0000-0000-0000000e1002', 'Frontend');
select pg_temp.check((select bool_and(wsp_enabled) from public.vacancies where id in (
  '00000000-0000-0000-0000-0000000e2001', '00000000-0000-0000-0000-0000000e2002', '00000000-0000-0000-0000-0000000e2003')), 'new vacancies: on by default');
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
update public.vacancies set wsp_enabled = false where id = '00000000-0000-0000-0000-0000000e2002';
update public.candidates set wsp_mode = 'never' where id = '00000000-0000-0000-0000-0000000e3003';
reset role;
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'settings_changed' and details ->> 'scope' = 'vacancy'
  and actor = '00000000-0000-0000-0000-0000000e0002') = 1, 'vacancy setting change logged');
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'settings_changed' and details ->> 'scope' = 'person'
  and details ->> 'new' = 'never') = 1, 'person setting change logged');

-- ---------------------------------------------------------------------------
-- 4. Automatic invitation on the trigger stage (Shortlist).
-- ---------------------------------------------------------------------------
insert into public.applications (id, vacancy_id, candidate_id, stage) values
  ('00000000-0000-0000-0000-0000000e4001', '00000000-0000-0000-0000-0000000e2001', '00000000-0000-0000-0000-0000000e3001', 'interview'),
  ('00000000-0000-0000-0000-0000000e4002', '00000000-0000-0000-0000-0000000e2002', '00000000-0000-0000-0000-0000000e3004', 'interview'),
  ('00000000-0000-0000-0000-0000000e4003', '00000000-0000-0000-0000-0000000e2001', '00000000-0000-0000-0000-0000000e3003', 'interview'),
  ('00000000-0000-0000-0000-0000000e4004', '00000000-0000-0000-0000-0000000e2002', '00000000-0000-0000-0000-0000000e3002', 'interview');
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3001') = 0, 'not shortlisted yet: nothing');

update public.applications set shortlisted_at = now() where id in (
  '00000000-0000-0000-0000-0000000e4001', '00000000-0000-0000-0000-0000000e4002',
  '00000000-0000-0000-0000-0000000e4003', '00000000-0000-0000-0000-0000000e4004');

select pg_temp.check((select status = 'invited' and invite_reason = 'trigger_stage' and invited_by is null and person_type = 'candidate'
  and instrument_version = 'nordavo-wsp-v1' and expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour'
  and invite_token ~ '^[0-9a-f]{64}$'
  from public.wsp_assessments where person_id = '00000000-0000-0000-0000-0000000e3001'), 'vacancy on, follow vacancy: invited by the system, link valid 14 days');
select pg_temp.check((select count(*) from public.wsp_assessment_links where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001')
  and vacancy_id = '00000000-0000-0000-0000-0000000e2001' and client_id = '00000000-0000-0000-0000-0000000e1001') = 1, 'linked to the vacancy and its client');
select pg_temp.check((select actor is null and actor_role = 'system' and details ->> 'reason' = 'trigger_stage' and details ->> 'stage' = 'shortlist'
  and details ->> 'vacancy_id' = '00000000-0000-0000-0000-0000000e2001'
  from public.wsp_audit_log where action = 'invited' and assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001')),
  'audit: invited by system, why (trigger stage and vacancy)');
select pg_temp.check((select count(*) from public.wsp_outbox where kind = 'invite' and assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) = 1, 'invitation mail queued');
select pg_temp.check((select count(*) from public.academy_notifications where profile_id = '00000000-0000-0000-0000-0000000e0006' and kind = 'wsp_invite') = 1,
  'an Academy account also gets a notification');

select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3004') = 1, 'vacancy off and person Always: invited');
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3003') = 0, 'vacancy on and person Never: not invited');
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3002') = 0, 'vacancy off and follow vacancy: not invited');

-- Back to an earlier stage and to the trigger stage again: no second invitation.
update public.applications set shortlisted_at = null where id = '00000000-0000-0000-0000-0000000e4001';
update public.applications set shortlisted_at = now() where id = '00000000-0000-0000-0000-0000000e4001';
update public.applications set stage = 'technical_test' where id = '00000000-0000-0000-0000-0000000e4001';
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3001') = 1, 'no second invitation on re-entry');

-- A stage as trigger: the stage itself, entering it once.
select pg_temp.act('admin.wsp@nordavo.nl');
set role authenticated;
select public.wsp_update_settings('{"trigger_stage_id": "client_interview"}');
reset role;
insert into public.applications (id, vacancy_id, candidate_id, stage) values
  ('00000000-0000-0000-0000-0000000e400a', '00000000-0000-0000-0000-0000000e2001', '00000000-0000-0000-0000-0000000e300a', 'interview');
update public.applications set shortlisted_at = now() where id = '00000000-0000-0000-0000-0000000e400a';
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e300a') = 0, 'other trigger stage: the shortlist mark does nothing');
update public.applications set stage = 'client_interview' where id = '00000000-0000-0000-0000-0000000e400a';
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e300a') = 1, 'moving into the trigger stage invites');
select pg_temp.act('admin.wsp@nordavo.nl');
set role authenticated;
select public.wsp_update_settings('{"trigger_stage_id": "shortlist"}');
reset role;

-- ---------------------------------------------------------------------------
-- 5. Manual invitation: staff only, not for Never, also when the vacancy is off.
-- ---------------------------------------------------------------------------
select pg_temp.act('sales.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check(pg_temp.fails($$select public.wsp_send('00000000-0000-0000-0000-0000000e3002')$$), 'sales cannot invite');
reset role;
select pg_temp.act('boss.wsp@kg.nl');
set role authenticated;
select pg_temp.check(pg_temp.fails($$select public.wsp_send('00000000-0000-0000-0000-0000000e3002')$$), 'clients cannot invite');
reset role;
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check(pg_temp.fails($$select public.wsp_send('00000000-0000-0000-0000-0000000e3003')$$), 'Never: no manual invitation either');
select public.wsp_send('00000000-0000-0000-0000-0000000e3002', '00000000-0000-0000-0000-0000000e2002');
select pg_temp.check(pg_temp.fails($$select public.wsp_send('00000000-0000-0000-0000-0000000e3002')$$), 'at most one open assessment');
select public.wsp_send('00000000-0000-0000-0000-0000000e3005');
select public.wsp_send('00000000-0000-0000-0000-0000000e3006');
select public.wsp_send('00000000-0000-0000-0000-0000000e3007');
reset role;
select pg_temp.check((select invite_reason = 'manual' and invited_by = '00000000-0000-0000-0000-0000000e0002'
  from public.wsp_assessments where person_id = '00000000-0000-0000-0000-0000000e3002'), 'manual: by the staff member');
select pg_temp.check((select details ->> 'reason' = 'manual' and actor = '00000000-0000-0000-0000-0000000e0002' and actor_role = 'staff'
  from public.wsp_audit_log where action = 'invited' and assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3002')), 'audit: manual by staff');

-- ---------------------------------------------------------------------------
-- 6. The questionnaire through the personal link (signed out).
-- ---------------------------------------------------------------------------
select pg_temp.anon();
set role anon;
select pg_temp.check(public.wsp_questionnaire(repeat('0', 64)) is null, 'unknown link: nothing');
select pg_temp.check(pg_temp.fails($$select count(*) from public.wsp_answers$$), 'signed out reads no table');
select pg_temp.check(pg_temp.fails($$select count(*) from public.wsp_assessments$$), 'signed out reads no assessments');
select pg_temp.check((public.wsp_questionnaire(pg_temp.token('00000000-0000-0000-0000-0000000e3001')) ->> 'status') = 'invited', 'the link opens the intro');
select pg_temp.check(jsonb_array_length(public.wsp_questionnaire(pg_temp.token('00000000-0000-0000-0000-0000000e3001')) -> 'items') = 52, '52 statements');
select pg_temp.check((public.wsp_questionnaire(pg_temp.token('00000000-0000-0000-0000-0000000e3001')) -> 'items' -> 22 ->> 'statement')
  = 'For this statement, please select "Moderately accurate".', 'fixed order, exact text');
select pg_temp.check(pg_temp.fails(format($$select public.wsp_save_answer(%L, null, pg_temp.item('E1'), 3, 1)$$,
  pg_temp.token('00000000-0000-0000-0000-0000000e3001'))), 'no answer without the intro checkbox');
select public.wsp_accept_intro(pg_temp.token('00000000-0000-0000-0000-0000000e3001'));
reset role;
select pg_temp.check((select status = 'started' and intro_accepted_at is not null and started_at is not null
  from public.wsp_assessments where person_id = '00000000-0000-0000-0000-0000000e3001'), 'intro accepted: started');

-- Stop halfway and continue later on the same page.
do $$
declare
  v_item record;
  v_token text := pg_temp.token('00000000-0000-0000-0000-0000000e3001');
begin
  for v_item in select * from public.wsp_items where position <= 13 order by position loop
    perform public.wsp_save_answer(v_token, null, v_item.id, 3, ceil(v_item.position / 10.0)::integer, 4000);
  end loop;
end $$;
select pg_temp.anon();
set role anon;
select pg_temp.check((public.wsp_questionnaire(pg_temp.token('00000000-0000-0000-0000-0000000e3001')) ->> 'page')::integer = 2, 'resume on page 2');
select pg_temp.check((select count(*) from jsonb_object_keys(public.wsp_questionnaire(pg_temp.token('00000000-0000-0000-0000-0000000e3001')) -> 'answers')) = 13, 'answers kept');
select pg_temp.check(pg_temp.fails(format($$select public.wsp_save_answer(%L, null, pg_temp.item('O10'), 3, 1)$$,
  pg_temp.token('00000000-0000-0000-0000-0000000e3001'))), 'a statement of another page is refused');
select pg_temp.check(pg_temp.fails(format($$select public.wsp_complete(%L)$$, pg_temp.token('00000000-0000-0000-0000-0000000e3001'))), 'every statement is required');
reset role;
select pg_temp.check((select max(page_duration_ms) from public.wsp_answers where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001') and page_number = 1) = 40000,
  'time per page recorded (10 x 4 seconds)');
select pg_temp.check((select bool_and(page_duration_ms = 40000) from public.wsp_answers where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001') and page_number = 1),
  'every answer of the page carries the page time');

-- Test case: all 50 answers 3 (checks as asked), slow enough.
select pg_temp.fill(pg_temp.token('00000000-0000-0000-0000-0000000e3001'), 'all3', 5000);
select pg_temp.anon();
set role anon;
select public.wsp_complete(pg_temp.token('00000000-0000-0000-0000-0000000e3001'));
reset role;
select pg_temp.check((select status = 'completed' and completed_at is not null from public.wsp_assessments where person_id = '00000000-0000-0000-0000-0000000e3001'), 'completed');
select pg_temp.check((select count(*) = 5 and bool_and(score_0_100 = 50 and band = 'middle' and mean_score = 3)
  from public.wsp_results where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001')), 'test case: all 3 gives 50, Middle');
select pg_temp.check((select array_agg(flag_type order by flag_type) from public.wsp_flags where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001'))
  = array['straightlining'], 'all 3: straightlining (22 times the same in a row), nothing else');
select pg_temp.check((select (payload -> 'flags') = '["straightlining"]' from public.wsp_outbox where kind = 'completed'
  and assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001')), 'staff mail queued with the flags');

-- Test cases: normal 5 and reversed 1 gives 100; normal 1 and reversed 5 gives 0.
select public.wsp_accept_intro(pg_temp.token('00000000-0000-0000-0000-0000000e3005'));
select pg_temp.fill(pg_temp.token('00000000-0000-0000-0000-0000000e3005'), 'high', 5000);
select public.wsp_complete(pg_temp.token('00000000-0000-0000-0000-0000000e3005'));
select pg_temp.check((select count(*) = 5 and bool_and(score_0_100 = 100 and band = 'higher')
  from public.wsp_results where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3005')), 'test case: all scores 100');
select public.wsp_accept_intro(pg_temp.token('00000000-0000-0000-0000-0000000e3006'));
select pg_temp.fill(pg_temp.token('00000000-0000-0000-0000-0000000e3006'), 'low', 5000);
select public.wsp_complete(pg_temp.token('00000000-0000-0000-0000-0000000e3006'));
select pg_temp.check((select count(*) = 5 and bool_and(score_0_100 = 0 and band = 'lower')
  from public.wsp_results where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3006')), 'test case: all scores 0');

-- Flags: everything 5, very fast: all four flags.
select public.wsp_accept_intro(pg_temp.token('00000000-0000-0000-0000-0000000e3007'));
select pg_temp.fill(pg_temp.token('00000000-0000-0000-0000-0000000e3007'), 'yes', 100);
select public.wsp_complete(pg_temp.token('00000000-0000-0000-0000-0000000e3007'));
select pg_temp.check((select array_agg(flag_type order by flag_type) from public.wsp_flags where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3007'))
  = array['attention_check_failed', 'straightlining', 'too_fast', 'yes_saying'], 'all four flags');
select pg_temp.check((select details = '{"CHK1": 5, "CHK2": 5}' from public.wsp_flags where flag_type = 'attention_check_failed'
  and assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3007')), 'attention flag says which check');
select pg_temp.check((select (details ->> 'seconds_per_statement')::numeric = 0.1 from public.wsp_flags where flag_type = 'too_fast'
  and assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3007')), 'too fast: 0.1 seconds per statement');
select pg_temp.check((select (details ->> 'run')::integer = 52 from public.wsp_flags where flag_type = 'straightlining'
  and assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3007')), 'straightlining: 52 in a row');
-- A page longer than 10 minutes does not count for too_fast.
update public.wsp_answers set page_duration_ms = 700000 where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3007') and page_number <> 1;
update public.wsp_answers set page_duration_ms = 30000 where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3007') and page_number = 1;
select wsp_private.compute_flags(pg_temp.aid('00000000-0000-0000-0000-0000000e3007'));
select pg_temp.check(not exists (select 1 from public.wsp_flags where flag_type = 'too_fast' and assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3007')),
  'pages over 10 minutes are left out (page 1: 3 seconds per statement)');
-- Mixed answers, checks right, slow: no flags; the report is made in every case.
select pg_temp.check((select count(*) from public.wsp_results where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3007')) = 5, 'report made despite flags');

-- ---------------------------------------------------------------------------
-- 7. The report per role.
-- ---------------------------------------------------------------------------
select pg_temp.anon();
set role anon;
select pg_temp.check((public.wsp_report(null, pg_temp.token('00000000-0000-0000-0000-0000000e3001')) ->> 'audience') = 'person', 'personal link: the person''s report');
select pg_temp.check(jsonb_array_length(public.wsp_report(null, pg_temp.token('00000000-0000-0000-0000-0000000e3001')) -> 'results') = 5, 'five dimensions');
select pg_temp.check(public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) is null, 'signed out without the link: nothing');
reset role;

select pg_temp.act('ravi.wsp@example.in');
set role authenticated;
select pg_temp.check((public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) ->> 'audience') = 'person', 'own account: own report');
select pg_temp.check((public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) ->> 'can_share')::boolean, 'own account may share');
select pg_temp.check((public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) -> 'clients' -> 0 ->> 'status') = 'not_shared', 'linked client: not shared');
select pg_temp.check((select count(*) from public.wsp_answers) = 52, 'the person reads own answers');
select pg_temp.check((select count(*) from public.wsp_flags) = 0, 'the person sees no flags');
select pg_temp.check(public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3005')) is null, 'not someone else''s report');
reset role;

select pg_temp.act('mina.wsp@example.in');
set role authenticated;
select pg_temp.check(public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) is null, 'another candidate: nothing');
select pg_temp.check((select count(*) from public.wsp_results where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) = 0, 'another candidate: no results');
reset role;

select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check((public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) ->> 'audience') = 'staff', 'staff: report with the client intro');
select pg_temp.check((select count(*) from public.wsp_flags where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3007')) = 3, 'staff reads flags');
select pg_temp.check((select count(*) from public.wsp_answers where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) = 52, 'staff reads raw answers');
reset role;

-- A client without a share: nothing through any door.
select pg_temp.act('boss.wsp@kg.nl');
set role authenticated;
select pg_temp.check(public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) is null, 'client without share: no report');
select pg_temp.check(public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), null, true) is null, 'client without share: no PDF data');
select pg_temp.check((select count(*) from public.wsp_results) = 0, 'client without share: no results through the API');
select pg_temp.check((select count(*) from public.wsp_assessments) = 0, 'client: never the assessment row (no link token)');
select pg_temp.check((select count(*) from public.wsp_client_reports()) = 0, 'client without share: empty list');
reset role;

-- ---------------------------------------------------------------------------
-- 8. Sharing: only the person, from their own account.
-- ---------------------------------------------------------------------------
select pg_temp.check((select count(*) from public.wsp_shares) = 0, 'nothing is shared by default (the box is never ticked)');

select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check(pg_temp.fails(format($$insert into public.wsp_shares (assessment_id, client_id, consented_by) values (%L, %L, %L)$$,
  pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e0006')),
  'staff cannot consent on behalf of the person');
select pg_temp.check(pg_temp.fails(format($$insert into public.wsp_shares (assessment_id, client_id, consented_by) values (%L, %L, %L)$$,
  pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e0002')),
  'staff cannot consent as themselves');
reset role;
select pg_temp.act('admin.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check(pg_temp.fails(format($$insert into public.wsp_shares (assessment_id, client_id, consented_by) values (%L, %L, %L)$$,
  pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e0001')),
  'admins cannot consent either');
reset role;
select pg_temp.act('boss.wsp@kg.nl');
set role authenticated;
select pg_temp.check(pg_temp.fails(format($$insert into public.wsp_shares (assessment_id, client_id, consented_by) values (%L, %L, %L)$$,
  pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e0004')),
  'the client cannot share it with itself');
reset role;
select pg_temp.act('mina.wsp@example.in');
set role authenticated;
select pg_temp.check(pg_temp.fails(format($$insert into public.wsp_shares (assessment_id, client_id, consented_by) values (%L, %L, %L)$$,
  pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e0008')),
  'another candidate cannot share it');
reset role;
select pg_temp.anon();
set role anon;
select pg_temp.check(pg_temp.fails(format($$insert into public.wsp_shares (assessment_id, client_id, consented_by) values (%L, %L, %L)$$,
  pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e0006')),
  'not signed out (the personal link cannot share)');
reset role;

select pg_temp.act('ravi.wsp@example.in');
set role authenticated;
select pg_temp.check(pg_temp.fails(format($$insert into public.wsp_shares (assessment_id, client_id, consented_by) values (%L, %L, %L)$$,
  pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1002', '00000000-0000-0000-0000-0000000e0006')),
  'not with a client that is not linked');
insert into public.wsp_shares (assessment_id, client_id, consented_by, consented_at)
values (pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e0006', now() - interval '1 year');
select pg_temp.check((public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) -> 'clients' -> 0 ->> 'status') = 'shared', 'shared');
reset role;
select pg_temp.check((select consented_at > now() - interval '1 minute' and consent_text_version = 'nordavo-wsp-consent-v1' from public.wsp_shares),
  'consent time and text version set by the database');
select pg_temp.check((select actor = '00000000-0000-0000-0000-0000000e0006' and actor_role = 'person' from public.wsp_audit_log where action = 'shared'), 'share logged');

-- Staff cannot withdraw either.
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
update public.wsp_shares set revoked_by = '00000000-0000-0000-0000-0000000e0002';
reset role;
select pg_temp.check((select revoked_at is null from public.wsp_shares), 'staff cannot change a share');

-- The client sees the report, without answers or flags, and every view is logged.
select pg_temp.act('boss.wsp@kg.nl');
set role authenticated;
select pg_temp.check((public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) ->> 'audience') = 'client', 'client with share: the report');
select pg_temp.check((public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) -> 'share' ->> 'client_name') = 'KG', 'with the share for the watermark');
select pg_temp.check(not (public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) ?| array['answers', 'flags', 'clients']), 'no answers or flags in the report');
select pg_temp.check((select count(*) from public.wsp_results) = 5, 'results with an active share');
select pg_temp.check((select count(*) from public.wsp_answers) = 0, 'never raw answers');
select pg_temp.check((select count(*) from public.wsp_flags) = 0, 'never flags');
select pg_temp.check((select count(*) from public.wsp_shares) = 0, 'no share rows');
select pg_temp.check((select count(*) from public.wsp_client_reports()) = 1, 'listed for the client');
select public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), null, true);
reset role;
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'viewed' and actor = '00000000-0000-0000-0000-0000000e0004' and actor_role = 'client') >= 1,
  'client views logged');
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'exported' and actor = '00000000-0000-0000-0000-0000000e0004'
  and details ->> 'role' = 'client') = 1, 'client download logged with role');

select pg_temp.act('boss.wsp@acme.nl');
set role authenticated;
select pg_temp.check(public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) is null, 'another client: nothing');
reset role;
select pg_temp.act('lid.wsp@kg.nl');
set role authenticated;
select pg_temp.check(public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) is null, 'client member without the portal: nothing');
select pg_temp.check((select count(*) from public.wsp_results) = 0, 'client member: no results');
reset role;

-- Downloads by the person and staff are logged too.
select pg_temp.anon();
set role anon;
select public.wsp_report(null, pg_temp.token('00000000-0000-0000-0000-0000000e3001'), true);
reset role;
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), null, true);
reset role;
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'exported' and details ->> 'role' = 'person_link' and actor is null) = 1, 'download by link logged');
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'exported' and details ->> 'role' = 'staff' and actor = '00000000-0000-0000-0000-0000000e0002') = 1, 'staff download logged');

-- Withdrawing: the client loses access at once, the mail goes out.
select pg_temp.act('ravi.wsp@example.in');
set role authenticated;
update public.wsp_shares set revoked_by = '00000000-0000-0000-0000-0000000e0006';
select pg_temp.check((public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) -> 'clients' -> 0 ->> 'status') = 'withdrawn', 'withdrawn');
reset role;
select pg_temp.check((select revoked_at is not null from public.wsp_shares), 'revoked_at set');
select pg_temp.act('boss.wsp@kg.nl');
set role authenticated;
select pg_temp.check(public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001')) is null, 'after withdrawing: no report');
select pg_temp.check(public.wsp_report(pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), null, true) is null, 'after withdrawing: no PDF');
select pg_temp.check((select count(*) from public.wsp_results) = 0, 'after withdrawing: no results');
reset role;
select pg_temp.check((select payload ->> 'full_name' = 'Ravi Kumar' and client_id = '00000000-0000-0000-0000-0000000e1001'
  from public.wsp_outbox where kind = 'withdrawn'), 'withdrawal mail to the client queued');
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'revoked' and actor = '00000000-0000-0000-0000-0000000e0006') = 1, 'withdrawal logged');

-- ---------------------------------------------------------------------------
-- 9. Ask for permission: staff, at most once per client per 7 days.
-- ---------------------------------------------------------------------------
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check(public.wsp_request_permission(pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001') = 'requested', 'asked');
select pg_temp.check(pg_temp.fails(format($$select public.wsp_request_permission(%L, %L)$$, pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001')),
  'not again within 7 days');
select pg_temp.check(pg_temp.fails(format($$select public.wsp_request_permission(%L, %L)$$, pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1002')),
  'only for a linked client');
reset role;
select pg_temp.check((select count(*) from public.wsp_outbox where kind = 'permission_request') = 1, 'permission mail queued');
select pg_temp.check((select count(*) from public.academy_notifications where profile_id = '00000000-0000-0000-0000-0000000e0006' and kind = 'wsp_permission_request'
  and link = '/academy/working-style') = 1, 'in-portal notification with a link to the sharing page');
select pg_temp.check((select count(*) from public.wsp_shares where revoked_at is null) = 0, 'asking shares nothing');
update public.wsp_permission_requests set requested_at = now() - interval '8 days';
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check(public.wsp_request_permission(pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1001') = 'requested', 'again after 7 days');
reset role;

-- ---------------------------------------------------------------------------
-- 10. No second invitation within 12 months: the kept profile is linked.
-- ---------------------------------------------------------------------------
insert into public.applications (id, vacancy_id, candidate_id, stage, shortlisted_at) values
  ('00000000-0000-0000-0000-0000000e4005', '00000000-0000-0000-0000-0000000e2003', '00000000-0000-0000-0000-0000000e3001', 'interview', now());
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3001') = 1, 'no duplicate invitation within 12 months');
select pg_temp.check((select count(*) from public.wsp_assessment_links where assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3001')
  and vacancy_id = '00000000-0000-0000-0000-0000000e2003' and client_id = '00000000-0000-0000-0000-0000000e1002') = 1, 'linked to the new vacancy');
select pg_temp.check((select count(*) from public.wsp_shares where client_id = '00000000-0000-0000-0000-0000000e1002') = 0, 'a new client needs its own consent');
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'linked' and actor_role = 'system'
  and details ->> 'vacancy_id' = '00000000-0000-0000-0000-0000000e2003') = 1, 'link logged');

-- Older than 12 months: invited again.
update public.wsp_assessments set completed_at = now() - interval '13 months' where id = pg_temp.aid('00000000-0000-0000-0000-0000000e3005');
insert into public.applications (id, vacancy_id, candidate_id, stage, shortlisted_at) values
  ('00000000-0000-0000-0000-0000000e4006', '00000000-0000-0000-0000-0000000e2001', '00000000-0000-0000-0000-0000000e3005', 'interview', now());
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3005') = 2, 'older than 12 months: a new invitation');

-- Staff may start a new one within 12 months by hand; the old results stay with their date.
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select public.wsp_send('00000000-0000-0000-0000-0000000e3006');
select pg_temp.check((select count(*) from public.wsp_assessments where person_id = '00000000-0000-0000-0000-0000000e3006' and status = 'completed') = 1, 'old results stay visible');
reset role;
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3006') = 2, 'staff can send a new one by hand');

-- ---------------------------------------------------------------------------
-- 11. Expired links, resend, reminder after 3 days.
-- ---------------------------------------------------------------------------
update public.wsp_assessments set expires_at = now() - interval '1 minute' where person_id = '00000000-0000-0000-0000-0000000e3002';
select pg_temp.check((public.wsp_questionnaire(pg_temp.token('00000000-0000-0000-0000-0000000e3002')) ->> 'status') = 'expired', 'link expired after 14 days');
select pg_temp.check(pg_temp.fails(format($$select public.wsp_accept_intro(%L)$$, pg_temp.token('00000000-0000-0000-0000-0000000e3002'))), 'an expired link does not start');
create temp table old_token as select pg_temp.token('00000000-0000-0000-0000-0000000e3002') as token;
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select public.wsp_resend(pg_temp.aid('00000000-0000-0000-0000-0000000e3002'));
reset role;
select pg_temp.check((public.wsp_questionnaire(pg_temp.token('00000000-0000-0000-0000-0000000e3002')) ->> 'status') = 'invited', 'resent: open again');
select pg_temp.check(public.wsp_questionnaire((select token from old_token)) is null, 'the old link no longer works');
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'resent' and actor = '00000000-0000-0000-0000-0000000e0002') = 1, 'resend logged');

update public.wsp_assessments set invited_at = now() - interval '4 days' where person_id = '00000000-0000-0000-0000-0000000e3002';
select pg_temp.check((public.wsp_run_daily() ->> 'reminded')::integer = 1, 'one reminder after 3 days not started');
select pg_temp.check((public.wsp_run_daily() ->> 'reminded')::integer = 0, 'only one reminder');
select pg_temp.check((select count(*) from public.wsp_outbox where kind = 'reminder') = 1 and
  (select count(*) from public.wsp_audit_log where action = 'reminded' and actor_role = 'system') = 1, 'reminder mail queued and logged');
select pg_temp.act('rec.wsp@nordavo.nl');
set role authenticated;
select pg_temp.check(pg_temp.fails($$select public.wsp_run_daily()$$), 'the daily job is for the service role');
reset role;

-- ---------------------------------------------------------------------------
-- 12. Developers and placements.
-- ---------------------------------------------------------------------------
-- Setting off (default): no invitation on placement start.
insert into public.placements (id, client_id, candidate_id, vacancy_id, start_date) values
  ('00000000-0000-0000-0000-0000000e5001', '00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e3008', null, current_date);
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3008') = 0, 'developers: no automatic invitation while the setting is off');
select pg_temp.act('admin.wsp@nordavo.nl');
set role authenticated;
select public.wsp_update_settings('{"auto_invite_developers_on_placement": true}');
reset role;
insert into public.placements (id, client_id, candidate_id, vacancy_id, start_date) values
  ('00000000-0000-0000-0000-0000000e5002', '00000000-0000-0000-0000-0000000e1002', '00000000-0000-0000-0000-0000000e3009', null, current_date);
select pg_temp.check((select person_type = 'developer' and invite_reason = 'placement_start' and invited_by is null
  from public.wsp_assessments where person_id = '00000000-0000-0000-0000-0000000e3009'), 'developers: invited on placement start when the setting is on');
select pg_temp.check((public.wsp_questionnaire(pg_temp.token('00000000-0000-0000-0000-0000000e3009')) ->> 'person_type') = 'developer',
  'the questionnaire knows it is a developer (the extra intro sentence)');
select pg_temp.check((select details ->> 'reason' = 'placement_start' and details ? 'placement_id' from public.wsp_audit_log where action = 'invited'
  and assessment_id = pg_temp.aid('00000000-0000-0000-0000-0000000e3009')), 'audit: why (placement)');
-- Placed with a report: the permission request goes out by itself; nothing is shared.
insert into public.placements (id, client_id, candidate_id, vacancy_id, start_date) values
  ('00000000-0000-0000-0000-0000000e5003', '00000000-0000-0000-0000-0000000e1002', '00000000-0000-0000-0000-0000000e3006', null, current_date);
select pg_temp.check((select count(*) from public.wsp_permission_requests where requested_by is null and client_id = '00000000-0000-0000-0000-0000000e1002') = 1,
  'placed with a report: automatic permission request');
select pg_temp.check((select count(*) from public.wsp_shares where client_id = '00000000-0000-0000-0000-0000000e1002') = 0, 'and nothing shared');
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'permission_requested' and actor_role = 'system') = 1, 'system request logged');

-- ---------------------------------------------------------------------------
-- 13. Delete my profile: everything except one audit row without content.
-- ---------------------------------------------------------------------------
select pg_temp.act('ravi.wsp@example.in');
set role authenticated;
insert into public.wsp_shares (assessment_id, client_id, consented_by)
values (pg_temp.aid('00000000-0000-0000-0000-0000000e3001'), '00000000-0000-0000-0000-0000000e1002', '00000000-0000-0000-0000-0000000e0006');
reset role;
create temp table gone as select pg_temp.aid('00000000-0000-0000-0000-0000000e3001') as id, pg_temp.token('00000000-0000-0000-0000-0000000e3001') as token;
grant select on gone to authenticated, anon;
select pg_temp.act('ravi.wsp@example.in');
set role authenticated;
select public.wsp_delete_my_profile(null, (select id from gone));
reset role;
select pg_temp.check((select status = 'deleted' and person_id is null and invite_token is null and completed_at is null from public.wsp_assessments where id = (select id from gone)),
  'assessment emptied');
select pg_temp.check((select count(*) from public.wsp_answers where assessment_id = (select id from gone)) = 0
  and (select count(*) from public.wsp_results where assessment_id = (select id from gone)) = 0
  and (select count(*) from public.wsp_flags where assessment_id = (select id from gone)) = 0
  and (select count(*) from public.wsp_assessment_links where assessment_id = (select id from gone)) = 0
  and (select count(*) from public.wsp_shares where assessment_id = (select id from gone)) = 0
  and (select count(*) from public.wsp_permission_requests where assessment_id = (select id from gone)) = 0, 'answers, results, flags, links, shares deleted');
select pg_temp.check((select count(*) = 1 and bool_and(action = 'deleted' and details = '{"by": "person"}') from public.wsp_audit_log where assessment_id = (select id from gone)),
  'one audit row without content');
select pg_temp.check((select count(*) from public.wsp_outbox where kind = 'withdrawn' and client_id = '00000000-0000-0000-0000-0000000e1002') = 1,
  'active share withdrawn with the mail to the client');
select pg_temp.check(public.wsp_questionnaire((select token from gone)) is null and public.wsp_report(null, (select token from gone)) is null, 'the personal link is dead');

-- ---------------------------------------------------------------------------
-- 14. Retention by the daily job.
-- ---------------------------------------------------------------------------
-- Rejected 30 days ago, no talent pool consent: deleted 28 days after.
update public.applications set stage = 'rejected' where id = '00000000-0000-0000-0000-0000000e4002';
update public.applications set rejected_at = now() - interval '30 days' where id = '00000000-0000-0000-0000-0000000e4002';
update public.wsp_assessments set invited_at = now() - interval '40 days' where person_id = '00000000-0000-0000-0000-0000000e3004';
-- Talent pool consent: kept 365 days after the questionnaire.
update public.candidates set talent_pool_consent_at = now() where id = '00000000-0000-0000-0000-0000000e3007';
-- A running placement: kept.
select pg_temp.check((public.wsp_run_daily() ->> 'deleted')::integer >= 1, 'the daily job deletes what is due');
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3004') = 0, 'Always Person (rejected 30 days ago) deleted');
select pg_temp.check((select count(*) from public.wsp_audit_log where action = 'deleted' and details = '{"by": "retention"}' and actor_role = 'system') >= 1, 'retention logged');
select pg_temp.check((select delete_after::date = (completed_at + interval '365 days')::date from public.wsp_assessments where person_id = '00000000-0000-0000-0000-0000000e3007'),
  'talent pool consent: 365 days after the questionnaire');
select pg_temp.check((select delete_after is null from public.wsp_assessments where person_id = '00000000-0000-0000-0000-0000000e3009'), 'running placement: kept');
update public.placements set status = 'ended', end_date = current_date - 30 where id = '00000000-0000-0000-0000-0000000e5002';
select public.wsp_run_daily();
select pg_temp.check(pg_temp.count_for('00000000-0000-0000-0000-0000000e3009') = 0, 'developer: deleted 28 days after the placement ended');
-- Only a kept profile can be reused: the deleted one is not linked to a new vacancy.
select pg_temp.check(wsp_private.reusable_assessment('00000000-0000-0000-0000-0000000e3001') is null, 'a deleted profile is never reused');

-- ---------------------------------------------------------------------------
-- 15. Scores nowhere else: no other function or view reads the wsp tables.
-- ---------------------------------------------------------------------------
select pg_temp.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname not like 'wsp\_%'
    and p.prosrc ~ 'wsp_(results|answers|flags|assessments|shares)'
), 'no function outside the feature reads profile data (lists, boards, search, talent pool)');
select pg_temp.check(not exists (
  select 1 from pg_views where schemaname = 'public' and definition ~ 'wsp_(results|answers|flags|assessments)'
), 'no view reads profile data');

rollback;
