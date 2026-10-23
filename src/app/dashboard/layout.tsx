import { Suspense } from "react";
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
      {children}
    </AppShell>
  );
}
