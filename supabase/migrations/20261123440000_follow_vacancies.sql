-- Follow companies and hear about their new dev and data vacancies (feedback
-- Julius, 9eb8d313 "Melding bij nieuwe dev/data vacature van gevolgde
-- bedrijven").
--
--   * companies.followed_at / followed_by: the follow toggle on the lead page
--     and in the tables (sales_update_more with field "followed");
--   * a new signal (vacancy) for a followed company whose title is a dev or
--     data role (sales_is_dev_data_title) gives, once per signal:
--       - a system row in the timeline of the company, and
--       - a Work task "New vacancy at ..." for the owner of the company (or
--         whoever followed it), linked to the lead, due today. That is the
--         in-app notification: it shows in the Work inbox and on the lead.
--     Creating the task never blocks the signal: if it fails the timeline
--     row is still there.
--   * Claude reads the followed companies with the MCP tool
--     list_followed_companies and can check them on a schedule
--     (docs/claude-jobs.md, claude-followed).

alter table public.companies
  add column if not exists followed_at timestamptz,
  add column if not exists followed_by uuid references public.profiles (id) on delete set null;

create index if not exists companies_followed_idx on public.companies (followed_at) where followed_at is not null;

-- Dev and data roles, in Dutch and English. Mirrored in src/lib/sales/follow.ts.
create or replace function public.sales_is_dev_data_title(p_title text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_title, '') ~* (
    '(develop|ontwikkel|engineer|programm|software|\mcoder\M|devops|\msre\M|front[ -]?end|back[ -]?end|full[ -]?stack'
    || '|\mjava\M|\.net|\mc#|python|\mphp\M|golang|\mgo\M developer|kotlin|swift|\mios\M|android|react|angular|\mvue|node'
    || '|typescript|javascript|\mcloud\M|architect|\mtester\M|\mtest ?automation|\mqa\M|\mdata\M|\mbi\M|business intelligence'
    || '|analist|analyst|scientist|machine learning|\mml\M|\mai\M|power ?bi|\msql\M|databricks|snowflake|\metl\M|tableau)'
  );
$$;

grant execute on function public.sales_is_dev_data_title(text) to authenticated, service_role;

create or replace function public.sales_set_follow(p_company uuid, p_follow boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old timestamptz;
begin
  select followed_at into v_old from public.companies where id = p_company;
  if not found or (v_old is not null) = p_follow then
    return;
  end if;
  update public.companies
  set followed_at = case when p_follow then now() end,
      followed_by = case when p_follow then public.sales_current_actor() end
  where id = p_company;
  insert into public.activities (company_id, channel, type, field, old_value, new_value, source, created_by)
  values (p_company, 'system', 'change', 'followed', to_jsonb(not p_follow), to_jsonb(p_follow),
    public.sales_current_source(), public.sales_current_actor());
end;
$$;

revoke execute on function public.sales_set_follow(uuid, boolean) from public, anon, authenticated;

create or replace function public.signals_notify_followers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_who uuid;
  v_activity uuid;
begin
  select * into v_company from public.companies where id = new.company_id;
  if v_company.followed_at is null or not public.sales_is_dev_data_title(new.title) then
    return null;
  end if;
  v_who := coalesce(v_company.owner_id, v_company.followed_by);

  insert into public.activities (company_id, channel, type, outcome, notes, source, created_by, external_id)
  values (
    v_company.id, 'system', 'system', null,
    left('New dev or data vacancy at a followed company: ' || coalesce(new.title, 'vacancy')
      || coalesce(' (' || new.source_url || ')', ''), 2000),
    'system', v_who, 'follow:signal:' || new.id
  )
  on conflict (external_id) do nothing
  returning id into v_activity;

  if v_activity is null or v_who is null then
    return null;
  end if;

  begin
    perform public.work_create_record_task(
      'company', v_company.id,
      left('New vacancy at ' || v_company.name || ': ' || coalesce(new.title, 'vacancy'), 300),
      'A company you follow posted a new dev or data vacancy.'
        || coalesce(E'\n\nSource: ' || new.source_url, '')
        || E'\n\nCheck the lead and decide on a next step.',
      'high',
      (current_date + 1)::timestamptz,
      array[v_who],
      null,
      'todo',
      v_who
    );
  exception when others then
    raise warning 'signals_notify_followers: no task for % (%)', v_company.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.signals_notify_followers() from public, anon, authenticated;

drop trigger if exists signals_notify_followers on public.signals;
create trigger signals_notify_followers after insert on public.signals
  for each row execute function public.signals_notify_followers();
