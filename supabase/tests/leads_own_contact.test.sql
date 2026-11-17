-- Own contact and contact channels (supabase/migrations/20261124700000_leads_own_contact_edit.sql).
-- NOT RUN when it was written: apply the migration to a scratch database first.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/leads_own_contact.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000047a1', 'sales47@nordavo.nl', '{"full_name": "Sales"}');
update public.profiles set role = 'member', modules = array['sales'] where id = '00000000-0000-0000-0000-0000000047a1';

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
grant execute on function pg_temp.act(uuid) to authenticated;

insert into public.companies (id, name, domain) values
  ('00000000-0000-0000-0000-0000000047c1', 'Pipelineco', 'pipelineco.nl'),
  ('00000000-0000-0000-0000-0000000047c2', 'Partnerco', 'partnerco.nl'),
  ('00000000-0000-0000-0000-0000000047c3', 'Coldco', 'coldco.nl');

insert into public.contacts (id, company_id, first_name, last_name, email, phone, phone_type) values
  ('00000000-0000-0000-0000-0000000047e1', '00000000-0000-0000-0000-0000000047c1', 'Pia', 'Pipe', 'pia@pipelineco.nl', '+31612345678', 'mobiel'),
  ('00000000-0000-0000-0000-0000000047e2', '00000000-0000-0000-0000-0000000047c2', 'Paul', 'Partner', 'paul@partnerco.nl', '+31612345679', 'mobiel'),
  ('00000000-0000-0000-0000-0000000047e3', '00000000-0000-0000-0000-0000000047c3', 'Cor', 'Cold', 'cor@coldco.nl', '+31612345670', 'mobiel');

select pg_temp.act('00000000-0000-0000-0000-0000000047a1');
set local role authenticated;

-- Entering the pipeline switches own contact on, with the reason.
update public.companies set pipeline_stage = 'contact' where id = '00000000-0000-0000-0000-0000000047c1';
do $$ begin
  if not (select own_contact from public.companies where id = '00000000-0000-0000-0000-0000000047c1') then
    raise exception 'FAIL: a company in the pipeline should be an own contact';
  end if;
  if (select own_contact_reason from public.companies where id = '00000000-0000-0000-0000-0000000047c1') <> 'In the pipeline' then
    raise exception 'FAIL: the reason should say In the pipeline';
  end if;
  if public.is_contactable('00000000-0000-0000-0000-0000000047e1', 'mail') then
    raise exception 'FAIL: an own contact should not be contactable by mail';
  end if;
end $$;

-- Lost switches the automatic protection off again.
update public.companies set pipeline_stage = 'lost', lost_reason = 'No budget' where id = '00000000-0000-0000-0000-0000000047c1';
do $$ begin
  if (select own_contact from public.companies where id = '00000000-0000-0000-0000-0000000047c1') then
    raise exception 'FAIL: a lost lead should be free again';
  end if;
end $$;

-- By hand: a partner. Stays until switched off.
select public.sales_set_own_contact('00000000-0000-0000-0000-0000000047c2', true, 'Partner');
do $$ begin
  if not (select own_contact from public.companies where id = '00000000-0000-0000-0000-0000000047c2') then
    raise exception 'FAIL: own contact by hand';
  end if;
  if not exists (select 1 from public.activities where company_id = '00000000-0000-0000-0000-0000000047c2' and field = 'own_contact') then
    raise exception 'FAIL: the change should be in Activities';
  end if;
end $$;

-- A cold campaign refuses an own contact, and accepts a free lead.
reset role;
insert into public.campaigns (id, name, channel, provider) values
  ('00000000-0000-0000-0000-0000000047f1', 'Cold test', 'mail', 'instantly');
do $$ begin
  begin
    insert into public.campaign_members (campaign_id, company_id, status)
    values ('00000000-0000-0000-0000-0000000047f1', '00000000-0000-0000-0000-0000000047c2', 'queued');
    raise exception 'FAIL: an own contact should not enter a campaign';
  exception when sqlstate 'P0001' then
    null;
  end;
  insert into public.campaign_members (campaign_id, company_id, status)
  values ('00000000-0000-0000-0000-0000000047f1', '00000000-0000-0000-0000-0000000047c3', 'queued');
end $$;

-- ... and a bucket change into cold outreach.
do $$ begin
  begin
    update public.companies set bucket = 'call' where id = '00000000-0000-0000-0000-0000000047c2';
    raise exception 'FAIL: an own contact should not go on a call list';
  exception when sqlstate 'P0001' then
    null;
  end;
end $$;

-- Switching it on while queued: the waiting member stops.
select public.sales_set_own_contact('00000000-0000-0000-0000-0000000047c3', true, 'Client');
do $$ begin
  if (select status from public.campaign_members where company_id = '00000000-0000-0000-0000-0000000047c3') <> 'stopped' then
    raise exception 'FAIL: a queued member should stop when the company becomes an own contact';
  end if;
end $$;
select public.sales_set_own_contact('00000000-0000-0000-0000-0000000047c3', false);

-- Channels and flags per contact.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000047a1', 'role', 'authenticated')::text, false);
set local role authenticated;
select public.sales_set_contact_flags('00000000-0000-0000-0000-0000000047e3', '{"no_mail": true}'::jsonb);
do $$ begin
  if public.is_contactable('00000000-0000-0000-0000-0000000047e3', 'mail') then
    raise exception 'FAIL: mail switched off should not be contactable by mail';
  end if;
  if not public.is_contactable('00000000-0000-0000-0000-0000000047e3', 'bellen') then
    raise exception 'FAIL: calling should still work';
  end if;
end $$;
select public.sales_set_contact_flags('00000000-0000-0000-0000-0000000047e3', '{"contact_flag": "wrong_number"}'::jsonb);
do $$ begin
  if public.is_contactable('00000000-0000-0000-0000-0000000047e3', 'bellen') then
    raise exception 'FAIL: a wrong number should not be called';
  end if;
end $$;
select public.sales_set_contact_flags('00000000-0000-0000-0000-0000000047e3', '{"contact_flag": "left_company"}'::jsonb);
do $$ begin
  if public.is_contactable('00000000-0000-0000-0000-0000000047e3', 'linkedin') then
    raise exception 'FAIL: someone who left should not be approached on any channel';
  end if;
  begin
    perform public.sales_set_contact_flags('00000000-0000-0000-0000-0000000047e3', '{"contact_flag": "nope"}'::jsonb);
    raise exception 'FAIL: an unknown flag should be refused';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

rollback;
