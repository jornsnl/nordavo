import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { LayoutDashboard, LogOut } from "lucide-react";
import { isStaff } from "@/lib/auth";
import { requireWorkUser } from "@/lib/work/data";
import { initials } from "@/lib/format";
import { WorkShell } from "@/components/work/work-shell";
import { WorkspaceNav, WorkspaceNavSkeleton } from "@/components/work/workspace-nav";

export const metadata: Metadata = {
  title: { default: "Work", template: "%s · Work" },
};

export default function WorkLayout({ children }: LayoutProps<"/work">) {
  return (
    <div lang="en">
      <WorkShell
        workspaces={
          <Suspense fallback={<WorkspaceNavSkeleton />}>
            <WorkspaceNav />
          </Suspense>
        }
        userMenu={
          <Suspense fallback={<div className="h-14 animate-pulse rounded-xl bg-white/5" />}>
            <WorkUserMenu />
          </Suspense>
        }
      >
        {children}
      </WorkShell>
    </div>
  );
}

async function WorkUserMenu() {
  const user = await requireWorkUser();
  return (
    <div className="space-y-2">
      {isStaff(user) && (
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-brand-200/70 hover:bg-white/5 hover:text-white"
        >
          <LayoutDashboard className="size-4" aria-hidden="true" />
          Nordavo portal
        </Link>
      )}
      <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-500 font-display text-sm font-bold text-brand-900"
        >
          {initials(user.name) || "W"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="truncate text-xs text-brand-200/60">{user.timeZone.replace(/_/g, " ")}</p>
        </div>
        <form action="/auth/signout?next=/work/sign-in" method="post">
          <button
            type="submit"
            className="flex size-9 items-center justify-center rounded-lg text-brand-200/70 hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
}
