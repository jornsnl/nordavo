import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCourseEditor, listLibraryLessons, listPeople } from "@/lib/academy/admin";
import { PageHeader } from "@/components/dashboard/page-header";
import { CourseEditorView } from "@/components/academy/admin/course-editor";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Course editor" };

export default function Page({ params }: PageProps<"/dashboard/academy/courses/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: Pick<PageProps<"/dashboard/academy/courses/[id]">, "params">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const [editor, library, people] = await Promise.all([getCourseEditor(id), listLibraryLessons(), listPeople()]);
  if (!editor) notFound();
  return (
    <>
      <PageHeader
        eyebrow={editor.course.audience === "client" ? "Client course · Dutch" : "Developer course · English"}
        title={editor.course.title}
        description="Drag modules and lessons to change the order. Open a module for its release rule and lessons; open a lesson for its blocks and what is required."
      />
      <CourseEditorView
        editor={editor}
        library={library.map((l) => ({ id: l.id, title: l.title, language: l.language, status: l.status }))}
        people={people.map((p) => ({ id: p.profile_id, label: `${p.fullName ?? p.email ?? "Unknown"}${p.email ? ` (${p.email})` : ""}` }))}
      />
    </>
  );
}
