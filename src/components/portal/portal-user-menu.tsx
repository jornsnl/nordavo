import { LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { requireClient } from "@/lib/auth";

export async function PortalUserMenu() {
  const user = await requireClient();
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={user.name} size="sm" />
      <div className="hidden min-w-0 sm:block">
        <p className="max-w-40 truncate text-sm font-medium text-ink">{user.name}</p>
        <p className="max-w-40 truncate text-xs text-muted">{user.email}</p>
      </div>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-brand-50 hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-brand-500"
          aria-label="Uitloggen"
          title="Uitloggen"
        >
          <LogOut className="size-[18px]" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

export function PortalUserMenuSkeleton() {
  return (
    <div className="flex items-center gap-2.5" aria-hidden="true">
      <Skeleton className="size-7" />
      <Skeleton className="hidden h-3 w-24 sm:block" />
    </div>
  );
}
