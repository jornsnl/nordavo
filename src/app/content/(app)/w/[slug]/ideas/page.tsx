import type { Metadata } from "next";
import { Suspense } from "react";
import { Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageTabs } from "@/components/work/page-tabs";
import { IdeaList } from "@/components/content/ideas/idea-list";
import { getContentWorkspace, requireContentUser, requireModule } from "@/lib/content/data";
import { countIdeas, listIdeas, listSourceChoices, parseIdeaView } from "@/lib/content/ideas";

export const metadata: Metadata = { title: "Ideas" };

export default function IdeasPage({ params, searchParams }: PageProps<"/content/w/[slug]/ideas">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Ideas params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const emptyText = {
  inbox: "New ideas land here. Capture one in seconds, also from your phone.",
  shortlist: "Shortlist the ideas you want to write about first.",
  archive: "Converted and archived ideas end up here.",
};

async function Ideas({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query, user] = await Promise.all([params, searchParams, requireContentUser()]);
  const workspace = await getContentWorkspace(slug);
  requireModule(workspace, "ideas");
  // Reviewers see the ideas of the workspaces they review and work them out into posts (feedback Julius).
  const view = parseIdeaView(typeof query.view === "string" ? query.view : undefined);
  const [ideas, counts, sources] = await Promise.all([
    listIdeas(workspace, user.id, view),
    countIdeas(workspace.id),
    workspace.modules.sources ? listSourceChoices(workspace.id) : Promise.resolve([]),
  ]);
  const canCapture = workspace.role === "author" || workspace.role === "admin";
  const base = `/content/w/${slug}/ideas`;

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Ideas"
        description={
          workspace.role === "reviewer"
            ? "The ideas of this workspace. Turn one into a post to work it out."
            : "Loose thoughts, kept apart from real posts. Private to you (and your reviewer) unless you share them."
        }
        actions={
          canCapture && (
            <ButtonLink href="/content/capture">
              <Lightbulb aria-hidden="true" />
              Capture an idea
            </ButtonLink>
          )
        }
      />
      <div className="mb-5">
        <PageTabs
          label="Idea views"
          tabs={[
            { label: "Inbox", href: base, active: view === "inbox", count: counts.inbox },
            { label: "Shortlist", href: `${base}?view=shortlist`, active: view === "shortlist", count: counts.shortlist },
            { label: "Archive", href: `${base}?view=archive`, active: view === "archive" },
          ]}
        />
      </div>
      {ideas.length === 0 ? (
        <EmptyState icon={Lightbulb} title="Nothing here" description={emptyText[view]} />
      ) : (
        <IdeaList
          slug={slug}
          view={view}
          ideas={ideas}
          isAdmin={workspace.role === "admin" || workspace.role === "reviewer"}
          canCreatePosts={canCapture || workspace.role === "reviewer"}
          sources={sources}
          fields={workspace.fields.idea.filter((f) => !f.archived)}
        />
      )}
    </>
  );
}
