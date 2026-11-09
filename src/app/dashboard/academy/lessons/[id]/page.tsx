import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getLessonEditor } from "@/lib/academy/admin";
import { PageHeader } from "@/components/dashboard/page-header";
import { LessonEditorView } from "@/components/academy/admin/lesson-editor";
import { LessonDraftPanel } from "@/components/academy/ats/draft-panel";
import { hasClaude } from "@/lib/ai/claude";
import { getLessonDraftState } from "@/lib/academy/ats/data";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Lesson editor" };

export default function Page({ params }: PageProps<"/dashboard/academy/lessons/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: Pick<PageProps<"/dashboard/academy/lessons/[id]">, "params">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const [editor, draftState] = await Promise.all([getLessonEditor(id), getLessonDraftState(id)]);
  if (!editor) notFound();
  const first = editor.usedIn[0];
  return (
    <>
      <PageHeader
        eyebrow={first ? `${first.courseTitle} · ${first.moduleTitle}` : "Library"}
        title={editor.lesson.title}
        description="A lesson is a list of blocks. Choose which blocks and their order, and which are required for the green check. There is no complete button: the lesson is done when its required blocks are."
        actions={
          first ? (
            <Link href={`/academy/courses/${first.courseId}/lessons/${editor.lesson.id}?module=${first.moduleId}`} className="text-sm font-medium text-brand-700 hover:underline">
              Preview
            </Link>
          ) : undefined
        }
      />
      <LessonDraftPanel lessonId={editor.lesson.id} claude={hasClaude()} videos={draftState.videos} drafts={draftState.drafts} />
      <LessonEditorView editor={editor} />
    </>
  );
}
