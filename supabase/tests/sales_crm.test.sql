-- Sales CRM rules (supabase/migrations/*_sales_crm.sql), played out with real
-- RLS. Run against a database with every migration applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sales_crm.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005a1', 'julius@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000005a2', 'intern@nordavo.nl', '{"full_name": "Intern"}'),
  ('00000000-0000-0000-0000-0000000005a3', 'caller@webpartners.nl', '{"full_name": "Carla Caller"}'),
  ('00000000-0000-0000-0000-0000000005a4', 'other@webpartners.nl', '{"full_name": "Otto Caller"}'),
  ('00000000-0000-0000-0000-0000000005a5', 'recruiter@nordavo.nl', '{"full_name": "Recruiter"}');

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000005a1';
update public.profiles set role = 'member', modules = array['sales'] where id = '00000000-0000-0000-0000-0000000005a2';
update public.profiles set role = 'caller' where id in ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000005a4');
update public.profiles set role = 'member', modules = array['recruitment'] where id = '00000000-0000-0000-0000-0000000005a5';

insert into public.callers (id, profile_id, name, email, fee_per_meeting) values
  ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-0000000005a3', 'Carla', 'caller@webpartners.nl', 75),
  ('00000000-0000-0000-0000-0000000005c2', '00000000-0000-0000-0000-0000000005a4', 'Otto', 'other@webpartners.nl', 50);

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
create function pg_temp.service(p_dummy int default 0) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
$$;

-- One company with three contacts.
insert into public.companies (id, name, domain, icp_decision, lead_status) values
  ('00000000-0000-0000-0000-0000000005d1', 'Impaqt Software', 'impaqt.nl', 'GO', 'ready'),
  ('00000000-0000-0000-0000-0000000005d2', 'No Site BV', 'nodomain:no site bv', null, 'new');
insert into public.contacts (id, company_id, first_name, last_name, phone, phone_type, tier) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005d1', 'Anna', 'Main', '+31600000001', 'mobiel', 1),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-0000000005d1', 'Bert', 'Extra', null, null, 2),
  ('00000000-0000-0000-0000-0000000005e3', '00000000-0000-0000-0000-0000000005d1', 'Cees', 'Reserve', '+31600000003', 'mobiel', 3);

grant execute on function pg_temp.act(uuid), pg_temp.service(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Every edit is a change row in activities, with actor and source
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000005a2');
select public.sales_update('company', array['00000000-0000-0000-0000-0000000005d1'::uuid],
  '{"prio": 1, "category": "development"}');
do $$ begin
  if (select count(*) from public.activities where type = 'change' and company_id = '00000000-0000-0000-0000-0000000005d1'
      and created_by = '00000000-0000-0000-0000-0000000005a2' and field in ('prio', 'category')) <> 2 then
    raise exception 'FAIL: each changed field should be logged with its actor';
  end if;
  if (select new_value from public.activities where field = 'prio' limit 1) <> '1'::jsonb then
    raise exception 'FAIL: the new value should be logged';
  end if;
end $$;

-- Columns outside the whitelist are refused.
do $$ begin
  perform public.sales_update('company', array['00000000-0000-0000-0000-0000000005d1'::uuid], '{"domain": "evil.nl"}');
  raise exception 'FAIL: domain should not be editable through sales_update';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- Lost needs a reason.
do $$ begin
  perform public.sales_update('company', array['00000000-0000-0000-0000-0000000005d1'::uuid], '{"pipeline_stage": "lost"}');
  raise exception 'FAIL: lost without a reason should fail';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- A recruiter without the sales module cannot touch sales data.
select pg_temp.act('00000000-0000-0000-0000-0000000005a5');
do $$ begin
  if exists (select 1 from public.companies) then
    raise exception 'FAIL: recruitment only member can read companies';
  end if;
  perform public.sales_update('company', array['00000000-0000-0000-0000-0000000005d1'::uuid], '{"prio": 2}');
  raise exception 'FAIL: recruitment only member could edit a company';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Callers: no direct table access, only the call screen functions
-- ---------------------------------------------------------------------------

select pg_temp.act('00000000-0000-0000-0000-0000000005a3');
do $$ begin
  if exists (select 1 from public.companies) or exists (select 1 from public.contacts)
     or exists (select 1 from public.activities) or exists (select 1 from public.callers)
     or exists (select 1 from public.meetings) or exists (select 1 from public.sales_views) then
    raise exception 'FAIL: a caller can read sales tables directly';
  end if;
  if public.current_caller_id() is distinct from '00000000-0000-0000-0000-0000000005c1' then
    raise exception 'FAIL: current_caller_id should be the caller row';
  end if;
  perform public.sales_update('contact', array['00000000-0000-0000-0000-0000000005e1'::uuid], '{"phone": "x"}');
  raise exception 'FAIL: a caller could use sales_update';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- The app serves callers with the secret key and p_actor.
reset role;
set local role service_role;
select pg_temp.service();

-- A caller cannot log a call without holding the contact.
do $$ begin
  perform public.sales_log_call('00000000-0000-0000-0000-0000000005e1', 'no_answer', p_actor => '00000000-0000-0000-0000-0000000005a3');
  raise exception 'FAIL: a call without claiming the contact should fail';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- Carla opens Anna; Otto does not get her while she is open.
do $$ begin
  if not public.sales_claim_contact('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005a3') then
    raise exception 'FAIL: Carla should be able to open Anna';
  end if;
  if public.sales_claim_contact('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005a4') then
    raise exception 'FAIL: Otto should not get a contact that is open at Carla';
  end if;
end $$;

-- Three times no answer: Not reached, the other contacts go to Enrich.
select public.sales_log_call('00000000-0000-0000-0000-0000000005e1', 'no_answer', p_actor => '00000000-0000-0000-0000-0000000005a3');
select public.sales_claim_contact('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005a3');
select public.sales_log_call('00000000-0000-0000-0000-0000000005e1', 'no_answer', p_actor => '00000000-0000-0000-0000-0000000005a3');
select public.sales_claim_contact('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005a3');
select public.sales_log_call('00000000-0000-0000-0000-0000000005e1', 'no_answer', p_actor => '00000000-0000-0000-0000-0000000005a3');
do $$ begin
  if (select attempts from public.contacts where id = '00000000-0000-0000-0000-0000000005e1') <> 3 then
    raise exception 'FAIL: attempts should be 3';
  end if;
  if (select status from public.contacts where id = '00000000-0000-0000-0000-0000000005e1') <> 'not_reached' then
    raise exception 'FAIL: after 3 attempts the contact should be not_reached';
  end if;
  if (select array_agg(status order by first_name) from public.contacts
      where id in ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-0000000005e3')) <> array['enrich', 'enrich'] then
    raise exception 'FAIL: the other contacts should go to Enrich';
  end if;
  if (select count(*) from public.activities where caller_id = '00000000-0000-0000-0000-0000000005c1' and outcome = 'no_answer') <> 3 then
    raise exception 'FAIL: every outcome of a caller should be in activities with the caller';
  end if;
  if (select count(*) from public.activities where caller_id = '00000000-0000-0000-0000-0000000005c1' and type = 'view') <> 3 then
    raise exception 'FAIL: opening a contact should be logged for callers';
  end if;
  if (select claimed_by from public.contacts where id = '00000000-0000-0000-0000-0000000005e1') is not null then
    raise exception 'FAIL: logging an outcome releases the contact';
  end if;
end $$;

-- Cees: wrong number goes to Enrich; then referred makes a new contact.
select public.sales_claim_contact('00000000-0000-0000-0000-0000000005e3', '00000000-0000-0000-0000-0000000005a2');
select public.sales_log_call('00000000-0000-0000-0000-0000000005e3', 'referred', p_referred_name => 'Dirk de Vries',
  p_referred_title => 'CTO', p_referred_phone => '+31600000004', p_actor => '00000000-0000-0000-0000-0000000005a2');
do $$ begin
  if not exists (select 1 from public.contacts where company_id = '00000000-0000-0000-0000-0000000005d1'
                 and first_name = 'Dirk' and last_name = 'de Vries' and title = 'CTO') then
    raise exception 'FAIL: referred should create a contact at the same company';
  end if;
  if (select referred_to from public.contacts where id = '00000000-0000-0000-0000-0000000005e3') <> 'Dirk de Vries, CTO' then
    raise exception 'FAIL: referred to should be filled in';
  end if;
end $$;

select public.sales_log_call('00000000-0000-0000-0000-0000000005e2', 'wrong_number', p_actor => '00000000-0000-0000-0000-0000000005a2');
do $$ begin
  if (select status from public.contacts where id = '00000000-0000-0000-0000-0000000005e2') <> 'enrich' then
    raise exception 'FAIL: wrong number should set Enrich';
  end if;
end $$;

-- Call back needs a date.
do $$ begin
  perform public.sales_log_call('00000000-0000-0000-0000-0000000005e2', 'call_back', p_actor => '00000000-0000-0000-0000-0000000005a2');
  raise exception 'FAIL: call back without a date should fail';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Interest moves the company into the pipeline; meetings and fees
-- ---------------------------------------------------------------------------

select public.sales_claim_contact('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005a3');
select public.sales_log_call('00000000-0000-0000-0000-0000000005e1', 'meeting_planned', p_note => 'Wants two Python devs',
  p_actor => '00000000-0000-0000-0000-0000000005a3');
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000005d1') <> 'meeting_planned' then
    raise exception 'FAIL: meeting planned should move the company to Meeting planned';
  end if;
  if (select count(*) from public.meetings where company_id = '00000000-0000-0000-0000-0000000005d1'
      and caller_id = '00000000-0000-0000-0000-0000000005c1' and fee = 75 and status = 'planned') <> 1 then
    raise exception 'FAIL: a planned meeting with the caller fee should exist';
  end if;
end $$;

-- The Cal.com booking fills in the same meeting; fetching it twice is a no-op.
select public.sales_save_meeting('00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-0000000005e1', null,
  now() + interval '2 days', null, 'cal-uid-1', 'claude', '00000000-0000-0000-0000-0000000005a1');
select public.sales_save_meeting('00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-0000000005e1', null,
  now() + interval '2 days', null, 'cal-uid-1', 'claude', '00000000-0000-0000-0000-0000000005a1');
do $$ begin
  if (select count(*) from public.meetings where company_id = '00000000-0000-0000-0000-0000000005d1') <> 1 then
    raise exception 'FAIL: a booking should not create a second meeting';
  end if;
  if (select external_id from public.meetings where company_id = '00000000-0000-0000-0000-0000000005d1') <> 'cal-uid-1' then
    raise exception 'FAIL: the booking uid should be on the planned meeting';
  end if;
end $$;

-- Approving gives the caller the fee and moves the pipeline to Meeting held.
update public.meetings set status = 'approved' where external_id = 'cal-uid-1';
do $$ begin
  if (select decided_at from public.meetings where external_id = 'cal-uid-1') is null then
    raise exception 'FAIL: approving should record when';
  end if;
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000005d1') <> 'meeting_held' then
    raise exception 'FAIL: an approved meeting means the meeting was held';
  end if;
end $$;

-- Activities with an external id are stored once.
do $$ declare v1 uuid; v2 uuid; begin
  v1 := public.sales_log_activity('00000000-0000-0000-0000-0000000005d2', null, 'mail', 'reply', 'reply_neutraal',
    'Maybe later', 'inbound', null, 'instantly', 'inst-1', null, true, '{"proposal": "cooled_down"}', '00000000-0000-0000-0000-0000000005a1');
  v2 := public.sales_log_activity('00000000-0000-0000-0000-0000000005d2', null, 'mail', 'reply', 'reply_neutraal',
    'Maybe later', 'inbound', null, 'instantly', 'inst-1', null, true, null, '00000000-0000-0000-0000-0000000005a1');
  if v1 is null or v2 is not null then
    raise exception 'FAIL: the same external id should be stored once';
  end if;
  -- Julius accepts the proposal: positive after all.
  perform public.sales_decide_reply(v1, true, '{"outcome": "reply_positief"}', '00000000-0000-0000-0000-0000000005a1');
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000005d2') <> 'interested' then
    raise exception 'FAIL: an accepted positive reply should move the company to Interested';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sequences: approval first; a reply pauses and removes open call steps
-- ---------------------------------------------------------------------------

insert into public.sequences (id, name, status) values ('00000000-0000-0000-0000-0000000005f1', 'Python vacancy', 'active');
insert into public.sequence_steps (sequence_id, position, day_offset, channel, draft_body, draft_source) values
  ('00000000-0000-0000-0000-0000000005f1', 1, 0, 'mail', 'Hi {first_name}', 'claude'),
  ('00000000-0000-0000-0000-0000000005f1', 2, 3, 'call', null, null);

do $$ begin
  perform public.sales_start_sequence('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-0000000005d2',
    p_actor => '00000000-0000-0000-0000-0000000005a1');
  raise exception 'FAIL: a sequence with an unapproved mail text should not start';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

update public.sequence_steps set body = draft_body, approved_at = now() where channel = 'mail';
select public.sales_start_sequence('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-0000000005d2',
  p_actor => '00000000-0000-0000-0000-0000000005a1');
do $$ begin
  if (select count(*) from public.sequence_tasks where company_id = '00000000-0000-0000-0000-0000000005d2') <> 2 then
    raise exception 'FAIL: every step should become a task';
  end if;
  if (select due_date from public.sequence_tasks where channel = 'call') <> current_date + 3 then
    raise exception 'FAIL: the call step should be due on its day';
  end if;
end $$;

select public.sales_log_activity('00000000-0000-0000-0000-0000000005d2', null, 'linkedin', 'reply', 'reply_negatief',
  'No thanks', 'inbound', null, 'seleqt', 'seleqt-1', null, false, null, '00000000-0000-0000-0000-0000000005a1');
do $$ begin
  if (select status from public.sequence_enrollments where company_id = '00000000-0000-0000-0000-0000000005d2') <> 'paused' then
    raise exception 'FAIL: a reply should pause the sequence';
  end if;
  if (select status from public.sequence_tasks where channel = 'call' and company_id = '00000000-0000-0000-0000-0000000005d2') <> 'cancelled' then
    raise exception 'FAIL: a reply should remove the open call steps';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Stages 5, 7, 8 and 9 come from recruitment
-- ---------------------------------------------------------------------------

reset role;
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000005b1', 'Impaqt Software');
update public.companies set client_id = '00000000-0000-0000-0000-0000000005b1' where id = '00000000-0000-0000-0000-0000000005d1';
insert into public.vacancies (id, client_id, title) values ('00000000-0000-0000-0000-0000000005b2', '00000000-0000-0000-0000-0000000005b1', 'Python developer');
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000005d1') <> 'vacancy_drafted' then
    raise exception 'FAIL: a vacancy should mean Vacancy drafted';
  end if;
end $$;
insert into public.candidates (id, full_name) values ('00000000-0000-0000-0000-0000000005b3', 'Priya');
insert into public.applications (id, vacancy_id, candidate_id, stage)
values ('00000000-0000-0000-0000-0000000005b4', '00000000-0000-0000-0000-0000000005b2', '00000000-0000-0000-0000-0000000005b3', 'matched');
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000005d1') <> 'profiles_sent' then
    raise exception 'FAIL: presented candidates should mean Profiles sent';
  end if;
end $$;
update public.applications set stage = 'client_interview' where id = '00000000-0000-0000-0000-0000000005b4';
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000005d1') <> 'candidate_interviews' then
    raise exception 'FAIL: a client interview should mean Candidate interviews';
  end if;
end $$;
insert into public.placements (candidate_id, client_id, vacancy_id, start_date)
values ('00000000-0000-0000-0000-0000000005b3', '00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005b2', current_date);
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000005d1') <> 'won' then
    raise exception 'FAIL: a placement should mean Won';
  end if;
  if (select status from public.companies where id = '00000000-0000-0000-0000-0000000005d1') <> 'klant' then
    raise exception 'FAIL: Won should make the company a client';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A paused caller loses access straight away
-- ---------------------------------------------------------------------------

update public.callers set status = 'paused' where id = '00000000-0000-0000-0000-0000000005c1';
set local role service_role;
select pg_temp.service();
do $$ begin
  perform public.sales_claim_contact('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-0000000005a3');
  raise exception 'FAIL: a paused caller should not be able to open contacts';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

reset role;
rollback;

\echo 'sales crm tests passed'
