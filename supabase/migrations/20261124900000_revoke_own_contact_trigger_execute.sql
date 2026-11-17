-- Trigger functions of 20261124700000_leads_own_contact_edit.sql are not meant
-- to be called as RPC: take the default execute rights away. Triggers keep
-- firing (they run as the table owner, not through these grants).
revoke execute on function public.companies_own_contact_changed() from public, anon, authenticated;
revoke execute on function public.campaign_members_own_contact() from public, anon, authenticated;
