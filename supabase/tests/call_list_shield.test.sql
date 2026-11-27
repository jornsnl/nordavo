-- Call lists shielded from mail and LinkedIn (supabase/migrations/20261127000000_sales_call_list_shield.sql).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/call_list_shield.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000071a1', 'admin71@nordavo.nl', '{"full_name": "Admin"}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000071a1';

create function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_what;
  end if;
end;
$$;
create function pg_temp.outreach(p_item text) returns jsonb language sql as $$
  select public.sales_check_outreach(array[p_item]) -> 0;
$$;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

insert into public.callers (id, name, email, status) values ('00000000-0000-0000-0000-0000000071b1', 'Beller Test', 'beller71@nordavo.nl', 'active');
insert into public.campaigns (id, name, provider, channel, status) values
  ('00000000-0000-0000-0000-0000000071d1', 'Test mail', 'instantly', 'mail', 'active');
insert into public.companies (id, name, domain, lead_status) values
  ('00000000-0000-0000-0000-0000000071c1', 'Belbedrijf', 'belbedrijf-71.nl', 'ready'),
  ('00000000-0000-0000-0000-0000000071c2', 'Vrijbedrijf', 'vrijbedrijf-71.nl', 'ready');
insert into public.contacts (id, company_id, first_name, last_name, email) values
  ('00000000-0000-0000-0000-0000000071e1', '00000000-0000-0000-0000-0000000071c1', 'Anna', 'Bel', 'anna@belbedrijf-71.nl');

-- Free at the start.
select pg_temp.check((pg_temp.outreach('belbedrijf-71.nl') ->> 'allowed')::boolean, 'free company allowed');
select pg_temp.check(o.free and o.occupied_by is null, 'free in the view')
from public.sales_company_occupation o where o.company_id = '00000000-0000-0000-0000-0000000071c1';

-- On the call list of a caller.
select pg_temp.check((public.sales_triage(array['00000000-0000-0000-0000-0000000071c1']::uuid[], 'call',
  '{"caller_id": "00000000-0000-0000-0000-0000000071b1"}', 'claude', '00000000-0000-0000-0000-0000000071a1') ->> 'moved')::int = 1, 'to the call list');
select pg_temp.check(not (pg_temp.outreach('belbedrijf-71.nl') ->> 'allowed')::boolean, 'domain refused on a call list');
select pg_temp.check(pg_temp.outreach('belbedrijf-71.nl') -> 'reasons' ? 'bellijst Beller Test', 'reason bellijst <caller>');
select pg_temp.check(pg_temp.outreach('anna@belbedrijf-71.nl') -> 'reasons' ? 'bellijst Beller Test', 'mail address of a contact refused too');
select pg_temp.check(o.occupied_by = 'call' and o.occupied_label = 'Beller Test' and o.occupied_since is not null and not o.free, 'occupied by call')
from public.sales_company_occupation o where o.company_id = '00000000-0000-0000-0000-0000000071c1';
select pg_temp.check(not public.sales_is_free(c), 'sales_is_free false on a call list')
from public.companies c where c.id = '00000000-0000-0000-0000-0000000071c1';

-- A2: no mail campaign while on a call list, unless forced.
select pg_temp.check(public.sales_triage(array['00000000-0000-0000-0000-0000000071c1']::uuid[], 'mail_campaign',
  '{"campaign_id": "00000000-0000-0000-0000-0000000071d1"}', 'claude', '00000000-0000-0000-0000-0000000071a1')
  -> 'skipped' -> 0 ->> 'reason' = 'Already in a call list', 'triage skips a lead on a call list');

-- Back to free: allowed again.
select public.sales_triage(array['00000000-0000-0000-0000-0000000071c1']::uuid[], 'free', '{}', 'claude', '00000000-0000-0000-0000-0000000071a1');
select pg_temp.check((pg_temp.outreach('belbedrijf-71.nl') ->> 'allowed')::boolean, 'allowed again after free');
select pg_temp.check(public.sales_is_free(c), 'free again') from public.companies c where c.id = '00000000-0000-0000-0000-0000000071c1';

-- A campaign still gives "campagne <name>".
select public.sales_triage(array['00000000-0000-0000-0000-0000000071c2']::uuid[], 'mail_campaign',
  '{"campaign_id": "00000000-0000-0000-0000-0000000071d1"}', 'claude', '00000000-0000-0000-0000-0000000071a1');
select pg_temp.check(pg_temp.outreach('vrijbedrijf-71.nl') -> 'reasons' ? 'campagne Test mail', 'campagne <name>');
select pg_temp.check(o.occupied_by = 'mail_campaign' and o.occupied_label = 'Test mail', 'occupied by the mail campaign')
from public.sales_company_occupation o where o.company_id = '00000000-0000-0000-0000-0000000071c2';

rollback;
