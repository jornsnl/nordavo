import { LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";

export async function UserMenu() {
  const user = await getCurrentUser();
  const initials = user.name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-500 font-display text-sm font-bold text-brand-900"
      >
        {initials || "N"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="truncate text-xs text-brand-200/60">{user.email}</p>
      </div>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="flex size-9 items-center justify-center rounded-lg text-brand-200/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-accent-500"
          aria-label="Uitloggen"
          title="Uitloggen"
        >
          <LogOut className="size-[18px]" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

export function UserMenuSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5" aria-hidden="true">
      <span className="size-9 animate-pulse rounded-lg bg-white/10" />
      <div className="flex-1 space-y-1.5">
        <span className="block h-3 w-24 animate-pulse rounded bg-white/10" />
        <span className="block h-2.5 w-32 animate-pulse rounded bg-white/10" />
      </div>
    </div>
  );
}
