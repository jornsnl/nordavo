import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCheck } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PostList, type PostListItem } from "@/components/content/planning/post-list";
import { TomorrowWarning } from "@/components/content/planning/meters";
import { getContentWorkspace, statusLabel } from "@/lib/content/data";
import { loadTodo, timeSlots, type TodoItem } from "@/lib/content/planning";

export const metadata: Metadata = { title: "My to do" };

export default function ReviewPage() {
  return (
    <>
      <PageHeader eyebrow="Content" title="My to do" description="Everything that waits for you, across every workspace you are in." />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <Todo />
      </Suspense>
    </>
  );
}

async function Todo() {
  const todo = await loadTodo();
  // Labels per workspace (statuses and time slots are configurable).
  const slugs = new Set<string>();
  const all: TodoItem[] = [
    ...Object.values(todo.reviewer ?? {}).flat(),
    ...Object.values(todo.author ?? {}).flat(),
  ];
  for (const item of all) slugs.add(item.workspace.slug);
  const workspaces = new Map(await Promise.all([...slugs].map(async (s) => [s, await getContentWorkspace(s)] as const)));

  const toItems = (list: TodoItem[], meta?: (item: TodoItem) => string): PostListItem[] =>
    list.map((p) => {
      const ws = workspaces.get(p.workspace.slug)!;
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        statusLabel: statusLabel(ws, p.status),
        href: `/content/w/${p.workspace.slug}/posts/${p.id}`,
        plannedDate: p.plannedDate,
        slotLabel: p.timeSlot ? (timeSlots(ws, p.timeSlot).find((s) => s.value === p.timeSlot)?.label ?? null) : null,
        meta: [workspaces.size > 1 ? p.workspace.name : null, meta?.(p)].filter(Boolean).join(" · ") || null,
      };
    });

  if (!todo.reviewer && !todo.author) {
    return (
      <EmptyState
        icon={CheckCheck}
        title={todo.workspaceCount === 0 ? "No workspace yet" : "Nothing for you here"}
        description={todo.workspaceCount === 0 ? "Ask an admin to add you to a content workspace." : "As a viewer you only read along."}
      />
    );
  }

  const r = todo.reviewer;
  const a = todo.author;
  const sections: { title: string; description: string; items: PostListItem[]; empty: string; show: boolean }[] = [];
  if (a) {
    sections.push(
      { title: "Changes requested", description: "The reviewer sent these back to you.", items: toItems(a.changesRequested), empty: "Nothing sent back.", show: true },
      {
        title: "Suggestions to decide",
        description: "Accept or reject the suggested text changes.",
        items: toItems(a.suggestions, (p) => `${(p as TodoItem & { count: number }).count} open`),
        empty: "No open suggestions.",
        show: true,
      },
      {
        title: "Image suggestions",
        description: "Pick one of the suggested images or reject them.",
        items: toItems(a.imageSuggestions, (p) => `${(p as TodoItem & { count: number }).count} suggested`),
        empty: "No open image suggestions.",
        show: a.imageSuggestions.length > 0,
      },
    );
  }
  if (r) {
    sections.push(
      { title: "To review", description: "Posts in review: suggest changes, comment, or request changes.", items: toItems(r.inReview), empty: "Nothing to review.", show: true },
      {
        title: "Ready to schedule",
        description: "Approved, with date and time slot. Schedule in LinkedIn and set to Scheduled.",
        items: toItems(r.readyToSchedule),
        empty: "Nothing to schedule.",
        show: true,
      },
      {
        title: "Approved, no date yet",
        description: "Approved posts that still need a date and time slot.",
        items: toItems(r.approvedUnplanned),
        empty: "",
        show: r.approvedUnplanned.length > 0,
      },
      {
        title: "No LinkedIn URL yet",
        description: "Planned for today or earlier: paste the URL once the post is live.",
        items: toItems(r.noUrl),
        empty: "Every live post has its URL.",
        show: true,
      },
      {
        title: "Results due",
        description: "Fill in impressions, likes, comments and reposts.",
        items: toItems(r.resultsDue, (p) => (p as TodoItem & { due: string[] }).due.map((d) => (d === "48h" ? "after 48 hours" : "after 7 days")).join(", ")),
        empty: "No results due.",
        show: true,
      },
      {
        title: "Image briefs",
        description: "No existing photo fits: make or find the image described in the brief.",
        items: toItems(r.imageBriefs),
        empty: "No open image briefs.",
        show: r.imageBriefs.length > 0,
      },
      {
        title: "Waiting for the author",
        description: "Sent back with changes requested.",
        items: toItems(r.waitingForAuthor),
        empty: "",
        show: r.waitingForAuthor.length > 0,
      },
    );
  }

  return (
    <>
      {a && (
        <TomorrowWarning
          posts={a.tomorrowUnapproved.map((p) => ({ ...p, workspaceName: p.workspace.name }))}
          hrefFor={(p) => `/content/w/${(p as TodoItem).workspace.slug}/posts/${p.id}`}
        />
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {sections
          .filter((s) => s.show)
          .map((s) => (
            <Card key={s.title}>
              <CardHeader title={`${s.title}${s.items.length ? ` (${s.items.length})` : ""}`} description={s.description} />
              <CardBody>
                <PostList posts={s.items} empty={s.empty} />
              </CardBody>
            </Card>
          ))}
      </div>
    </>
  );
}
