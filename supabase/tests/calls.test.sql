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

reset role;
rollback;

\echo 'calls tests passed'
