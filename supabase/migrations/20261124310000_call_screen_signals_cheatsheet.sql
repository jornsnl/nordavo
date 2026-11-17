-- Call screen: a place for signals and a cheat sheet (feedback Julius,
-- 306c7214 "vaste plek voor signalen" and 21637c48 "spiekbrief").
--
-- 1. Signals. public.signals already holds one row per signal with a type,
--    a date (posted_at, else first_seen_at), a title and a source; it only
--    refused kinds outside a fixed list. Now:
--      * the type is any lower case word (a-z, 0-9, _), so a new kind needs
--        no migration;
--      * the kinds, their names, explanation and strength (their order) are
--        the choice list "Signal types" under Settings, Sales lists
--        (sales_choice_options, list_key signal_type). Built in:
--        funding, nieuwe_cto, employee_growth, meerdere_rollen, lang_open,
--        vacature, remote_extern, freelance, overig. New kinds are extra
--        options of that list, like extra prio levels.
--    employee_growth is new: rows of that type say the number of employees
--    grows (title: for example "21-50 to 51-100", posted_at: the date).
--
-- 2. Cheat sheet. public.sales_call_cheatsheet holds the sections of the
--    foldable cheat sheet on the call screen (key, title, text, order,
--    hidden). The app has placeholder text for the built in sections until
--    an admin saves their own under Settings, Sales lists. Everyone with
--    Sales reads it; only admins write. External callers read it through the
--    server (secret key), like the rest of the call screen.

-- ---------------------------------------------------------------------------
-- 1. Signals
-- ---------------------------------------------------------------------------

alter table public.signals drop constraint if exists signals_type_check;
alter table public.signals drop constraint if exists signals_type_format;
alter table public.signals add constraint signals_type_format check (type ~ '^[a-z0-9_]{1,40}$');

alter table public.sales_choice_options drop constraint if exists sales_choice_options_list_key_check;
alter table public.sales_choice_options add constraint sales_choice_options_list_key_check
  check (list_key in ('prio', 'category', 'lead_status', 'contact_status', 'call_outcome', 'reject_reason', 'signal_type'));

create or replace function public.sales_choice_builtin(p_list text, p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_list
    when 'prio' then p_value in ('1', '2', '3', '4', '5')
    when 'category' then p_value in ('development', 'data_bi', 'both')
    when 'lead_status' then p_value in ('new', 'review', 'ready', 'enrich', 'in_sequence', 'cooled_down', 'no_go', 'do_not_contact')
    when 'contact_status' then p_value in ('new', 'qualified', 'enrich', 'enriched', 'in_outreach', 'reached', 'not_reached', 'not_interested', 'do_not_contact')
    when 'call_outcome' then p_value in ('no_answer', 'call_back', 'reached_interested', 'meeting_planned', 'reached_not_interested', 'referred', 'wrong_person', 'wrong_number')
    when 'reject_reason' then p_value in ('no_vacancies', 'has_agency', 'offshore_no', 'too_small', 'too_expensive', 'no_time', 'bad_experience', 'wrong_moment')
    when 'signal_type' then p_value in ('funding', 'nieuwe_cto', 'employee_growth', 'meerdere_rollen', 'lang_open', 'vacature', 'remote_extern', 'freelance', 'overig')
    else false
  end;
$$;

create or replace function public.sales_choice_options_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.builtin then
      raise exception 'A built in option cannot be deleted. Hide it instead.' using errcode = '22023';
    end if;
    return old;
  end if;
  new.label := btrim(new.label);
  new.description := nullif(btrim(new.description), '');
  new.builtin := public.sales_choice_builtin(new.list_key, new.value);
  if not new.builtin then
    if new.list_key not in ('prio', 'category', 'reject_reason', 'signal_type') then
      raise exception 'This list has fixed options: rename, explain, reorder or hide them' using errcode = '22023';
    end if;
    if new.list_key = 'prio' and (new.value !~ '^[0-9]{1,2}$' or new.value::integer not between 1 and 20) then
      raise exception 'A prio level is a number from 1 to 20' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Cheat sheet
-- ---------------------------------------------------------------------------

create table if not exists public.sales_call_cheatsheet (
  key text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(body) <= 4000),
  position integer not null default 0,
  hidden boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table public.sales_call_cheatsheet is 'Sections of the cheat sheet on the call screen; edited under Settings, Sales lists (docs/calls.md).';

create or replace function public.sales_call_cheatsheet_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

drop trigger if exists sales_call_cheatsheet_touch on public.sales_call_cheatsheet;
create trigger sales_call_cheatsheet_touch before insert or update on public.sales_call_cheatsheet
  for each row execute function public.sales_call_cheatsheet_touch();

alter table public.sales_call_cheatsheet enable row level security;

drop policy if exists "Sales read call cheat sheet" on public.sales_call_cheatsheet;
create policy "Sales read call cheat sheet" on public.sales_call_cheatsheet
  for select to authenticated using ((select public.has_module('sales')));
drop policy if exists "Admins write call cheat sheet" on public.sales_call_cheatsheet;
create policy "Admins write call cheat sheet" on public.sales_call_cheatsheet
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.sales_call_cheatsheet to authenticated;
