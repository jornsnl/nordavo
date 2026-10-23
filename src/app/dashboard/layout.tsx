import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";
import { AppShell } from "@/components/dashboard/app-shell";
import { UserMenu, UserMenuSkeleton } from "@/components/dashboard/user-menu";

export default function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  return (
    <AppShell
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

/** Sends client portal users to /portaal. Page data is protected by RLS as well. */
async function StaffGate() {
  await requireStaff();
  return null;
}
