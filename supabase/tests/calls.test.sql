-- Calls, callers and meetings (supabase/migrations/20261110030000_calls_callers_meetings.sql).
-- Run against a database with every migration applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/calls.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000006a1', 'julius@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000006a2', 'intern@nordavo.nl', '{"full_name": "Intern"}'),
  ('00000000-0000-0000-0000-0000000006a3', 'caller@webpartners.nl', '{"full_name": "Carla Caller"}');

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000006a1';
update public.profiles set role = 'member', modules = array['sales'] where id = '00000000-0000-0000-0000-0000000006a2';
update public.profiles set role = 'caller' where id = '00000000-0000-0000-0000-0000000006a3';

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
create function pg_temp.service(p_dummy int default 0) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
$$;
grant execute on function pg_temp.act(uuid), pg_temp.service(int) to authenticated;

-- ---------------------------------------------------------------------------
-- The portal role is in the session token
-- ---------------------------------------------------------------------------

do $$ begin
  if (select raw_app_meta_data ->> 'portal_role' from auth.users where id = '00000000-0000-0000-0000-0000000006a3') <> 'caller' then
    raise exception 'FAIL: a caller should carry portal_role caller in app_metadata';
  end if;
  if (select raw_app_meta_data ->> 'portal_role' from auth.users where id = '00000000-0000-0000-0000-0000000006a2') <> 'member' then
    raise exception 'FAIL: a member should carry portal_role member';
  end if;
end $$;

insert into public.callers (id, profile_id, name, email, fee_per_meeting) values
  ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006a3', 'Carla', 'caller@webpartners.nl', 80);

insert into public.companies (id, name, domain, icp_decision, lead_status) values
  ('00000000-0000-0000-0000-0000000006d1', 'Callable BV', 'callable.nl', 'GO', 'ready');
insert into public.contacts (id, company_id, first_name, last_name, phone, phone_type, assigned_caller_id) values
  ('00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-0000000006d1', 'Anna', 'Assigned', '+31600000001', 'mobiel',
   '00000000-0000-0000-0000-0000000006c1');
insert into public.sales_views (id, entity, name, is_call_list) values
  ('00000000-0000-0000-0000-0000000006f1', 'contacts', 'Python leads', true);
insert into public.call_list_callers (view_id, caller_id, position) values
  ('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006c1', 0);

-- ---------------------------------------------------------------------------
-- Meetings: only admins approve, reject and change the fee
-- ---------------------------------------------------------------------------

insert into public.meetings (id, company_id, contact_id, caller_id) values
  ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006d1',
   '00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-0000000006c1');

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if (select fee from public.meetings where id = '00000000-0000-0000-0000-0000000006b1') <> 80 then
    raise exception 'FAIL: the fee should default to the caller fee';
  end if;
  update public.meetings set status = 'held' where id = '00000000-0000-0000-0000-0000000006b1';
  if (select status from public.meetings where id = '00000000-0000-0000-0000-0000000006b1') <> 'held' then
    raise exception 'FAIL: an internal user may mark a meeting held';
  end if;
end $$;
do $$ begin
  update public.meetings set status = 'approved' where id = '00000000-0000-0000-0000-0000000006b1';
  raise exception 'FAIL: an internal user should not approve a meeting';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;
do $$ begin
  update public.meetings set fee = 500 where id = '00000000-0000-0000-0000-0000000006b1';
  raise exception 'FAIL: an internal user should not change the fee';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

select pg_temp.act('00000000-0000-0000-0000-0000000006a1');
update public.meetings set fee = 90 where id = '00000000-0000-0000-0000-0000000006b1';
update public.meetings set status = 'approved' where id = '00000000-0000-0000-0000-0000000006b1';
do $$ begin
  if (select fee from public.meetings where id = '00000000-0000-0000-0000-0000000006b1') <> 90 then
    raise exception 'FAIL: an admin may change the fee';
  end if;
  if (select decided_by from public.meetings where id = '00000000-0000-0000-0000-0000000006b1')
     is distinct from '00000000-0000-0000-0000-0000000006a1' then
    raise exception 'FAIL: approving should record who decided';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Pausing and stopping a caller
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;
select pg_temp.service();
select public.sales_claim_contact('00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-0000000006a3');

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000006a1');
update public.callers set status = 'paused' where id = '00000000-0000-0000-0000-0000000006c1';
do $$ begin
  if (select paused_at from public.callers where id = '00000000-0000-0000-0000-0000000006c1') is null then
    raise exception 'FAIL: pausing should record when';
  end if;
  if (select claimed_by from public.contacts where id = '00000000-0000-0000-0000-0000000006e1') is not null then
    raise exception 'FAIL: pausing should release what the caller had open';
  end if;
  if (select assigned_caller_id from public.contacts where id = '00000000-0000-0000-0000-0000000006e1') is null then
    raise exception 'FAIL: a paused caller keeps their contacts';
  end if;
end $$;

update public.callers set status = 'active' where id = '00000000-0000-0000-0000-0000000006c1';
do $$ begin
  if (select paused_at from public.callers where id = '00000000-0000-0000-0000-0000000006c1') is not null then
    raise exception 'FAIL: resuming should clear the pause';
  end if;
end $$;

update public.callers set status = 'stopped' where id = '00000000-0000-0000-0000-0000000006c1';
do $$ begin
  if (select assigned_caller_id from public.contacts where id = '00000000-0000-0000-0000-0000000006e1') is not null then
    raise exception 'FAIL: a stopped caller gives back their contacts';
  end if;
  if exists (select 1 from public.call_list_callers where caller_id = '00000000-0000-0000-0000-0000000006c1') then
    raise exception 'FAIL: a stopped caller loses their call lists';
  end if;
  if not exists (select 1 from public.activities where contact_id = '00000000-0000-0000-0000-0000000006e1'
                 and type = 'change' and field = 'assigned_caller_id' and created_by = '00000000-0000-0000-0000-0000000006a1') then
    raise exception 'FAIL: giving back contacts should be in the change log';
  end if;
end $$;

-- A member cannot manage callers or open lists for them.
select pg_temp.act('00000000-0000-0000-0000-0000000006a2');
do $$ declare v_count int; begin
  update public.callers set status = 'active' where id = '00000000-0000-0000-0000-0000000006c1';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL: an internal user should not manage callers';
  end if;
  insert into public.call_list_callers (view_id, caller_id) values
    ('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006c1');
  raise exception 'FAIL: an internal user should not open lists for callers';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Call outcome flow (supabase/migrations/20261123600000_call_outcome_flow.sql):
-- reasons for a "no", lost and parked companies, undo
-- ---------------------------------------------------------------------------

reset role;
insert into public.companies (id, name, domain, icp_decision, lead_status) values
  ('00000000-0000-0000-0000-0000000007d2', 'Lost BV', 'lost.nl', 'GO', 'ready'),
  ('00000000-0000-0000-0000-0000000007d3', 'Parked BV', 'parked.nl', 'GO', 'ready'),
  ('00000000-0000-0000-0000-0000000007d4', 'Undo BV', 'undo.nl', 'GO', 'ready');
insert into public.contacts (id, company_id, first_name, last_name, phone, phone_type) values
  ('00000000-0000-0000-0000-0000000007e2', '00000000-0000-0000-0000-0000000007d2', 'Lars', 'Lost', '+31600000072', 'mobiel'),
  ('00000000-0000-0000-0000-0000000007e3', '00000000-0000-0000-0000-0000000007d2', 'Lena', 'Lost', '+31600000073', 'mobiel'),
  ('00000000-0000-0000-0000-0000000007e4', '00000000-0000-0000-0000-0000000007d3', 'Pim', 'Parked', '+31600000074', 'mobiel'),
  ('00000000-0000-0000-0000-0000000007e5', '00000000-0000-0000-0000-0000000007d4', 'Uma', 'Undo', '+31600000075', 'mobiel'),
  ('00000000-0000-0000-0000-0000000007e6', '00000000-0000-0000-0000-0000000007d4', 'Uri', 'Undo', '+31600000076', 'mobiel');
insert into public.campaigns (id, name, channel) values ('00000000-0000-0000-0000-0000000007f1', 'Mail wave', 'mail');
insert into public.campaign_members (campaign_id, company_id, status) values
  ('00000000-0000-0000-0000-0000000007f1', '00000000-0000-0000-0000-0000000007d2', 'active');

-- The list of rejection reasons: admins add reasons; built in ones are hidden, not deleted.
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000006a1');
insert into public.sales_choice_options (list_key, value, label) values ('reject_reason', 'no_budget', 'No budget');
insert into public.sales_choice_options (list_key, value, label) values ('reject_reason', 'has_agency', 'Has an agency');
do $$ begin
  if not (select builtin from public.sales_choice_options where list_key = 'reject_reason' and value = 'has_agency') then
    raise exception 'FAIL: has_agency is a built in reason';
  end if;
  if (select builtin from public.sales_choice_options where list_key = 'reject_reason' and value = 'no_budget') then
    raise exception 'FAIL: no_budget is an extra reason';
  end if;
end $$;
do $$ begin
  delete from public.sales_choice_options where list_key = 'reject_reason' and value = 'has_agency';
  raise exception 'FAIL: a built in reason should not be deleted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;
delete from public.sales_choice_options where list_key = 'reject_reason' and value = 'no_budget';
do $$ begin
  insert into public.sales_choice_options (list_key, value, label) values ('call_outcome', 'hang_up', 'Hang up');
  raise exception 'FAIL: the call outcomes keep their fixed options';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- A member cannot change the list but reads it.
select pg_temp.act('00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if (select count(*) from public.sales_choice_options where list_key = 'reject_reason') <> 1 then
    raise exception 'FAIL: a sales member should read the reasons list';
  end if;
  insert into public.sales_choice_options (list_key, value, label) values ('reject_reason', 'sneaky', 'Sneaky');
  raise exception 'FAIL: a member should not change the reasons list';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

reset role;
set local role service_role;
select pg_temp.service();

-- Not interested needs a reason or words, and the wrong moment needs a date in the future.
do $$ begin
  perform public.sales_log_call('00000000-0000-0000-0000-0000000007e2', 'reached_not_interested', p_actor => '00000000-0000-0000-0000-0000000006a2');
  raise exception 'FAIL: not interested without a reason should fail';
exception when others then
  if sqlerrm not like '%Pick a reason or write one%' then raise exception 'FAIL: unexpected error: %', sqlerrm; end if;
end $$;
do $$ begin
  perform public.sales_log_call('00000000-0000-0000-0000-0000000007e2', 'reached_not_interested',
    p_reasons => array['wrong_moment'], p_actor => '00000000-0000-0000-0000-0000000006a2');
  raise exception 'FAIL: wrong moment without a date should fail';
exception when others then
  if sqlerrm not like '%Pick a date to get back in touch%' then raise exception 'FAIL: unexpected error: %', sqlerrm; end if;
end $$;
do $$ begin
  perform public.sales_log_call('00000000-0000-0000-0000-0000000007e2', 'reached_not_interested',
    p_reasons => array['wrong_moment'], p_until => current_date - 1, p_actor => '00000000-0000-0000-0000-0000000006a2');
  raise exception 'FAIL: a date in the past should fail';
exception when others then
  if sqlerrm not like '%Pick a date in the future%' then raise exception 'FAIL: unexpected error: %', sqlerrm; end if;
end $$;
do $$ begin
  if (select attempts from public.contacts where id = '00000000-0000-0000-0000-0000000007e2') <> 0 then
    raise exception 'FAIL: a refused call should not count as an attempt';
  end if;
end $$;

-- Not interested: the company goes to lost with the reasons, out of campaigns; the contact is closed.
select public.sales_log_call('00000000-0000-0000-0000-0000000007e2', 'reached_not_interested',
  p_reasons => array['has_agency', 'too_small'], p_reason_text => 'Fixed partner',
  p_reason_label => 'Already has an agency or partner, Too small', p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if (select status from public.contacts where id = '00000000-0000-0000-0000-0000000007e2') <> 'not_interested' then
    raise exception 'FAIL: not interested should close the contact';
  end if;
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000007d2') is distinct from 'lost' then
    raise exception 'FAIL: not interested should put the company on lost';
  end if;
  if (select lost_reason from public.companies where id = '00000000-0000-0000-0000-0000000007d2')
     is distinct from 'Already has an agency or partner, Too small. Fixed partner' then
    raise exception 'FAIL: the lost reason should name the reasons and the own words, got %',
      (select lost_reason from public.companies where id = '00000000-0000-0000-0000-0000000007d2');
  end if;
  if (select bucket from public.companies where id = '00000000-0000-0000-0000-0000000007d2') <> 'no_go' then
    raise exception 'FAIL: a lost company should leave the lists (bucket no go)';
  end if;
  if (select status from public.campaign_members where company_id = '00000000-0000-0000-0000-0000000007d2') <> 'stopped' then
    raise exception 'FAIL: not interested should stop the campaign membership';
  end if;
  if (select status from public.contacts where id = '00000000-0000-0000-0000-0000000007e3') <> 'new' then
    raise exception 'FAIL: the other contacts of the company are left as they are';
  end if;
  if not exists (
    select 1 from public.call_rejections r
    where r.company_id = '00000000-0000-0000-0000-0000000007d2'
      and r.reasons = array['has_agency', 'too_small'] and r.reason_text = 'Fixed partner'
      and r.created_by = '00000000-0000-0000-0000-0000000006a2' and r.parked_until is null
      and r.activity_id is not null
  ) then
    raise exception 'FAIL: the rejection should be stored with its reasons and words';
  end if;
end $$;

-- Wrong moment with a date: parked until then, the contact waits for the date.
select public.sales_log_call('00000000-0000-0000-0000-0000000007e4', 'reached_not_interested',
  p_reasons => array['wrong_moment'], p_until => current_date + 30, p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000007d3') is distinct from 'parked'
     or (select parked_until from public.companies where id = '00000000-0000-0000-0000-0000000007d3') is distinct from current_date + 30 then
    raise exception 'FAIL: wrong moment should park the company until the date';
  end if;
  if (select bucket from public.companies where id = '00000000-0000-0000-0000-0000000007d3') <> 'parked'
     or (select bucket_until from public.companies where id = '00000000-0000-0000-0000-0000000007d3') is distinct from current_date + 30 then
    raise exception 'FAIL: a parked company should be in the parked bucket until the date';
  end if;
  if (select lost_reason from public.companies where id = '00000000-0000-0000-0000-0000000007d3') is not null then
    raise exception 'FAIL: a parked company is not lost';
  end if;
  if (select status from public.contacts where id = '00000000-0000-0000-0000-0000000007e4') <> 'in_outreach'
     or (select callback_at from public.contacts where id = '00000000-0000-0000-0000-0000000007e4') is distinct from current_date + 30 then
    raise exception 'FAIL: the contact should wait for the date, not be closed';
  end if;
end $$;

-- Undo: reached: interested with a next step and an owner, and everything goes back.
create temp table pg_temp.last_call (r jsonb);
grant all on pg_temp.last_call to service_role;
insert into pg_temp.last_call
select public.sales_log_call('00000000-0000-0000-0000-0000000007e5', 'reached_interested',
  p_next_step => 'Plan a meeting', p_next_step_at => current_date + 3, p_next_owner => '00000000-0000-0000-0000-0000000006a2',
  p_note => 'Two Python developers', p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000007d4') is distinct from 'interested'
     or (select lead_status from public.companies where id = '00000000-0000-0000-0000-0000000007d4') <> 'in_sequence' then
    raise exception 'FAIL: interested should move the company to the pipeline';
  end if;
  if (select next_action from public.companies where id = '00000000-0000-0000-0000-0000000007d4') is distinct from 'Plan a meeting'
     or (select owner_id from public.companies where id = '00000000-0000-0000-0000-0000000007d4') is distinct from '00000000-0000-0000-0000-0000000006a2' then
    raise exception 'FAIL: the next step and its owner should be on the company';
  end if;
  if (select r ->> 'activity_id' from pg_temp.last_call) is null then
    raise exception 'FAIL: the call should return the activity that undo takes';
  end if;
end $$;

-- Somebody else cannot undo it.
do $$ begin
  perform public.sales_undo_call((select (r ->> 'activity_id')::uuid from pg_temp.last_call), p_actor => '00000000-0000-0000-0000-0000000006a1');
  raise exception 'FAIL: only the person who logged the call can undo it';
exception when others then
  if sqlerrm not like '%Nothing to undo%' then raise exception 'FAIL: unexpected error: %', sqlerrm; end if;
end $$;

select public.sales_undo_call((select (r ->> 'activity_id')::uuid from pg_temp.last_call), p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if (select attempts from public.contacts where id = '00000000-0000-0000-0000-0000000007e5') <> 0
     or (select status from public.contacts where id = '00000000-0000-0000-0000-0000000007e5') <> 'new'
     or (select last_attempt_at from public.contacts where id = '00000000-0000-0000-0000-0000000007e5') is not null
     or (select caller_note from public.contacts where id = '00000000-0000-0000-0000-0000000007e5') is not null then
    raise exception 'FAIL: undo should put the contact back';
  end if;
  if (select claimed_by from public.contacts where id = '00000000-0000-0000-0000-0000000007e5') is distinct from '00000000-0000-0000-0000-0000000006a2' then
    raise exception 'FAIL: undo should hold the contact again for the person';
  end if;
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000007d4') is not null
     or (select lead_status from public.companies where id = '00000000-0000-0000-0000-0000000007d4') <> 'ready'
     or (select next_action from public.companies where id = '00000000-0000-0000-0000-0000000007d4') is not null
     or (select owner_id from public.companies where id = '00000000-0000-0000-0000-0000000007d4') is not null
     or (select bucket from public.companies where id = '00000000-0000-0000-0000-0000000007d4') <> 'incoming' then
    raise exception 'FAIL: undo should put the company back';
  end if;
  if exists (select 1 from public.activities where company_id = '00000000-0000-0000-0000-0000000007d4' and type in ('contact', 'change')) then
    raise exception 'FAIL: undo should remove the call and its log rows from Activities';
  end if;
  if exists (select 1 from public.call_undo where company_id = '00000000-0000-0000-0000-0000000007d4') then
    raise exception 'FAIL: an undone call can only be undone once';
  end if;
end $$;

-- Undo of a "no": the company, the campaign and the rejection come back.
create temp table pg_temp.no_call (r jsonb);
grant all on pg_temp.no_call to service_role;
insert into pg_temp.no_call
select public.sales_log_call('00000000-0000-0000-0000-0000000007e3', 'reached_not_interested',
  p_reasons => array['no_time'], p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  -- The company was already lost by Lars; Lena's "no" is logged on her and the company stays lost.
  if (select status from public.contacts where id = '00000000-0000-0000-0000-0000000007e3') <> 'not_interested' then
    raise exception 'FAIL: not interested should close the second contact too';
  end if;
end $$;
select public.sales_undo_call((select (r ->> 'activity_id')::uuid from pg_temp.no_call), p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if (select status from public.contacts where id = '00000000-0000-0000-0000-0000000007e3') <> 'new' then
    raise exception 'FAIL: undo should reopen the contact';
  end if;
  if (select count(*) from public.call_rejections where company_id = '00000000-0000-0000-0000-0000000007d2') <> 1 then
    raise exception 'FAIL: undo should remove only that rejection';
  end if;
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000007d2') is distinct from 'lost' then
    raise exception 'FAIL: the first rejection still stands';
  end if;
end $$;

-- Undo of a referral and a planned meeting: the new contact and the meeting go.
create temp table pg_temp.ref_call (r jsonb);
grant all on pg_temp.ref_call to service_role;
insert into pg_temp.ref_call
select public.sales_log_call('00000000-0000-0000-0000-0000000007e6', 'referred',
  p_referred_name => 'Rita Referral', p_referred_title => 'CTO', p_referred_email => 'rita@undo.nl', p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if (select email from public.contacts where company_id = '00000000-0000-0000-0000-0000000007d4' and first_name = 'Rita') is distinct from 'rita@undo.nl' then
    raise exception 'FAIL: the referred contact should get the mail address';
  end if;
end $$;
select public.sales_undo_call((select (r ->> 'activity_id')::uuid from pg_temp.ref_call), p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if exists (select 1 from public.contacts where company_id = '00000000-0000-0000-0000-0000000007d4' and first_name = 'Rita') then
    raise exception 'FAIL: undo should remove the contact the referral made';
  end if;
end $$;

create temp table pg_temp.meet_call (r jsonb);
grant all on pg_temp.meet_call to service_role;
select public.sales_claim_contact('00000000-0000-0000-0000-0000000007e6', '00000000-0000-0000-0000-0000000006a2');
insert into pg_temp.meet_call
select public.sales_log_call('00000000-0000-0000-0000-0000000007e6', 'meeting_planned', p_note => 'Needs a data team',
  p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if (select count(*) from public.meetings where company_id = '00000000-0000-0000-0000-0000000007d4') <> 1 then
    raise exception 'FAIL: meeting planned should create a planned meeting';
  end if;
end $$;
select public.sales_undo_call((select (r ->> 'activity_id')::uuid from pg_temp.meet_call), p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  if exists (select 1 from public.meetings where company_id = '00000000-0000-0000-0000-0000000007d4') then
    raise exception 'FAIL: undo should remove the planned meeting';
  end if;
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000007d4') is not null then
    raise exception 'FAIL: undo should take the company back out of the pipeline';
  end if;
end $$;

-- Too late, or changed since: no undo.
create temp table pg_temp.late_call (r jsonb);
grant all on pg_temp.late_call to service_role;
insert into pg_temp.late_call
select public.sales_log_call('00000000-0000-0000-0000-0000000007e6', 'no_answer', p_actor => '00000000-0000-0000-0000-0000000006a2');
reset role;
update public.call_undo set created_at = now() - interval '2 minutes'
where activity_id = (select (r ->> 'activity_id')::uuid from pg_temp.late_call);
set local role service_role;
select pg_temp.service();
do $$ begin
  perform public.sales_undo_call((select (r ->> 'activity_id')::uuid from pg_temp.late_call), p_actor => '00000000-0000-0000-0000-0000000006a2');
  raise exception 'FAIL: a call cannot be undone after a minute';
exception when others then
  if sqlerrm not like '%Too late to undo%' then raise exception 'FAIL: unexpected error: %', sqlerrm; end if;
end $$;

create temp table pg_temp.first_call (r jsonb);
grant all on pg_temp.first_call to service_role;
insert into pg_temp.first_call
select public.sales_log_call('00000000-0000-0000-0000-0000000007e5', 'no_answer', p_actor => '00000000-0000-0000-0000-0000000006a2');
select public.sales_log_call('00000000-0000-0000-0000-0000000007e5', 'no_answer', p_actor => '00000000-0000-0000-0000-0000000006a2');
do $$ begin
  perform public.sales_undo_call((select (r ->> 'activity_id')::uuid from pg_temp.first_call), p_actor => '00000000-0000-0000-0000-0000000006a2');
  raise exception 'FAIL: a call that was followed by another call cannot be undone';
exception when others then
  if sqlerrm not like '%changed after the call%' then raise exception 'FAIL: unexpected error: %', sqlerrm; end if;
end $$;

-- The undo table is not open to anyone but the functions.
reset role;
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000006a1');
do $$ begin
  if exists (select 1 from public.call_undo) then
    raise exception 'FAIL: nobody reads the undo snapshots through the API';
  end if;
end $$;

reset role;
rollback;

\echo 'calls tests passed'
