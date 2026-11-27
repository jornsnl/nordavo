-- Running routes (supabase/migrations/20261127010000_sales_routes.sql).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sales_routes.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000081a1', 'member81@nordavo.nl', '{"full_name": "Member"}'),
  ('00000000-0000-0000-0000-0000000081a2', 'caller81@nordavo.nl', '{"full_name": "Caller"}');
update public.profiles set role = 'member', modules = array['sales'] where id = '00000000-0000-0000-0000-0000000081a1';
update public.profiles set role = 'caller' where id = '00000000-0000-0000-0000-0000000081a2';

create function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_what;
  end if;
end;
$$;
grant execute on function pg_temp.check(boolean, text) to authenticated;

-- A member with sales: a route with only a name, the rest stays empty.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000081a1", "role": "authenticated"}', true);
set local role authenticated;
insert into public.sales_routes (id, name) values ('00000000-0000-0000-0000-0000000081b1', 'Alleen een naam');
select pg_temp.check(channel is null and status is null and ends_on is null and company_count is null and owner_text is null and note is null
  and created_by = '00000000-0000-0000-0000-0000000081a1' and updated_source = 'handmatig', 'only a name, the rest empty')
from public.sales_routes where id = '00000000-0000-0000-0000-0000000081b1';

-- An end date can be set and cleared.
update public.sales_routes set ends_on = '2026-12-31' where id = '00000000-0000-0000-0000-0000000081b1';
select pg_temp.check(ends_on = '2026-12-31', 'end date set') from public.sales_routes where id = '00000000-0000-0000-0000-0000000081b1';
update public.sales_routes set ends_on = null where id = '00000000-0000-0000-0000-0000000081b1';
select pg_temp.check(ends_on is null, 'end date cleared') from public.sales_routes where id = '00000000-0000-0000-0000-0000000081b1';

-- No empty name, no unknown status.
do $$
begin
  begin
    insert into public.sales_routes (name) values ('   ');
    raise exception 'FAIL: empty name allowed';
  exception when check_violation then null;
  end;
  begin
    update public.sales_routes set status = 'bezig';
    raise exception 'FAIL: unknown status allowed';
  exception when check_violation then null;
  end;
end $$;

-- A caller sees and adds nothing.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000081a2", "role": "authenticated"}', true);
select pg_temp.check((select count(*) from public.sales_routes) = 0, 'a caller sees no routes');
do $$
begin
  insert into public.sales_routes (name) values ('Beller');
  raise exception 'FAIL: a caller may add a route';
exception when insufficient_privilege then null;
end $$;

rollback;
