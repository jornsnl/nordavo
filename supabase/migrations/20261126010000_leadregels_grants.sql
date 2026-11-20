-- Leadregels (20261126000000_leadregels.sql): trigger functions and helpers
-- are not for the API. Only the functions the portal and the MCP call stay
-- open to signed in users (they check the sales module themselves):
-- sales_apply_contact_order, sales_check_outreach, sales_company_score and
-- sales_undo_call.

revoke execute on function
  public.activities_lead_rules(),
  public.companies_lead_rules(),
  public.contacts_default_order(),
  public.sales_signal_points_changed(),
  public.sequence_enrollments_lead_status(),
  public.signals_default_valid_until(),
  public.signals_lead_rules()
from public, anon, authenticated;

revoke execute on function public.sales_actor_is_admin() from public, anon, authenticated;
revoke execute on function public.sales_default_contact_order(uuid) from public, anon, authenticated;
grant execute on function public.sales_actor_is_admin(), public.sales_default_contact_order(uuid) to service_role;
