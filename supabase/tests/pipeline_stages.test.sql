-- Pipeline stages of round 3 (supabase/migrations/*_pipeline_stages.sql):
-- Contact as the first stage, Agreed and paid with the profiles deadline,
-- Parked with a date, Lost with a reason, and the old Intake done renamed.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pipeline_stages.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'julius@nordavo.nl', '{"full_name": "Julius"}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009a1';

insert into public.companies (id, name, domain, icp_decision, lead_status) values
  ('00000000-0000-0000-0000-0000000009d1', 'Warm BV', 'warm.nl', 'GO', 'ready'),
  ('00000000-0000-0000-0000-0000000009d2', 'Later BV', 'later.nl', 'GO', 'ready');

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
grant execute on function pg_temp.act(uuid) to authenticated;

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000009a1');

-- One click: a company goes into the pipeline at Contact.
select public.sales_update('company', array['00000000-0000-0000-0000-0000000009d1'::uuid], '{"pipeline_stage": "contact"}');
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000009d1') <> 'contact' then
    raise exception 'FAIL: a company should go into the pipeline at Contact';
  end if;
  if (select pipeline_entered_at from public.companies where id = '00000000-0000-0000-0000-0000000009d1') is null then
    raise exception 'FAIL: entering the pipeline should be dated';
  end if;
end $$;

-- A positive reply moves Contact forward to Interested.
select public.sales_log_activity(
  '00000000-0000-0000-0000-0000000009d1', null, 'mail', 'reply', 'reply_positief', 'Sounds good'
);
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000009d1') <> 'interested' then
    raise exception 'FAIL: interest should move Contact to Interested';
  end if;
end $$;

-- Agreed and paid: profiles due in three weeks, unless set by hand.
select public.sales_update('company', array['00000000-0000-0000-0000-0000000009d1'::uuid], '{"pipeline_stage": "agreed_paid"}');
do $$ begin
  if (select profiles_due_on from public.companies where id = '00000000-0000-0000-0000-0000000009d1') <> current_date + 21 then
    raise exception 'FAIL: agreed and paid should set profiles due in three weeks';
  end if;
end $$;
select public.sales_update('company', array['00000000-0000-0000-0000-0000000009d1'::uuid], '{"profiles_due_on": "2030-01-15"}');
do $$ begin
  if (select profiles_due_on from public.companies where id = '00000000-0000-0000-0000-0000000009d1') <> '2030-01-15' then
    raise exception 'FAIL: the profiles date should be editable';
  end if;
  if not exists (select 1 from public.activities where company_id = '00000000-0000-0000-0000-0000000009d1'
                 and type = 'change' and field = 'profiles_due_on') then
    raise exception 'FAIL: a new profiles date should land in the change log';
  end if;
end $$;

-- A vacancy (stage 5) does not move an agreed company back.
reset role;
insert into public.vacancies (id, company_id, title) values
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009d1', 'Java developer');
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000009d1') <> 'agreed_paid' then
    raise exception 'FAIL: a vacancy should never move a company back';
  end if;
end $$;

-- A vacancy for a company at Meeting held means Vacancy drafted.
update public.companies set pipeline_stage = 'meeting_held' where id = '00000000-0000-0000-0000-0000000009d2';
insert into public.vacancies (id, company_id, title) values
  ('00000000-0000-0000-0000-0000000009b2', '00000000-0000-0000-0000-0000000009d2', 'Data engineer');
do $$ begin
  if (select pipeline_stage from public.companies where id = '00000000-0000-0000-0000-0000000009d2') <> 'vacancy_drafted' then
    raise exception 'FAIL: a vacancy should mean Vacancy drafted';
  end if;
end $$;

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000009a1');

-- Parked needs a date, which becomes the next action.
do $$ begin
  begin
    perform public.sales_update('company', array['00000000-0000-0000-0000-0000000009d2'::uuid], '{"pipeline_stage": "parked"}');
    raise exception 'FAIL: parked without a date should be refused';
  exception when check_violation then null;
  end;
end $$;
select public.sales_update('company', array['00000000-0000-0000-0000-0000000009d2'::uuid],
  '{"pipeline_stage": "parked", "parked_until": "2030-03-01"}');
do $$
declare v record;
begin
  select * into v from public.companies where id = '00000000-0000-0000-0000-0000000009d2';
  if v.pipeline_stage <> 'parked' or v.parked_until <> '2030-03-01' then
    raise exception 'FAIL: a company should park with its date';
  end if;
  if v.next_action_date is distinct from '2030-03-01' or v.next_action is null then
    raise exception 'FAIL: the parked date should become the next action, got % %', v.next_action, v.next_action_date;
  end if;
end $$;

-- Something new brings a parked company back in, and clears the date.
select public.sales_log_activity(
  '00000000-0000-0000-0000-0000000009d2', null, 'mail', 'reply', 'reply_positief', 'Now we are ready'
);
do $$
declare v record;
begin
  select * into v from public.companies where id = '00000000-0000-0000-0000-0000000009d2';
  if v.pipeline_stage <> 'interested' then
    raise exception 'FAIL: interest should bring a parked company back, got %', v.pipeline_stage;
  end if;
  if v.parked_until is not null then
    raise exception 'FAIL: leaving Parked should clear the date';
  end if;
end $$;

-- Lost still needs a reason.
do $$ begin
  begin
    perform public.sales_update('company', array['00000000-0000-0000-0000-0000000009d2'::uuid], '{"pipeline_stage": "lost"}');
    raise exception 'FAIL: lost without a reason should be refused';
  exception when check_violation then null;
  end;
end $$;

-- The old stage is gone.
do $$ begin
  begin
    perform public.sales_update('company', array['00000000-0000-0000-0000-0000000009d2'::uuid], '{"pipeline_stage": "intake_done"}');
    raise exception 'FAIL: intake_done should no longer be a stage';
  exception when check_violation then null;
  end;
end $$;

-- Out of the pipeline clears the profiles deadline.
select public.sales_update('company', array['00000000-0000-0000-0000-0000000009d1'::uuid], '{"pipeline_stage": null}');
do $$ begin
  if (select profiles_due_on from public.companies where id = '00000000-0000-0000-0000-0000000009d1') is not null then
    raise exception 'FAIL: leaving the pipeline should clear the profiles date';
  end if;
end $$;

rollback;
