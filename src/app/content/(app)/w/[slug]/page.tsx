import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarDays, Lightbulb, PenLine } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { BufferMeter, RhythmStat, RhythmWarning, TomorrowWarning } from "@/components/content/planning/meters";
import { PostList } from "@/components/content/planning/post-list";
import { getContentWorkspace, statusLabel, type ContentWorkspace } from "@/lib/content/data";
import { listActivePosts, statsFor, timeSlots, type PostSummary } from "@/lib/content/planning";
import { dayKey, roleLabel } from "@/lib/content/rules";

export const metadata: Metadata = { title: "Workspace" };

export default function WorkspaceHomePage({ params }: PageProps<"/content/w/[slug]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <WorkspaceHome params={params} />
    </Suspense>
  );
}

function items(workspace: ContentWorkspace, posts: PostSummary[]) {
  const slots = timeSlots(workspace);
  return posts.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    statusLabel: statusLabel(workspace, p.status),
    href: `/content/w/${workspace.slug}/posts/${p.id}`,
    plannedDate: p.plannedDate,
    slotLabel: p.timeSlot ? (slots.find((s) => s.value === p.timeSlot)?.label ?? null) : null,
  }));
}

async function WorkspaceHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const workspace = await getContentWorkspace(slug);
  const today = dayKey();
  const stats = statsFor(workspace, await listActivePosts([workspace.id]), today);
  const role = roleLabel(workspace.role);
  const canAdd = workspace.role === "admin" || workspace.role === "author";

  return (
    <>
      <PageHeader
        eyebrow="Content workspace"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {workspace.name}
            <Badge tone={role.tone}>You: {role.label}</Badge>
          </span>
        }
        description={`Rhythm goal: ${workspace.rhythmGoal} posts a week. Buffer target: ${workspace.bufferMin} to ${workspace.bufferMax} posts ready ahead.`}
        actions={
          <>
            {canAdd && workspace.modules.ideas && (
              <ButtonLink href="/content/capture" variant="secondary">
                <Lightbulb aria-hidden="true" />
                Capture idea
              </ButtonLink>
            )}
            {canAdd && (
              <ButtonLink href={`/content/w/${slug}/posts`}>
                <PenLine aria-hidden="true" />
                New post
              </ButtonLink>
            )}
            <ButtonLink href={`/content/w/${slug}/calendar`} variant="secondary">
              <CalendarDays aria-hidden="true" />
              Calendar
            </ButtonLink>
          </>
        }
      />

      <TomorrowWarning posts={stats.tomorrowUnapproved} hrefFor={(p) => `/content/w/${slug}/posts/${p.id}`} />
      <RhythmWarning
        weeks={[
          { label: "This week", rhythm: stats.thisWeek },
          { label: "Next week", rhythm: stats.nextWeek },
        ]}
      />

      <Card className="mb-6">
        <CardBody className="grid gap-5 sm:grid-cols-3">
          <BufferMeter count={stats.buffer} min={workspace.bufferMin} max={workspace.bufferMax} state={stats.bufferState} />
          <RhythmStat label="This week" rhythm={stats.thisWeek} />
          <RhythmStat label="Next week" rhythm={stats.nextWeek} />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Coming up" description="Planned in the next 14 days." />
          <CardBody>
            <PostList posts={items(workspace, stats.upcoming)} empty="Nothing planned in the next 14 days." />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Needs attention" description="In review or waiting for changes." />
          <CardBody>
            <PostList posts={items(workspace, stats.needsAttention)} empty="Nothing waiting." />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
