-- Academy placement page, rituals and pulse
-- (supabase/migrations/20261113*_academy_*.sql): who sees and writes what in
-- a placement, the timeline, leave, reviews, documents, the calendar feed,
-- holidays, rituals with reminders and the pulse with its signals. One
-- transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000c301', 'hr.pl@nordavo.nl', '{"full_name": "HR"}'),
  ('00000000-0000-0000-0000-00000000c302', 'sales.pl@nordavo.nl', '{"full_name": "Sales"}'),
  ('00000000-0000-0000-0000-00000000c303', 'boss.pl@kg.nl', '{"full_name": "Klant Beheer"}'),
  ('00000000-0000-0000-0000-00000000c304', 'lid.pl@kg.nl', '{"full_name": "Klant Lid"}'),
  ('00000000-0000-0000-0000-00000000c305', 'board.pl@kg.nl', '{"full_name": "Meelezer"}'),
  ('00000000-0000-0000-0000-00000000c306', 'dev.pl@example.in', '{"full_name": "Asha"}'),
  ('00000000-0000-0000-0000-00000000c307', 'cand.pl@example.in', '{"full_name": "Ravi"}'),
  ('00000000-0000-0000-0000-00000000c308', 'other.pl@acme.nl', '{"full_name": "Other Client"}'),
  ('00000000-0000-0000-0000-00000000c309', 'dev2.pl@example.in', '{"full_name": "Vikram"}');

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-00000000c3c1', 'KG', 'active'),
  ('00000000-0000-0000-0000-00000000c3c2', 'Acme', 'active');

update public.profiles set role = 'member', modules = array['recruitment', 'academy'] where email = 'hr.pl@nordavo.nl';
update public.profiles set role = 'member', modules = array['sales'] where email = 'sales.pl@nordavo.nl';
update public.profiles set role = 'external' where email like '%.pl@%' and role not in ('member', 'admin');

create or replace function pg_temp.act(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = p_email),
    'role', 'authenticated',
    'email', p_email)::text, false);
end $$;

create or replace function pg_temp.anon() returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', false);
end $$;

create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_what; end if;
end $$;

-- Expect a statement to be refused (any error); p_sql runs as the current role.
create or replace function pg_temp.refused(p_sql text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FAIL: %', p_what;
end $$;

grant execute on function pg_temp.act(text), pg_temp.anon(), pg_temp.check(boolean, text), pg_temp.refused(text, text) to authenticated, anon;

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated, anon;
insert into ctx values ('start', (current_date - 30)::text);

-- ---------------------------------------------------------------------------
-- Holidays: computed Dutch days, Karnataka list, readable in the Academy.
-- ---------------------------------------------------------------------------
select pg_temp.check(public.academy_easter(2026) = '2026-04-05', 'Easter 2026');
select pg_temp.check(public.academy_easter(2027) = '2027-03-28', 'Easter 2027');
select pg_temp.check(public.academy_easter(2028) = '2028-04-16', 'Easter 2028');
select pg_temp.check(public.academy_easter(2025) = '2025-04-20', 'Easter 2025');
select pg_temp.check((select count(*) from public.academy_holidays where country = 'NL' and year = y) = 11, 'eleven Dutch holidays in ' || y)
from generate_series(2026, 2030) y;
select pg_temp.check(exists (select 1 from public.academy_holidays where country = 'NL' and date = '2026-05-14' and name_nl = 'Hemelvaartsdag'), 'Ascension 2026');
select pg_temp.check(exists (select 1 from public.academy_holidays where country = 'NL' and date = '2026-05-25' and name_nl = 'Tweede Pinksterdag'), 'Whit Monday 2026');
select pg_temp.check(exists (select 1 from public.academy_holidays where country = 'NL' and date = '2027-04-27' and name_nl = 'Koningsdag'), 'King''s Day 2027');
select pg_temp.check(not (select day_off from public.academy_holidays where country = 'NL' and date = '2026-04-03'), 'Good Friday is no day off in NL');
select pg_temp.check((select day_off from public.academy_holidays where country = 'NL' and date = '2030-05-05'), 'Liberation Day 2030 is a day off');
select pg_temp.check(not (select day_off from public.academy_holidays where country = 'NL' and date = '2027-05-05'), 'Liberation Day 2027 is not');
select pg_temp.check((select count(*) from public.academy_holidays where country = 'IN' and region = 'KA' and year = y) >= 20, 'Karnataka list ' || y)
from generate_series(2026, 2028) y;
select pg_temp.check((select count(*) from public.academy_holidays where country = 'IN' and date = '2028-04-14') = 2, 'Good Friday and Ambedkar Jayanti on one day in 2028');
select pg_temp.check((select count(*) from public.academy_holidays where country = 'IN' and confirmed = false and year = 2026) >= 15, 'festival days need a check');
select pg_temp.check(public.academy_seed_holidays(2026) = 0, 'seeding again adds nothing');

-- King's Day on a Sunday moves to Saturday (27 April 2025 was a Sunday).
select public.academy_seed_holidays(2025);
select pg_temp.check(exists (select 1 from public.academy_holidays where country = 'NL' and date = '2025-04-26' and name_nl = 'Koningsdag'), 'King''s Day 2025 on the 26th');

-- ---------------------------------------------------------------------------
-- Setup by Nordavo: people, two placements, members.
-- ---------------------------------------------------------------------------
insert into public.candidates (id, full_name, current_title) values
  ('00000000-0000-0000-0000-00000000c3d1', 'Asha', 'Laravel developer'),
  ('00000000-0000-0000-0000-00000000c3d2', 'Ravi', null),
  ('00000000-0000-0000-0000-00000000c3d3', 'Vikram', null);
insert into public.placements (id, client_id, candidate_id, start_date, monthly_rate, hours_per_week, overlap_start, overlap_end, nordavo_contact_id) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c3c1', '00000000-0000-0000-0000-00000000c3d1',
   (select v::date from ctx where k = 'start'), 4200, 40, '09:00', '13:00', '00000000-0000-0000-0000-00000000c301'),
  ('00000000-0000-0000-0000-00000000c392', '00000000-0000-0000-0000-00000000c3c2', '00000000-0000-0000-0000-00000000c3d3',
   (select v::date from ctx where k = 'start'), 3900, 32, '10:00', '12:00', null);

-- The timeline comes with the placement.
select pg_temp.check((select count(*) from public.academy_milestones where placement_id = '00000000-0000-0000-0000-00000000c391') = 4, 'four moments');
select pg_temp.check(
  (select array_agg(due_date - (select v::date from ctx where k = 'start') order by position) from public.academy_milestones
   where placement_id = '00000000-0000-0000-0000-00000000c391') = array[0, 6, 29, 89],
  'moments on day 1, 7, 30 and 90');
update public.placements set start_date = start_date + 2 where id = '00000000-0000-0000-0000-00000000c391';
select pg_temp.check(
  (select due_date from public.academy_milestones where placement_id = '00000000-0000-0000-0000-00000000c391' and kind = 'day_90')
    = (select v::date from ctx where k = 'start') + 91,
  'moments move with the start date');
update public.placements set start_date = start_date - 2 where id = '00000000-0000-0000-0000-00000000c391';

select pg_temp.act('hr.pl@nordavo.nl');
set role authenticated;
select public.academy_add_person('00000000-0000-0000-0000-00000000c303', 'client_admin', null, current_date, '00000000-0000-0000-0000-00000000c3c1',
  null, (select id from public.academy_courses where slug = 'client'), 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c304', 'client_member', null, current_date, '00000000-0000-0000-0000-00000000c3c1',
  null, (select id from public.academy_courses where slug = 'client'), 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c305', 'client_reader', null, null, '00000000-0000-0000-0000-00000000c3c1');
select public.academy_add_person('00000000-0000-0000-0000-00000000c308', 'client_admin', null, current_date, '00000000-0000-0000-0000-00000000c3c2',
  null, (select id from public.academy_courses where slug = 'client'), 'all', '{}');
select public.academy_add_person('00000000-0000-0000-0000-00000000c306', 'developer', null, current_date, null,
  '00000000-0000-0000-0000-00000000c3d1', (select id from public.academy_courses where slug = 'developer'), 'all', '{}', 'Asia/Kolkata');
select public.academy_add_person('00000000-0000-0000-0000-00000000c309', 'developer', null, current_date, null,
  '00000000-0000-0000-0000-00000000c3d3', (select id from public.academy_courses where slug = 'developer'), 'all', '{}', 'Asia/Kolkata');
select public.academy_add_person('00000000-0000-0000-0000-00000000c307', 'candidate', null, null, null,
  '00000000-0000-0000-0000-00000000c3d2', (select id from public.academy_courses where slug = 'developer'), 'default', '{}');

-- Only the client's own people and one developer.
select pg_temp.refused($$insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c308', 'client_admin')$$, 'a contact of another client was added');
select pg_temp.refused($$insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c307', 'developer')$$, 'a candidate became the developer');
select pg_temp.refused($$insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c303', 'developer')$$, 'a client became the developer');
insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c303', 'client_admin'),
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c304', 'client_member'),
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c305', 'client_reader'),
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c306', 'developer'),
  ('00000000-0000-0000-0000-00000000c392', '00000000-0000-0000-0000-00000000c308', 'client_admin'),
  ('00000000-0000-0000-0000-00000000c392', '00000000-0000-0000-0000-00000000c309', 'developer');
select pg_temp.refused($$insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c309', 'developer')$$, 'a second developer was added');

-- The rituals of the client course came along with the members.
select pg_temp.check((select count(*) from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c391') = 4, 'four rituals copied');
select pg_temp.check((select count(*) from public.academy_rituals where placement_id is null and course_id = (select id from public.academy_courses where slug = 'client')) = 4, 'four templates');

-- A global GDPR document and a placement document of KG.
insert into public.academy_documents (id, title, scope, placement_id, category, current_version) values
  ('00000000-0000-0000-0000-00000000c3a1', 'GDPR', 'global', null, 'gdpr', 1),
  ('00000000-0000-0000-0000-00000000c3a2', 'Contract summary KG', 'placement', '00000000-0000-0000-0000-00000000c391', 'contract_summary', 1),
  ('00000000-0000-0000-0000-00000000c3a3', 'Lesson template', 'global', null, 'template', 1);
insert into public.academy_document_versions (document_id, version, storage_path, file_name) values
  ('00000000-0000-0000-0000-00000000c3a1', 1, 'academy/document/00000000-0000-0000-0000-00000000c3a1/gdpr.pdf', 'gdpr.pdf');
reset role;
insert into storage.objects (bucket_id, name) values
  ('attachments', 'academy/document/00000000-0000-0000-0000-00000000c3a1/gdpr.pdf'),
  ('attachments', 'academy/document/00000000-0000-0000-0000-00000000c3a3/template.pdf');

-- Template change: copies follow until adjusted per placement.
select pg_temp.act('hr.pl@nordavo.nl');
set role authenticated;
update public.academy_rituals set title = 'Daily stand-up'
where placement_id is null and title = 'Daily check-in';
select pg_temp.check((select count(*) from public.academy_rituals where title = 'Daily stand-up' and placement_id is not null) = 2, 'copies follow the template');
update public.academy_rituals set weekday = 2
where placement_id = '00000000-0000-0000-0000-00000000c392' and title = 'Weekly plan';
select pg_temp.check((select customized from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c392' and title = 'Weekly plan'), 'adjusted copy is customized');
update public.academy_rituals set description = 'Monday!' where placement_id is null and title = 'Weekly plan';
select pg_temp.check((select weekday = 2 and description <> 'Monday!' from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c392' and title = 'Weekly plan'), 'customized copy keeps its own');
update public.academy_rituals set customized = false where placement_id = '00000000-0000-0000-0000-00000000c392' and title = 'Weekly plan';
select pg_temp.check((select weekday = 1 and description = 'Monday!' from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c392' and title = 'Weekly plan'), 'reset to the template');
update public.academy_rituals set title = 'Daily check-in' where placement_id is null and title = 'Daily stand-up';
reset role;
insert into ctx select 'acme_week_1', id::text from public.academy_milestones
where placement_id = '00000000-0000-0000-0000-00000000c392' and kind = 'week_1';
insert into ctx select 'acme_ritual', id::text from public.academy_rituals
where placement_id = '00000000-0000-0000-0000-00000000c392' and cadence = 'daily';

-- ---------------------------------------------------------------------------
-- Client admin: own placement without money, sees both sides, never pulse.
-- ---------------------------------------------------------------------------
select pg_temp.act('boss.pl@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.placements) = 0, 'client reads no placements table');
select pg_temp.check((select my_role from public.academy_placement_view('00000000-0000-0000-0000-00000000c391')) = 'client_admin', 'client admin sees the placement');
select pg_temp.check((select nordavo_response_hours from public.academy_placement_view('00000000-0000-0000-0000-00000000c391')) = 4, 'response time');
select pg_temp.check((select developer_name from public.academy_placement_view('00000000-0000-0000-0000-00000000c391')) = 'Asha', 'developer name');
select pg_temp.check(
  not exists (
    select 1 from public.academy_placement_view('00000000-0000-0000-0000-00000000c391') p, jsonb_object_keys(to_jsonb(p)) k
    where k ~ '(rate|salary|cost|compensation|price|fee|inr|eur)'
  ),
  'no money column in academy_placement_view()');
select pg_temp.check((select count(*) from public.academy_placement_view('00000000-0000-0000-0000-00000000c392')) = 0, 'client does not see another placement');
select pg_temp.check((select count(*) from public.academy_milestones) = 4, 'client sees only own moments');
select pg_temp.check((select count(*) from public.academy_rituals where placement_id is not null) = 4, 'client sees only own rituals');
select pg_temp.check((select count(*) from public.academy_documents where id in ('00000000-0000-0000-0000-00000000c3a1', '00000000-0000-0000-0000-00000000c3a2')) = 2, 'client sees global and own placement documents');
select pg_temp.check((select count(*) from public.academy_documents where id = '00000000-0000-0000-0000-00000000c3a3') = 0, 'client does not see a lesson template');
select pg_temp.check((select count(*) from public.academy_document_versions) = 1, 'client sees the GDPR version');
select pg_temp.check((select count(*) from storage.objects where name like 'academy/document/%') = 1, 'client may download the GDPR file only');
select pg_temp.check((select count(*) from public.academy_holidays) > 100, 'client reads holidays');
-- Clients never add members or change the placement facts.
select pg_temp.refused($$insert into public.academy_placement_members (placement_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c308', 'client_member')$$, 'client added a member');
update public.academy_milestones set due_date = current_date where placement_id = '00000000-0000-0000-0000-00000000c391';
reset role;
select pg_temp.check((select count(*) from public.academy_milestones where placement_id = '00000000-0000-0000-0000-00000000c391' and due_date = current_date and kind <> 'day_1') = 0, 'client cannot move moments');

-- ---------------------------------------------------------------------------
-- Rituals: one click, the right side, the right period.
-- ---------------------------------------------------------------------------
select pg_temp.act('dev.pl@example.in');
set role authenticated;
select pg_temp.check(public.academy_tick_ritual(
  (select id from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c391' and cadence = 'daily'),
  (now() at time zone 'Asia/Kolkata')::date), 'developer ticks the daily check-in');
select pg_temp.refused($$select public.academy_tick_ritual(
  (select id from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c391' and cadence = 'daily'),
  (now() at time zone 'Asia/Kolkata')::date + 1)$$, 'ticked a future day');
select pg_temp.refused($$select public.academy_tick_ritual(
  (select id from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c391' and cadence = 'daily'),
  (now() at time zone 'Asia/Kolkata')::date - 30)$$, 'ticked a month ago');
select pg_temp.refused($$select public.academy_tick_ritual(
  (select id from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c391' and cadence = 'weekly' and weekday = 1),
  (now() at time zone 'Asia/Kolkata')::date - (extract(isodow from (now() at time zone 'Asia/Kolkata')::date)::integer - 1) + 1)$$,
  'ticked a weekly ritual on a day that is no Monday');
select pg_temp.refused($$select public.academy_tick_ritual(
  (select v::uuid from ctx where k = 'acme_ritual'),
  (now() at time zone 'Asia/Kolkata')::date)$$, 'developer ticked a ritual of another placement');
select pg_temp.refused($$insert into public.academy_ritual_logs (ritual_id, placement_id, profile_id, period_date)
  values ((select v::uuid from ctx where k = 'acme_ritual'), '00000000-0000-0000-0000-00000000c392', '00000000-0000-0000-0000-00000000c306', current_date)$$,
  'developer logged in another placement');
reset role;

select pg_temp.act('lid.pl@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_ritual_logs) = 1, 'the client side sees the tick of the developer');
reset role;

select pg_temp.act('board.pl@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_ritual_logs) = 1, 'reader sees the rituals');
select pg_temp.refused($$select public.academy_tick_ritual(
  (select id from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c391' and cadence = 'monthly'),
  date_trunc('month', current_date)::date)$$, 'reader ticked a ritual');
select pg_temp.refused($$select public.academy_tick_ritual(
  (select id from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c391' and cadence = 'daily'),
  (now() at time zone 'Asia/Kolkata')::date, false)$$, 'reader unticked a ritual');
reset role;
select pg_temp.check((select count(*) from public.academy_ritual_logs) = 1, 'the tick is still there');

select pg_temp.act('other.pl@acme.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_ritual_logs) = 0, 'other client sees no KG rituals');
select pg_temp.check((select count(*) from public.academy_rituals where placement_id = '00000000-0000-0000-0000-00000000c391') = 0, 'other client sees no KG ritual list');
reset role;

-- Reminders: Monday 14 January 2030, 16:30 UTC (17:30 Amsterdam, 22:00
-- Kolkata). Due: the weekly plan and the daily check-in, for the two
-- client contacts and the developer of each placement (not the reader).
insert into public.academy_ritual_logs (ritual_id, placement_id, period_date)
select id, placement_id, '2030-01-14' from public.academy_rituals
where placement_id = '00000000-0000-0000-0000-00000000c391' and cadence = 'daily';
select pg_temp.check(public.academy_send_ritual_reminders('2030-01-14 16:30:00+00') = 3 + 4,
  'reminders: KG weekly plan for three people, Acme plan and check-in for two');
select pg_temp.check(public.academy_send_ritual_reminders('2030-01-14 17:30:00+00') = 0, 'one reminder per period');
select pg_temp.check(not exists (select 1 from public.academy_ritual_reminders where profile_id = '00000000-0000-0000-0000-00000000c305'), 'the reader gets no reminders');
select pg_temp.check(
  (select count(*) from public.academy_notifications where kind = 'ritual_reminder' and profile_id = '00000000-0000-0000-0000-00000000c303' and title like 'Nog niet afgevinkt:%') = 1,
  'the client gets a Dutch reminder');
-- 10:00 UTC is 11:00 in Amsterdam (too early) but 15:30 in Kolkata (too early as well).
select pg_temp.check(public.academy_send_ritual_reminders('2030-01-15 10:00:00+00') = 0, 'not before 16:00 local time');
-- 11:00 UTC: 16:30 in Kolkata, 12:00 in Amsterdam: only the developers.
select pg_temp.check(public.academy_send_ritual_reminders('2030-01-15 11:00:00+00') = 2, 'the developers in their own time zone');
-- No reminder on a day off: Christmas 2030 is a Wednesday, in both countries.
select pg_temp.check(public.academy_send_ritual_reminders('2030-12-25 17:00:00+00') = 0, 'no reminders on a holiday');

-- ---------------------------------------------------------------------------
-- Leave: the developer asks, Nordavo decides, all three see it.
-- ---------------------------------------------------------------------------
select pg_temp.act('dev.pl@example.in');
set role authenticated;
insert into public.academy_leave_requests (id, placement_id, profile_id, start_date, end_date, days, note) values
  ('00000000-0000-0000-0000-00000000c3e1', '00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c306', current_date + 20, current_date + 24, 5, 'Family wedding'),
  ('00000000-0000-0000-0000-00000000c3e2', '00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c306', current_date + 40, current_date + 40, 1, null);
select pg_temp.refused($$insert into public.academy_leave_requests (placement_id, profile_id, start_date, end_date, status) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c306', current_date, current_date, 'approved')$$, 'developer approved own leave');
update public.academy_leave_requests set status = 'approved' where id = '00000000-0000-0000-0000-00000000c3e1';
select pg_temp.check((select status from public.academy_leave_requests where id = '00000000-0000-0000-0000-00000000c3e1') = 'requested', 'developer cannot approve by update');
select pg_temp.check(public.academy_cancel_leave('00000000-0000-0000-0000-00000000c3e2'), 'developer cancels an open request');
reset role;
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'leave_requested' and profile_id = '00000000-0000-0000-0000-00000000c301') = 2, 'Nordavo contact hears of both requests');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'leave_requested' and profile_id = '00000000-0000-0000-0000-00000000c303') = 2, 'client admin hears of both requests');

select pg_temp.act('boss.pl@kg.nl');
set role authenticated;
update public.academy_leave_requests set status = 'approved' where id = '00000000-0000-0000-0000-00000000c3e1';
select pg_temp.check(not public.academy_cancel_leave('00000000-0000-0000-0000-00000000c3e1'), 'client cannot cancel the developer''s leave');
reset role;
select pg_temp.check((select status from public.academy_leave_requests where id = '00000000-0000-0000-0000-00000000c3e1') = 'requested', 'client cannot decide on leave');

select pg_temp.act('hr.pl@nordavo.nl');
set role authenticated;
update public.academy_leave_requests set status = 'client_agreed' where id = '00000000-0000-0000-0000-00000000c3e1';
update public.academy_leave_requests set status = 'approved', decision_note = 'Enjoy' where id = '00000000-0000-0000-0000-00000000c3e1';
insert into public.academy_leave_balances (placement_id, profile_id, year, entitled_days, carried_over_days)
values ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c306', extract(year from current_date)::integer, 24, 2);
reset role;
select pg_temp.check((select decided_by from public.academy_leave_requests where id = '00000000-0000-0000-0000-00000000c3e1') = '00000000-0000-0000-0000-00000000c301', 'decision stamped');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'leave_approved') = 3, 'approval to developer and both client contacts');

select pg_temp.act('dev.pl@example.in');
set role authenticated;
select pg_temp.check(not public.academy_cancel_leave('00000000-0000-0000-0000-00000000c3e1'), 'approved leave cannot be cancelled by the developer');
select pg_temp.refused($$insert into public.academy_leave_balances (placement_id, profile_id, year, entitled_days) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c306', 2099, 99)$$, 'developer set a balance');
reset role;
select pg_temp.check(not exists (select 1 from public.academy_leave_balances where year = 2099), 'developer cannot set a balance');

select pg_temp.act('board.pl@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_leave_requests) = 2, 'reader sees the leave');
select pg_temp.check((select entitled_days from public.academy_leave_balances) = 24, 'reader sees the balance');
select pg_temp.refused($$insert into public.academy_leave_requests (placement_id, profile_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c305', current_date, current_date)$$, 'reader asked for leave');
reset role;

select pg_temp.act('other.pl@acme.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_leave_requests) = 0, 'other client sees no KG leave');
select pg_temp.check((select count(*) from public.academy_leave_balances) = 0, 'other client sees no KG balance');
select pg_temp.check((select count(*) from public.academy_documents where id = '00000000-0000-0000-0000-00000000c3a2') = 0, 'other client sees no KG document');
select pg_temp.check((select count(*) from public.academy_documents where id = '00000000-0000-0000-0000-00000000c3a1') = 1, 'other client sees the global GDPR document');
reset role;

-- ---------------------------------------------------------------------------
-- Reviews: client and developer fill in, Nordavo writes the report.
-- ---------------------------------------------------------------------------
select pg_temp.act('boss.pl@kg.nl');
set role authenticated;
insert into public.academy_reviews (id, milestone_id, placement_id, author_id, answers, status) values
  ('00000000-0000-0000-0000-00000000c3f1',
   (select id from public.academy_milestones where placement_id = '00000000-0000-0000-0000-00000000c391' and kind = 'week_1'),
   '00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c303', '{"rating": 4, "going_well": "Fast start"}', 'draft');
update public.academy_reviews set status = 'submitted' where id = '00000000-0000-0000-0000-00000000c3f1';
select pg_temp.check((select submitted_at is not null from public.academy_reviews where id = '00000000-0000-0000-0000-00000000c3f1'), 'submitted_at stamped');
update public.academy_reviews set answers = '{"rating": 1}' where id = '00000000-0000-0000-0000-00000000c3f1';
select pg_temp.check((select answers ->> 'rating' from public.academy_reviews where id = '00000000-0000-0000-0000-00000000c3f1') = '4', 'a submitted form is final');
select pg_temp.refused($$insert into public.academy_reviews (milestone_id, placement_id, author_id, kind, report, status) values
  ((select id from public.academy_milestones where placement_id = '00000000-0000-0000-0000-00000000c391' and kind = 'week_1'),
   '00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c303', 'report', 'My report', 'submitted')$$, 'client wrote the report');
select pg_temp.refused($$insert into public.academy_reviews (milestone_id, placement_id, author_id, status) values
  ((select v::uuid from ctx where k = 'acme_week_1'),
   '00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c303', 'draft')$$, 'review on a moment of another placement');
reset role;
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'review_submitted' and profile_id = '00000000-0000-0000-0000-00000000c301') = 1, 'Nordavo hears of the form');

select pg_temp.act('dev.pl@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_reviews) = 1, 'developer reads the submitted form of the client');
reset role;

select pg_temp.act('board.pl@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_reviews) = 0, 'reader reads no reviews');
select pg_temp.check((select count(*) from public.academy_milestones) = 4, 'reader sees the timeline');
select pg_temp.refused($$insert into public.academy_reviews (milestone_id, placement_id, author_id, status) values
  ((select id from public.academy_milestones where placement_id = '00000000-0000-0000-0000-00000000c391' and kind = 'week_1'),
   '00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c305', 'draft')$$, 'reader wrote a review');
reset role;

select pg_temp.act('hr.pl@nordavo.nl');
set role authenticated;
insert into public.academy_reviews (milestone_id, placement_id, author_id, kind, report, status) values
  ((select id from public.academy_milestones where placement_id = '00000000-0000-0000-0000-00000000c391' and kind = 'week_1'),
   '00000000-0000-0000-0000-00000000c391', '00000000-0000-0000-0000-00000000c301', 'report', 'A good first week.', 'submitted');
reset role;
select pg_temp.check((select completed_at is not null from public.academy_milestones where placement_id = '00000000-0000-0000-0000-00000000c391' and kind = 'week_1'), 'report completes the moment');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'review_report') = 3, 'report to both client contacts and the developer');

-- ---------------------------------------------------------------------------
-- Pulse: rounds every two weeks, signals on low or dropping scores, only
-- Nordavo sees the scores.
-- ---------------------------------------------------------------------------
select pg_temp.check((public.academy_open_pulse_rounds((select v::date from ctx where k = 'start') + 13) ->> 'opened')::integer = 0, 'no pulse before day 14');
select pg_temp.check((public.academy_open_pulse_rounds((select v::date from ctx where k = 'start') + 14) ->> 'opened')::integer = 5, 'pulse for 3 KG and 2 Acme people');
select pg_temp.check((public.academy_open_pulse_rounds((select v::date from ctx where k = 'start') + 20) ->> 'opened')::integer = 0, 'one pulse per round');
select pg_temp.check(not exists (select 1 from public.academy_pulses where profile_id = '00000000-0000-0000-0000-00000000c305'), 'readers get no pulse');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'pulse_open') = 5, 'pulse notifications');
update public.academy_pulses set sent_at = now() - interval '4 days';
select pg_temp.check((public.academy_open_pulse_rounds((select v::date from ctx where k = 'start') + 20) ->> 'reminded')::integer = 5, 'reminder after three days');
select pg_temp.check((public.academy_open_pulse_rounds((select v::date from ctx where k = 'start') + 21) ->> 'reminded')::integer = 0, 'one reminder');
select pg_temp.check((public.academy_open_pulse_rounds((select v::date from ctx where k = 'start') + 30) ->> 'reviews')::integer = 2, 'review form due for 30 days in both placements');

select pg_temp.act('dev.pl@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_pulses) = 2, 'developer sees own two pulses');
insert into public.academy_pulse_answers (pulse_id, score, going_well, friction)
select id, 8, 'Good team', null from public.academy_pulses where period_start = (select v::date from ctx where k = 'start') + 14;
reset role;
select public.academy_open_pulse_rounds((select v::date from ctx where k = 'start') + 28);
select pg_temp.act('dev.pl@example.in');
set role authenticated;
insert into public.academy_pulse_answers (pulse_id, score, friction)
select id, 6, 'Too many meetings' from public.academy_pulses where period_start = (select v::date from ctx where k = 'start') + 28;
select pg_temp.refused($$insert into public.academy_pulse_answers (pulse_id, score)
  select id, 9 from public.academy_pulses where period_start = (select v::date from ctx where k = 'start') + 28$$, 'answered twice');
select pg_temp.refused($$insert into public.academy_pulse_answers (pulse_id, score, flagged)
  select id, 9, true from public.academy_pulses where profile_id = '00000000-0000-0000-0000-00000000c306' limit 1$$, 'developer set the flag');
reset role;
select pg_temp.check((select flag_reason from public.academy_pulse_answers a join public.academy_pulses p on p.id = a.pulse_id
  where p.profile_id = '00000000-0000-0000-0000-00000000c306' and a.score = 6) = 'drop', 'drop from 8 to 6 is a signal');
select pg_temp.check((select not flagged from public.academy_pulse_answers a join public.academy_pulses p on p.id = a.pulse_id
  where p.profile_id = '00000000-0000-0000-0000-00000000c306' and a.score = 8), 'a first 8 is fine');
select pg_temp.check((select count(*) from public.academy_pulses where answered_at is not null) = 2, 'answered_at set');

select pg_temp.act('boss.pl@kg.nl');
set role authenticated;
insert into public.academy_pulse_answers (pulse_id, score, friction)
select id, 4, 'Communication' from public.academy_pulses where period_start = (select v::date from ctx where k = 'start') + 14;
select pg_temp.check((select count(*) from public.academy_pulse_answers) = 1, 'client reads only own answer');
select pg_temp.check((select count(*) from public.academy_pulses) = 2, 'client sees only own pulses');
select pg_temp.check(not exists (select 1 from public.academy_pulse_answers a join public.academy_pulses p on p.id = a.pulse_id
  where p.profile_id = '00000000-0000-0000-0000-00000000c306'), 'client never sees the developer''s score');
reset role;
select pg_temp.check((select flag_reason from public.academy_pulse_answers a join public.academy_pulses p on p.id = a.pulse_id
  where p.profile_id = '00000000-0000-0000-0000-00000000c303') = 'low', 'a 4 is low');
select pg_temp.check((select count(*) from public.academy_notifications where kind = 'pulse_signal' and profile_id = '00000000-0000-0000-0000-00000000c301') = 2, 'two signals for the Nordavo contact');
-- Acme has no Nordavo contact: the signal goes to every Academy manager.
select pg_temp.act('dev2.pl@example.in');
set role authenticated;
insert into public.academy_pulse_answers (pulse_id, score)
select id, 3 from public.academy_pulses where period_start = (select v::date from ctx where k = 'start') + 14;
reset role;
select pg_temp.check(
  (select count(*) from public.academy_notifications where kind = 'pulse_signal' and payload ->> 'placement_id' = '00000000-0000-0000-0000-00000000c392')
    = (select count(*) from public.profiles where public.has_module_for(id, 'academy')),
  'without a contact every Academy manager gets the signal');
select pg_temp.check(not exists (select 1 from public.academy_notifications where kind = 'pulse_signal' and profile_id = '00000000-0000-0000-0000-00000000c302'), 'sales gets no pulse signal');

select pg_temp.act('board.pl@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_pulse_answers) = 0, 'reader sees no pulse scores');
select pg_temp.check((select count(*) from public.academy_pulses) = 0, 'reader sees no pulses');
reset role;

select pg_temp.act('hr.pl@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_pulse_answers) = 4, 'Nordavo sees every score');
update public.academy_pulse_answers set handled_at = now(), handled_by = '00000000-0000-0000-0000-00000000c301', handled_note = 'Called the client'
where flagged and handled_at is null and pulse_id in (select id from public.academy_pulses where placement_id = '00000000-0000-0000-0000-00000000c391');
select pg_temp.check((select count(*) from public.academy_pulse_answers where flagged and handled_at is null) = 1, 'Nordavo follows up on signals');
reset role;

select pg_temp.act('sales.pl@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_pulse_answers) = 0, 'team without academy sees no pulse');
select pg_temp.check((select count(*) from public.academy_placement_view('00000000-0000-0000-0000-00000000c391')) = 0, 'team without academy sees no placement view');
reset role;

-- ---------------------------------------------------------------------------
-- Candidate: nothing of placements.
-- ---------------------------------------------------------------------------
select pg_temp.act('cand.pl@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.academy_placement_view('00000000-0000-0000-0000-00000000c391')) = 0, 'candidate sees no placement');
select pg_temp.check((select count(*) from public.academy_milestones) = 0, 'candidate sees no moments');
select pg_temp.check((select count(*) from public.academy_rituals where placement_id is not null) = 0, 'candidate sees no placement rituals');
select pg_temp.check((select count(*) from public.academy_documents where category = 'gdpr') = 0, 'candidate sees no placement documents');
select pg_temp.check(public.academy_calendar_token('00000000-0000-0000-0000-00000000c391') is null, 'candidate gets no calendar link');
reset role;

-- ---------------------------------------------------------------------------
-- Calendar feed: the token is the key, no session needed.
-- ---------------------------------------------------------------------------
select pg_temp.act('dev.pl@example.in');
set role authenticated;
insert into ctx values ('token', public.academy_calendar_token('00000000-0000-0000-0000-00000000c391'));
select pg_temp.check(char_length((select v from ctx where k = 'token')) = 64, 'a long token');
select pg_temp.check(public.academy_calendar_token('00000000-0000-0000-0000-00000000c391') = (select v from ctx where k = 'token'), 'the same token again');
select pg_temp.check(public.academy_calendar_token('00000000-0000-0000-0000-00000000c392') is null, 'no token for another placement');
select pg_temp.refused($$select public.academy_rotate_calendar_token('00000000-0000-0000-0000-00000000c391')$$, 'developer rotated the token');
reset role;

select pg_temp.anon();
set role anon;
select pg_temp.check((select count(*) from public.academy_calendar_feed((select v from ctx where k = 'token')) where category like 'holiday_%') > 50, 'feed has holidays');
select pg_temp.check((select count(*) from public.academy_calendar_feed((select v from ctx where k = 'token')) where category = 'milestone') = 4, 'feed has the moments');
select pg_temp.check((select count(*) from public.academy_calendar_feed((select v from ctx where k = 'token')) where category = 'leave') = 1, 'feed has approved leave only');
select pg_temp.check(not exists (
  select 1 from public.academy_calendar_feed((select v from ctx where k = 'token')) f
  where f.title_en ilike '%wedding%' or f.title_en ~ '[0-9]{4,}'), 'feed has no notes or amounts');
select pg_temp.check((select count(*) from public.academy_calendar_feed('wrong-token-wrong-token-wrong-token-1234')) = 0, 'wrong token, nothing');
select pg_temp.check((select count(*) from public.academy_calendar_feed('')) = 0, 'empty token, nothing');
select pg_temp.check((select count(*) from public.academy_holidays) = 0, 'anon reads no holidays table');
select pg_temp.check((select count(*) from public.academy_placement_calendars) = 0, 'anon reads no tokens');
reset role;

select pg_temp.act('hr.pl@nordavo.nl');
set role authenticated;
select pg_temp.check(public.academy_rotate_calendar_token('00000000-0000-0000-0000-00000000c391') <> (select v from ctx where k = 'token'), 'Nordavo rotates the token');
reset role;
select pg_temp.check((select count(*) from public.academy_calendar_feed((select v from ctx where k = 'token'))) = 0, 'the old link stops working');

rollback;
