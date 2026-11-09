-- Nordavo Academy, holidays in the Netherlands and India (Karnataka) (spec
-- Academy, Deel 2). Builds on 20261112010000_academy_placements.sql.
--
--   1  day_off (not every holiday is a day off: Good Friday and Liberation
--      Day in most Dutch jobs) and confirmed (Indian festival dates follow
--      the moon; the state publishes the official list each year)
--   2  academy_easter() and academy_seed_holidays(year): the Dutch holidays
--      computed (Easter, Ascension, Pentecost, King's Day), and the Indian
--      holidays on a fixed date. Same rules as src/lib/academy/placement/holidays.ts
--   3  Seed 2026 to 2030, plus the Karnataka festival days of 2026 to 2028
--      (expected dates, confirmed = false until Nordavo checks them against
--      the Karnataka government list)

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.academy_holidays
  add column day_off boolean not null default true,
  add column confirmed boolean not null default true;

-- Two holidays can fall on one day (Good Friday and Ambedkar Jayanti in 2028).
alter table public.academy_holidays drop constraint academy_holidays_country_region_date_key;
create unique index academy_holidays_unique on public.academy_holidays (country, (coalesce(region, '')), date, name_en);

-- Holidays are for the Academy and the Nordavo team, not for Work guests.
drop policy "Everyone reads holidays" on public.academy_holidays;
create policy "Academy people read holidays" on public.academy_holidays
  for select to authenticated using (public.academy_member_role() is not null or public.is_staff());

-- ---------------------------------------------------------------------------
-- 2. Computed holidays
-- ---------------------------------------------------------------------------

-- Easter Sunday (Gregorian, anonymous algorithm of Meeus/Jones/Butcher).
create or replace function public.academy_easter(p_year integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  a integer := p_year % 19;
  b integer := p_year / 100;
  c integer := p_year % 100;
  d integer := b / 4;
  e integer := b % 4;
  f integer := (b + 8) / 25;
  g integer := (b - f + 1) / 3;
  h integer := (19 * a + b - d - g + 15) % 30;
  i integer := c / 4;
  k integer := c % 4;
  l integer := (32 + 2 * e + 2 * i - h - k) % 7;
  m integer := (a + 11 * h + 22 * l) / 451;
  v_month integer := (h + l - 7 * m + 114) / 31;
  v_day integer := ((h + l - 7 * m + 114) % 31) + 1;
begin
  return make_date(p_year, v_month, v_day);
end;
$$;

-- The holidays that follow a rule, for one year. Idempotent; rows that
-- Nordavo changed stay as they are.
create or replace function public.academy_seed_holidays(p_year integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_easter date := public.academy_easter(p_year);
  v_kings date := make_date(p_year, 4, 27);
  v_count integer;
begin
  if (select auth.uid()) is not null and not public.academy_is_manager() then
    raise exception 'Only Nordavo manages holidays' using errcode = '42501';
  end if;
  if p_year not between 2020 and 2100 then
    raise exception 'Year out of range';
  end if;
  -- King's Day moves to Saturday 26 April when 27 April is a Sunday.
  if extract(isodow from v_kings) = 7 then
    v_kings := v_kings - 1;
  end if;

  insert into public.academy_holidays (country, region, year, date, name_nl, name_en, day_off, confirmed)
  values
    ('NL', null, p_year, make_date(p_year, 1, 1), 'Nieuwjaarsdag', 'New Year''s Day', true, true),
    ('NL', null, p_year, v_easter - 2, 'Goede Vrijdag', 'Good Friday', false, true),
    ('NL', null, p_year, v_easter, 'Eerste Paasdag', 'Easter Sunday', true, true),
    ('NL', null, p_year, v_easter + 1, 'Tweede Paasdag', 'Easter Monday', true, true),
    ('NL', null, p_year, v_kings, 'Koningsdag', 'King''s Day', true, true),
    -- A day off every five years (2025, 2030) in most collective agreements.
    ('NL', null, p_year, make_date(p_year, 5, 5), 'Bevrijdingsdag', 'Liberation Day', p_year % 5 = 0, true),
    ('NL', null, p_year, v_easter + 39, 'Hemelvaartsdag', 'Ascension Day', true, true),
    ('NL', null, p_year, v_easter + 49, 'Eerste Pinksterdag', 'Whit Sunday', true, true),
    ('NL', null, p_year, v_easter + 50, 'Tweede Pinksterdag', 'Whit Monday', true, true),
    ('NL', null, p_year, make_date(p_year, 12, 25), 'Eerste Kerstdag', 'Christmas Day', true, true),
    ('NL', null, p_year, make_date(p_year, 12, 26), 'Tweede Kerstdag', 'Boxing Day', true, true),
    ('IN', 'KA', p_year, make_date(p_year, 1, 26), 'Dag van de Republiek', 'Republic Day', true, true),
    ('IN', 'KA', p_year, v_easter - 2, 'Goede Vrijdag', 'Good Friday', true, true),
    ('IN', 'KA', p_year, make_date(p_year, 4, 14), 'Ambedkar Jayanti', 'Dr. B.R. Ambedkar Jayanti', true, true),
    ('IN', 'KA', p_year, make_date(p_year, 5, 1), 'Dag van de Arbeid', 'May Day', true, true),
    ('IN', 'KA', p_year, make_date(p_year, 8, 15), 'Onafhankelijkheidsdag', 'Independence Day', true, true),
    ('IN', 'KA', p_year, make_date(p_year, 10, 2), 'Gandhi Jayanti', 'Gandhi Jayanti', true, true),
    ('IN', 'KA', p_year, make_date(p_year, 11, 1), 'Kannada Rajyotsava', 'Kannada Rajyotsava', true, true),
    ('IN', 'KA', p_year, make_date(p_year, 12, 25), 'Kerstmis', 'Christmas', true, true)
  on conflict (country, (coalesce(region, '')), date, name_en) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.academy_easter(integer) from public, anon;
grant execute on function public.academy_easter(integer) to authenticated, service_role;
revoke execute on function public.academy_seed_holidays(integer) from public, anon;
grant execute on function public.academy_seed_holidays(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Seed
-- ---------------------------------------------------------------------------

select public.academy_seed_holidays(y) from generate_series(2026, 2030) y;

-- Karnataka festival days that follow the Hindu or Islamic calendar, from the
-- published festival calendars. Islamic dates depend on the sighting of the
-- moon and can move a day; the state's official list (published late in the
-- year before) is leading. confirmed = false shows "date may change" until
-- Nordavo checks it in /dashboard/academy/holidays.
insert into public.academy_holidays (country, region, year, date, name_nl, name_en, day_off, confirmed)
select 'IN', 'KA', extract(year from x.d)::integer, x.d, x.nl, x.en, true, false
from (values
  ('2026-01-15'::date, 'Makara Sankranti', 'Makara Sankranti'),
  ('2026-02-15', 'Maha Shivaratri', 'Maha Shivaratri'),
  ('2026-03-19', 'Ugadi (Nieuwjaar)', 'Ugadi'),
  ('2026-03-21', 'Ramadan (Eid al-Fitr)', 'Khutub-e-Ramzan (Eid al-Fitr)'),
  ('2026-03-31', 'Mahavir Jayanti', 'Mahaveera Jayanti'),
  ('2026-04-20', 'Basava Jayanti', 'Basava Jayanti / Akshaya Tritiya'),
  ('2026-05-27', 'Offerfeest (Bakrid)', 'Bakrid (Eid al-Adha)'),
  ('2026-06-26', 'Muharram', 'Last day of Muharram'),
  ('2026-08-26', 'Eid-e-Milad', 'Eid-e-Milad'),
  ('2026-09-14', 'Ganesh Chaturthi', 'Varasiddhi Vinayaka Vrata (Ganesh Chaturthi)'),
  ('2026-10-10', 'Mahalaya Amavasya', 'Mahalaya Amavasya'),
  ('2026-10-19', 'Mahanavami / Ayudha Puja', 'Mahanavami / Ayudha Puja'),
  ('2026-10-20', 'Vijayadashami', 'Vijayadashami'),
  ('2026-10-26', 'Valmiki Jayanti', 'Maharshi Valmiki Jayanti'),
  ('2026-11-08', 'Naraka Chaturdashi (Diwali)', 'Naraka Chaturdashi'),
  ('2026-11-10', 'Balipadyami (Diwali)', 'Balipadyami, Deepavali'),
  ('2026-11-27', 'Kanakadasa Jayanti', 'Kanakadasa Jayanti'),
  ('2027-01-15', 'Makara Sankranti', 'Makara Sankranti'),
  ('2027-03-06', 'Maha Shivaratri', 'Maha Shivaratri'),
  ('2027-03-10', 'Ramadan (Eid al-Fitr)', 'Khutub-e-Ramzan (Eid al-Fitr)'),
  ('2027-04-07', 'Ugadi (Nieuwjaar)', 'Ugadi'),
  ('2027-04-18', 'Mahavir Jayanti', 'Mahaveera Jayanti'),
  ('2027-05-09', 'Basava Jayanti', 'Basava Jayanti / Akshaya Tritiya'),
  ('2027-05-17', 'Offerfeest (Bakrid)', 'Bakrid (Eid al-Adha)'),
  ('2027-06-15', 'Muharram', 'Last day of Muharram'),
  ('2027-08-15', 'Eid-e-Milad', 'Eid-e-Milad'),
  ('2027-09-04', 'Ganesh Chaturthi', 'Varasiddhi Vinayaka Vrata (Ganesh Chaturthi)'),
  ('2027-09-29', 'Mahalaya Amavasya', 'Mahalaya Amavasya'),
  ('2027-10-08', 'Mahanavami / Ayudha Puja', 'Mahanavami / Ayudha Puja'),
  ('2027-10-09', 'Vijayadashami', 'Vijayadashami'),
  ('2027-10-15', 'Valmiki Jayanti', 'Maharshi Valmiki Jayanti'),
  ('2027-10-28', 'Naraka Chaturdashi (Diwali)', 'Naraka Chaturdashi'),
  ('2027-10-30', 'Balipadyami (Diwali)', 'Balipadyami, Deepavali'),
  ('2027-11-17', 'Kanakadasa Jayanti', 'Kanakadasa Jayanti'),
  ('2028-01-15', 'Makara Sankranti', 'Makara Sankranti'),
  ('2028-02-23', 'Maha Shivaratri', 'Maha Shivaratri'),
  ('2028-02-27', 'Ramadan (Eid al-Fitr)', 'Khutub-e-Ramzan (Eid al-Fitr)'),
  ('2028-03-27', 'Ugadi (Nieuwjaar)', 'Ugadi'),
  ('2028-04-07', 'Mahavir Jayanti', 'Mahaveera Jayanti'),
  ('2028-04-27', 'Basava Jayanti', 'Basava Jayanti / Akshaya Tritiya'),
  ('2028-05-05', 'Offerfeest (Bakrid)', 'Bakrid (Eid al-Adha)'),
  ('2028-06-03', 'Muharram', 'Last day of Muharram'),
  ('2028-08-03', 'Eid-e-Milad', 'Eid-e-Milad'),
  ('2028-08-23', 'Ganesh Chaturthi', 'Varasiddhi Vinayaka Vrata (Ganesh Chaturthi)'),
  ('2028-09-18', 'Mahalaya Amavasya', 'Mahalaya Amavasya'),
  ('2028-09-26', 'Mahanavami / Ayudha Puja', 'Mahanavami / Ayudha Puja'),
  ('2028-09-27', 'Vijayadashami', 'Vijayadashami'),
  ('2028-10-03', 'Valmiki Jayanti', 'Maharshi Valmiki Jayanti'),
  ('2028-10-17', 'Naraka Chaturdashi (Diwali)', 'Naraka Chaturdashi'),
  ('2028-10-18', 'Balipadyami (Diwali)', 'Balipadyami, Deepavali'),
  ('2028-12-05', 'Kanakadasa Jayanti', 'Kanakadasa Jayanti')
) x (d, nl, en)
on conflict (country, (coalesce(region, '')), date, name_en) do nothing;
