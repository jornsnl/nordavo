import type { ReactNode } from "react";
import { getCurrentUser, hasModule } from "@/lib/auth";
import type { PortalModule } from "@/lib/database.types";

/**
 * Renders its children only for users with this module (2.5). Reads the
 * session, so put it inside a <Suspense> boundary.
 */
export async function IfModule({
  module,
  children,
  fallback = null,
}: {
  module: PortalModule;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const user = await getCurrentUser();
  return hasModule(user, module) ? children : fallback;
}
