-- Choice lists of the sales CRM, set up by the team (feedback Julius,
-- 3f93bd66 "prio en keuzelijsten zelf inrichten, met reden per prio").
--
-- public.sales_choice_options holds, per list, the labels, explanation,
-- order and hidden flag of the options, plus extra options where that is
-- safe. The app merges it with the built in options (src/lib/sales/choices.ts):
--
--   list            built in values           extra options
--   prio            1 to 5                    yes, levels 6 to 20 (a number)
--   category        development, data_bi, both yes, any short value
--   lead_status     the 8 statuses             no: the rules use them
--   contact_status  the 9 statuses             no: the rules use them
--   call_outcome    the 8 call screen buttons  no: sales_log_call applies them
--
-- Built in values can be renamed, explained, reordered and hidden, never
-- deleted (a hidden value keeps its label on rows that have it). Extra
-- options can also be deleted; rows that have one keep the value.
-- The reason per company for its prio is companies.prio_reason
-- (20261123400000_sales_triage_occupancy.sql).

create table if not exists public.sales_choice_options (
  list_key text not null check (list_key in ('prio', 'category', 'lead_status', 'contact_status', 'call_outcome')),
  value text not null check (value ~ '^[a-z0-9_]{1,40}$'),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  description text check (char_length(description) <= 300),
  position integer not null default 0,
  hidden boolean not null default false,
  builtin boolean not null default false,
  tone text check (tone in ('neutral', 'brand', 'accent', 'success', 'warning', 'danger')),
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (list_key, value)
);

comment on table public.sales_choice_options is 'Labels, explanation, order and extra options of the sales choice lists (docs/sales.md, Keuzelijsten).';

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
    if new.list_key not in ('prio', 'category') then
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

drop trigger if exists sales_choice_options_guard on public.sales_choice_options;
create trigger sales_choice_options_guard before insert or update or delete on public.sales_choice_options
  for each row execute function public.sales_choice_options_guard();

alter table public.sales_choice_options enable row level security;

drop policy if exists "Sales read choice lists" on public.sales_choice_options;
create policy "Sales read choice lists" on public.sales_choice_options
  for select to authenticated using (public.has_module('sales'));
drop policy if exists "Admins set up choice lists" on public.sales_choice_options;
create policy "Admins set up choice lists" on public.sales_choice_options
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.sales_choice_options to authenticated;
grant select on public.sales_choice_options to gtm_readonly;

-- Prio may have up to 20 levels; the app offers the configured ones.
alter table public.companies drop constraint if exists companies_prio_check;
alter table public.companies add constraint companies_prio_check check (prio between 1 and 20);

-- Category: the built in values or an extra option from the list. Checked on
-- change only, so deleting an extra option never blocks other edits.
alter table public.companies drop constraint if exists companies_category_check;
alter table public.companies drop constraint if exists companies_category_format;
alter table public.companies add constraint companies_category_format check (category ~ '^[a-z0-9_]{1,40}$');

create or replace function public.companies_check_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category is null or (tg_op = 'UPDATE' and new.category is not distinct from old.category) then
    return new;
  end if;
  if public.sales_choice_builtin('category', new.category) then
    return new;
  end if;
  if not exists (select 1 from public.sales_choice_options where list_key = 'category' and value = new.category) then
    raise exception 'Unknown category "%"', new.category using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.companies_check_category() from public, anon, authenticated;

drop trigger if exists companies_check_category on public.companies;
create trigger companies_check_category before insert or update of category on public.companies
  for each row execute function public.companies_check_category();
