-- Route pick list, change log of every editable column, one activity per
-- drag, concept texts logged on the sequence, LinkedIn of a client contact
-- (supabase/migrations/*_sales_gaps.sql). Run against a database with every
-- migration applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sales_gaps.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'julius9@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000009a2', 'intern9@nordavo.nl', '{"full_name": "Intern"}'),
  ('00000000-0000-0000-0000-0000000009a5', 'recruiter9@nordavo.nl', '{"full_name": "Recruiter"}');

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009a1';
update public.profiles set role = 'member', modules = array['sales'] where id = '00000000-0000-0000-0000-0000000009a2';
update public.profiles set role = 'member', modules = array['recruitment'] where id = '00000000-0000-0000-0000-0000000009a5';

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
create function pg_temp.service(p_dummy int default 0) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
$$;
grant execute on function pg_temp.act(uuid), pg_temp.service(int) to authenticated, service_role;

insert into public.companies (id, name, domain, lead_status) values
  ('00000000-0000-0000-0000-0000000009d1', 'Gap One', 'gapone.nl', 'ready'),
  ('00000000-0000-0000-0000-0000000009d2', 'Gap Two', 'gaptwo.nl', 'ready'),
  ('00000000-0000-0000-0000-0000000009d3', 'Gap Three', 'gapthree.nl', 'ready');
insert into public.contacts (id, company_id, first_name, route) values
  ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009d1', 'Eva', 'Mobile');

-- ---------------------------------------------------------------------------
-- Route: only the fixed list
-- ---------------------------------------------------------------------------

do $$ begin
  update public.contacts set route = 'Bellen maar' where id = '00000000-0000-0000-0000-0000000009e1';
  raise exception 'FAIL: a route outside the list should be refused';
exception when check_violation then null;
end $$;

update public.contacts set route = 'Via reception' where id = '00000000-0000-0000-0000-0000000009e1';
update public.contacts set route = null where id = '00000000-0000-0000-0000-0000000009e1';

-- ---------------------------------------------------------------------------
-- Columns that were not logged before are logged now
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000009a2');

select public.sales_update('company', array['00000000-0000-0000-0000-0000000009d1'::uuid], '{"icp_score": 80, "segment": "saas"}'::jsonb);
select public.sales_update('contact', array['00000000-0000-0000-0000-0000000009e1'::uuid], '{"email_status": "valid", "route": "Mail"}'::jsonb);

do $$ begin
  if (select count(distinct field) from public.activities
      where company_id = '00000000-0000-0000-0000-0000000009d1' and type = 'change'
        and created_by = '00000000-0000-0000-0000-0000000009a2'
        and field in ('icp_score', 'segment', 'email_status', 'route')) <> 4 then
    raise exception 'FAIL: icp_score, segment, email_status and route should each be one change row';
  end if;
  if (select created_by from public.activities where field = 'segment' and company_id = '00000000-0000-0000-0000-0000000009d1')
     is distinct from '00000000-0000-0000-0000-0000000009a2' then
    raise exception 'FAIL: the change row should name who changed it';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Dragging: one activity per drag, also when every row is numbered
-- ---------------------------------------------------------------------------

select public.sales_set_positions(
  'company',
  array['00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009d2', '00000000-0000-0000-0000-0000000009d3']::uuid[],
  array[1024, 2048, 3072]::double precision[],
  '00000000-0000-0000-0000-0000000009d3'
);

do $$ begin
  if (select count(*) from public.activities where field = 'manual_position'
      and company_id in ('00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009d2', '00000000-0000-0000-0000-0000000009d3')) <> 1 then
    raise exception 'FAIL: numbering a whole view should be one activity';
  end if;
  if (select company_id from public.activities where field = 'manual_position') <> '00000000-0000-0000-0000-0000000009d3' then
    raise exception 'FAIL: the reorder should be logged on the dragged row';
  end if;
  if (select manual_position from public.companies where id = '00000000-0000-0000-0000-0000000009d2') <> 2048 then
    raise exception 'FAIL: positions should be stored';
  end if;
end $$;

-- A second drag of one row is one more activity, with old and new position.
select public.sales_set_positions('company', array['00000000-0000-0000-0000-0000000009d3']::uuid[], array[512]::double precision[], '00000000-0000-0000-0000-0000000009d3');
do $$ begin
  if (select count(*) from public.activities where field = 'manual_position') <> 2 then
    raise exception 'FAIL: each drag should be one activity';
  end if;
  if not exists (select 1 from public.activities where field = 'manual_position'
                 and old_value = '3072'::jsonb and new_value = '512'::jsonb) then
    raise exception 'FAIL: the activity should hold the old and new position';
  end if;
end $$;

-- Somebody without sales may not reorder.
select pg_temp.act('00000000-0000-0000-0000-0000000009a5');
do $$ begin
  perform public.sales_set_positions('company', array['00000000-0000-0000-0000-0000000009d1']::uuid[], array[1]::double precision[]);
  raise exception 'FAIL: a recruiter without sales should not reorder';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
-- A concept text goes through sales_draft_step and is logged on the sequence
-- ---------------------------------------------------------------------------

select pg_temp.act('00000000-0000-0000-0000-0000000009a1');
insert into public.sequences (id, name, status) values ('00000000-0000-0000-0000-0000000009f1', 'Gap sequence', 'draft');
insert into public.sequence_steps (id, sequence_id, position, day_offset, channel) values
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009f1', 1, 0, 'mail'),
  ('00000000-0000-0000-0000-0000000009b2', '00000000-0000-0000-0000-0000000009f1', 2, 2, 'linkedin');

-- Claude through the MCP: the secret key acts for the token owner.
reset role;
set local role service_role;
select pg_temp.service();
select public.sales_draft_step('00000000-0000-0000-0000-0000000009b1', 'Hi {first_name}', 'Saw your vacancy', 'claude', '00000000-0000-0000-0000-0000000009a2');

do $$ begin
  if (select draft_source from public.sequence_steps where id = '00000000-0000-0000-0000-0000000009b1') <> 'claude' then
    raise exception 'FAIL: the concept should be marked as written by Claude';
  end if;
  if (select approved_at from public.sequence_steps where id = '00000000-0000-0000-0000-0000000009b1') is not null then
    raise exception 'FAIL: a concept is never approved by itself';
  end if;
  if not exists (select 1 from public.activities
                 where sequence_id = '00000000-0000-0000-0000-0000000009f1' and source = 'claude'
                   and created_by = '00000000-0000-0000-0000-0000000009a2' and field = 'draft_body') then
    raise exception 'FAIL: the concept should be an activity on the sequence with source claude';
  end if;
end $$;

do $$ begin
  perform public.sales_draft_step('00000000-0000-0000-0000-0000000009b2', 'Subject', 'Body', 'claude', '00000000-0000-0000-0000-0000000009a2');
  raise exception 'FAIL: a LinkedIn step has no subject';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

do $$ begin
  perform public.sales_draft_step('00000000-0000-0000-0000-0000000009b2', null, 'Body', 'claude', '00000000-0000-0000-0000-0000000009a5');
  raise exception 'FAIL: the MCP may not act for somebody without sales';
exception when insufficient_privilege then null;
end $$;

-- A person without sales cannot call it at all.
reset role;
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000009a5');
do $$ begin
  perform public.sales_draft_step('00000000-0000-0000-0000-0000000009b2', null, 'Body');
  raise exception 'FAIL: a recruiter without sales should not write concepts';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
-- LinkedIn of a client contact
-- ---------------------------------------------------------------------------

reset role;
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000009c1', 'Gap Client');
insert into public.client_contacts (client_id, full_name, linkedin_url, is_primary)
values ('00000000-0000-0000-0000-0000000009c1', 'Piet', 'https://www.linkedin.com/in/piet', true);
do $$ begin
  insert into public.client_contacts (client_id, full_name, linkedin_url)
  values ('00000000-0000-0000-0000-0000000009c1', 'Kees', 'javascript:alert(1)');
  raise exception 'FAIL: a LinkedIn link should start with http';
exception when check_violation then null;
end $$;

rollback;
