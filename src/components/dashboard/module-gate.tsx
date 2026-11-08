import { requireModule } from "@/lib/auth";
import type { PortalModule } from "@/lib/database.types";

/**
 * Sends team members without this module to the overview (2.5). Render it
 * inside a <Suspense> boundary, like StaffGate in the dashboard layout. The
 * data itself is protected by RLS (public.has_module) as well.
 */
export async function ModuleGate({ module }: { module: PortalModule }) {
  await requireModule(module);
  return null;
}
