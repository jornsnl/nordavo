-- Bootstrap: make Julius portal admin and give him a Nordavo workspace in Work.
--
-- Only portal admins (profiles.role = 'admin') can create a workspace, and the
-- first admin is never set by the app itself (README step 4). Julius was left
-- as a regular account, so he could not open Settings > access, and Work showed
-- "You are not in a workspace yet" without a "New workspace" button.
--
-- Safe to run more than once, and a no-op when the account does not exist.

do $$
declare
  v_uid uuid;
  v_ws uuid;
begin
  select id into v_uid from auth.users where lower(email) = 'juliusvanbragt@gmail.com';
  if v_uid is null then
    raise notice 'No account for juliusvanbragt@gmail.com, nothing to do';
    return;
  end if;

  -- 1. Portal admin (can manage access in Settings and create workspaces).
  update public.profiles set role = 'admin' where id = v_uid and role <> 'admin';

  -- 2. Nordavo workspace with Julius as its admin.
  select id into v_ws from public.work_workspaces where slug = 'nordavo';
  if v_ws is null then
    insert into public.work_workspaces (name, slug, created_by)
    values ('Nordavo', 'nordavo', v_uid)
    returning id into v_ws;
  end if;

  if not exists (select 1 from public.work_members where workspace_id = v_ws and user_id = v_uid) then
    insert into public.work_members (workspace_id, user_id, role, invited_by)
    values (v_ws, v_uid, 'admin', v_uid);
    perform work_private.log_access(v_ws, null, v_uid, 'granted', 'admin', v_uid);
  else
    update public.work_members
    set role = 'admin', deactivated_at = null, access_expires_at = null
    where workspace_id = v_ws and user_id = v_uid;
  end if;
end;
$$;
