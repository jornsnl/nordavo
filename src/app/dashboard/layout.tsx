import { Suspense } from "react";
import { getCurrentUser, isStaff, requireStaff } from "@/lib/auth";
import type { PortalModule } from "@/lib/database.types";
import { AppShell } from "@/components/dashboard/app-shell";
import { UserMenu, UserMenuSkeleton } from "@/components/dashboard/user-menu";
import type { Metadata } from "next";
import { installableMetadata } from "@/lib/pwa/manifest";

/** The installable part: the manifest and the iOS home screen tags. */
export const metadata: Metadata = installableMetadata;

export default function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  return (
    <AppShell
      modules={navModules()}
      userMenu={
        <Suspense fallback={<UserMenuSkeleton />}>
          <UserMenu />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <StaffGate />
      </Suspense>
      {children}
    </AppShell>
  );
}

/** Sends client portal users to /portal. Page data is protected by RLS as well. */
async function StaffGate() {
  await requireStaff();
  return null;
}

/**
 * The modules the menu shows (2.5). Not awaited here: the shell streams it
 * into the menu behind Suspense. A failed or redirecting session shows the
 * shared items only; StaffGate takes care of the redirect itself.
 */
async function navModules(): Promise<PortalModule[] | null> {
  try {
    const user = await getCurrentUser();
    return isStaff(user) ? user.modules : [];
  } catch {
    return [];
  }
}
