-- Sequences, approval, enrollments and the pause after a reply
-- (supabase/migrations/*_sales_sequences_claude.sql). Run against a database
-- with every migration applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sales_sequences.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000006a1', 'julius6@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000006a2', 'intern6@nordavo.nl', '{"full_name": "Intern"}'),
  ('00000000-0000-0000-0000-0000000006a5', 'recruiter6@nordavo.nl', '{"full_name": "Recruiter"}');

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000006a1';
update public.profiles set role = 'member', modules = array['sales'] where id = '00000000-0000-0000-0000-0000000006a2';
update public.profiles set role = 'member', modules = array['recruitment'] where id = '00000000-0000-0000-0000-0000000006a5';

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
create function pg_temp.service(p_dummy int default 0) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
$$;
grant execute on function pg_temp.act(uuid), pg_temp.service(int) to authenticated;

insert into public.companies (id, name, domain, icp_decision, lead_status) values
  ('00000000-0000-0000-0000-0000000006d1', 'Seq One', 'seqone.nl', 'GO', 'ready'),
  ('00000000-0000-0000-0000-0000000006d2', 'Seq Two', 'seqtwo.nl', 'GO', 'ready');
insert into public.contacts (id, company_id, first_name, last_name, is_primary) values
  ('00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-0000000006d1', 'Eva', 'One', true);

-- ---------------------------------------------------------------------------
-- A text written by hand counts as approved by that person; a concept not
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000006a2');

insert into public.sequences (id, name, status) values ('00000000-0000-0000-0000-0000000006f1', 'Data roles', 'active');
insert into public.sequence_steps (id, sequence_id, position, day_offset, channel, subject, body) values
  ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006f1', 1, 0, 'mail', 'Hi', 'Hello {first_name}');
insert into public.sequence_steps (id, sequence_id, position, day_offset, channel, draft_body, draft_source) values
  ('00000000-0000-0000-0000-0000000006b2', '00000000-0000-0000-0000-0000000006f1', 2, 2, 'linkedin', 'Connect?', 'claude');
insert into public.sequence_steps (id, sequence_id, position, day_offset, channel) values
  ('00000000-0000-0000-0000-0000000006b3', '00000000-0000-0000-0000-0000000006f1', 3, 4, 'call');

do $$ begin
  if (select approved_by from public.sequence_steps where id = '00000000-0000-0000-0000-0000000006b1')
     is distinct from '00000000-0000-0000-0000-0000000006a2' then
    raise exception 'FAIL: a text written by hand should be approved by its writer';
  end if;
  if (select approved_at from public.sequence_steps where id = '00000000-0000-0000-0000-0000000006b2') is not null then
    raise exception 'FAIL: a concept should not be approved';
  end if;
  if (select draft_at from public.sequence_steps where id = '00000000-0000-0000-0000-0000000006b2') is null then
    raise exception 'FAIL: a concept should have a draft date';
  end if;
end $$;

-- The LinkedIn step waits for approval: the sequence cannot start.
do $$ begin
  perform public.sales_start_sequence('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006d1');
  raise exception 'FAIL: a sequence with an unapproved concept should not start';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- Julius approves the concept: it becomes the text and the concept goes.
select pg_temp.act('00000000-0000-0000-0000-0000000006a1');
update public.sequence_steps
set subject = draft_subject, body = draft_body, draft_subject = null, draft_body = null
where id = '00000000-0000-0000-0000-0000000006b2';
do $$ begin
  if (select approved_by from public.sequence_steps where id = '00000000-0000-0000-0000-0000000006b2')
     is distinct from '00000000-0000-0000-0000-0000000006a1' then
    raise exception 'FAIL: approving should record who approved';
  end if;
  if (select draft_source from public.sequence_steps where id = '00000000-0000-0000-0000-0000000006b2') is not null then
    raise exception 'FAIL: an approved concept should be cleared';
  end if;
end $$;

-- Clearing the text removes the approval.
update public.sequence_steps set body = null where id = '00000000-0000-0000-0000-0000000006b1';
do $$ begin
  if (select approved_at from public.sequence_steps where id = '00000000-0000-0000-0000-0000000006b1') is not null then
    raise exception 'FAIL: a step without text cannot be approved';
  end if;
end $$;
update public.sequence_steps set body = 'Hello again {first_name}' where id = '00000000-0000-0000-0000-0000000006b1';

-- ---------------------------------------------------------------------------
-- Enrollments: pause, resume, stop
-- ---------------------------------------------------------------------------

select pg_temp.act('00000000-0000-0000-0000-0000000006a2');
select public.sales_start_sequence('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006d1');

do $$ declare v uuid; begin
  select id into v from public.sequence_enrollments where company_id = '00000000-0000-0000-0000-0000000006d1';
  if (select contact_id from public.sequence_enrollments where id = v) <> '00000000-0000-0000-0000-0000000006e1' then
    raise exception 'FAIL: the primary contact should be enrolled';
  end if;
  perform public.sales_set_enrollment(v, 'paused', 'Holiday');
  if (select status from public.sequence_tasks where enrollment_id = v and channel = 'call') <> 'cancelled' then
    raise exception 'FAIL: pausing should cancel the open call step';
  end if;
  if (select status from public.sequence_tasks where enrollment_id = v and channel = 'mail') <> 'open' then
    raise exception 'FAIL: pausing keeps mail steps (Claude pauses them in Instantly)';
  end if;
  perform public.sales_set_enrollment(v, 'active');
  if (select status from public.sequence_tasks where enrollment_id = v and channel = 'call') <> 'open' then
    raise exception 'FAIL: resuming should reopen future steps';
  end if;
  perform public.sales_set_enrollment(v, 'stopped');
  if exists (select 1 from public.sequence_tasks where enrollment_id = v and status = 'open') then
    raise exception 'FAIL: stopping should cancel every open step';
  end if;
  if (select count(*) from public.activities where company_id = '00000000-0000-0000-0000-0000000006d1'
      and type = 'system' and notes like 'Sequence %') <> 3 then
    raise exception 'FAIL: each change of an enrollment should be logged';
  end if;
  perform public.sales_set_enrollment(v, 'active');
  raise exception 'FAIL: a stopped enrollment cannot be resumed';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- Without the sales module nothing can be changed.
select pg_temp.act('00000000-0000-0000-0000-0000000006a5');
do $$ begin
  if exists (select 1 from public.sequences) then
    raise exception 'FAIL: a recruitment only member can read sequences';
  end if;
  perform public.sales_pause('00000000-0000-0000-0000-0000000006d1');
  raise exception 'FAIL: a recruitment only member could pause a company';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Claude pauses a company for the token owner (secret key and p_actor)
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;
select pg_temp.service();

select public.sales_start_sequence('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006d2',
  p_source => 'claude', p_actor => '00000000-0000-0000-0000-0000000006a1');
do $$ declare r jsonb; begin
  r := public.sales_pause('00000000-0000-0000-0000-0000000006d2', 'Reply in Seleqt', 'claude', '00000000-0000-0000-0000-0000000006a1');
  if (r ->> 'enrollments_paused')::int <> 1 or (r ->> 'call_steps_cancelled')::int <> 1 then
    raise exception 'FAIL: pause should report one enrollment and one call step, got %', r;
  end if;
  if (select status from public.sequence_enrollments where company_id = '00000000-0000-0000-0000-0000000006d2') <> 'paused' then
    raise exception 'FAIL: the enrollment should be paused';
  end if;
  if not exists (select 1 from public.activities where company_id = '00000000-0000-0000-0000-0000000006d2'
                 and source = 'claude' and created_by = '00000000-0000-0000-0000-0000000006a1' and notes like 'Company paused%') then
    raise exception 'FAIL: the pause should be logged with source claude and the token owner';
  end if;
  if (select source from public.sequence_enrollments where company_id = '00000000-0000-0000-0000-0000000006d2') <> 'claude' then
    raise exception 'FAIL: an enrollment started by Claude should say so';
  end if;
end $$;

-- Every step closed: the enrollment is finished.
insert into public.companies (id, name, domain, icp_decision, lead_status) values
  ('00000000-0000-0000-0000-0000000006d3', 'Seq Three', 'seqthree.nl', 'GO', 'ready');
select public.sales_start_sequence('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006d3',
  p_source => 'claude', p_actor => '00000000-0000-0000-0000-0000000006a1');
update public.sequence_tasks set status = 'done', done_at = now()
where company_id = '00000000-0000-0000-0000-0000000006d3' and channel <> 'call';
do $$ begin
  if (select status from public.sequence_enrollments where company_id = '00000000-0000-0000-0000-0000000006d3') <> 'active' then
    raise exception 'FAIL: an enrollment with an open call step is still active';
  end if;
end $$;
update public.sequence_tasks set status = 'skipped' where company_id = '00000000-0000-0000-0000-0000000006d3' and channel = 'call';
do $$ begin
  if (select status from public.sequence_enrollments where company_id = '00000000-0000-0000-0000-0000000006d3') <> 'finished' then
    raise exception 'FAIL: an enrollment without open steps should be finished';
  end if;
end $$;

-- A token owner without the sales module cannot act through the secret key.
do $$ begin
  perform public.sales_pause('00000000-0000-0000-0000-0000000006d2', null, 'claude', '00000000-0000-0000-0000-0000000006a5');
  raise exception 'FAIL: p_actor without the sales module should be refused';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Claude's job runs are sales jobs
-- ---------------------------------------------------------------------------

do $$ begin
  if public.job_module('claude-replies') is distinct from 'sales' then
    raise exception 'FAIL: claude-* jobs should belong to sales';
  end if;
  if public.job_module('work-notify') is not null or public.job_module('t2-match') <> 'recruitment' then
    raise exception 'FAIL: the other jobs keep their module';
  end if;
end $$;

reset role;
rollback;

\echo 'sales sequences tests passed'
