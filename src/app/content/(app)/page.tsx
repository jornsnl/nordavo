import type { Metadata } from "next";
import { Suspense } from "react";
import { Lightbulb, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TomorrowWarning } from "@/components/content/planning/meters";
import { WorkspaceCard } from "@/components/content/overview/workspace-card";
import { AdminOverview } from "@/components/content/overview/admin-overview";
import { requireContentUser } from "@/lib/content/data";
import { listActivePosts, listWorkspaceSettings, statsFor } from "@/lib/content/planning";
import { loadDashboardPosts, recentResults } from "@/lib/content/results";
import { addDays, dayKey, monthStart } from "@/lib/content/rules";

export const metadata: Metadata = { title: "Overview" };

export default function ContentOverviewPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const [user, workspaces] = await Promise.all([requireContentUser(), listWorkspaceSettings()]);
  const today = dayKey();
  const posts = await listActivePosts(workspaces.map((w) => w.id));
  const stats = workspaces.map((w) => ({ workspace: w, stats: statsFor(w, posts, today) }));
  const mine = user.isAdmin ? stats.filter((s) => s.workspace.ownerId === user.id) : stats;
  const tomorrow = stats.flatMap((s) => s.stats.tomorrowUnapproved.map((p) => ({ ...p, workspaceName: s.workspace.name, slug: s.workspace.slug })));
  const slugOf = new Map(workspaces.map((w) => [w.id, w.slug]));

  let adminRows = null;
  if (user.isAdmin && workspaces.length > 0) {
    const published = await loadDashboardPosts(
      workspaces.map((w) => w.id),
      addDays(today, -40),
    );
    const month = monthStart(today).slice(0, 7);
    adminRows = stats.map(({ workspace, stats: s }) => {
      const own = published.filter((p) => p.workspaceId === workspace.id);
      return {
        workspace,
        stats: s,
        publishedThisMonth: own.filter((p) => dayKey(new Date(p.publishedAt)).startsWith(month)).length,
        results: recentResults(own, workspace.successThreshold, today),
      };
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title={`Hi ${user.name.split(" ")[0]}`}
        description="Ideas apart from posts, one flow until every post is live and measured."
        actions={
          <>
            <ButtonLink href="/content/capture" variant="secondary">
              <Lightbulb aria-hidden="true" />
              Capture idea
            </ButtonLink>
            {user.isAdmin && (
              <ButtonLink href="/content/new">
                <Plus aria-hidden="true" />
                New workspace
              </ButtonLink>
            )}
          </>
        }
      />

      <TomorrowWarning posts={tomorrow} hrefFor={(p) => `/content/w/${slugOf.get(p.workspaceId)}/posts/${p.id}`} />

      {workspaces.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No content workspace yet"
          description={
            user.isAdmin
              ? "Create a workspace for each employee who posts, then add their reviewer."
              : "You are not in a content workspace yet. Ask an admin to add you."
          }
        />
      ) : (
        <div className="space-y-8">
          {mine.length > 0 && (
            <section>
              {user.isAdmin && <h2 className="mb-3 font-display text-lg font-semibold text-brand-900">Your workspaces</h2>}
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {mine.map(({ workspace, stats: s }) => (
                  <li key={workspace.id}>
                    <WorkspaceCard workspace={workspace} stats={s} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {adminRows && <AdminOverview rows={adminRows} />}
        </div>
      )}
    </>
  );
}
