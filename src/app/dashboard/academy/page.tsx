import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { listCoursesForAdmin } from "@/lib/academy/admin";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { CourseForm } from "@/components/academy/admin/course-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Courses"
        description="Courses, modules and lessons of the Nordavo Academy. A lesson can be used in more than one course; an edit applies everywhere."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <Courses />
          </Suspense>
        </div>
        <Card>
          <CardHeader title="New course" description="Starts as draft: only Nordavo sees it until you publish." />
          <CardBody>
            <CourseForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

async function Courses() {
  const courses = await listCoursesForAdmin();
  if (courses.length === 0) {
    return <EmptyState icon={GraduationCap} title="No courses yet" description="Create the first course on the right." />;
  }
  return (
    <ul className="space-y-3">
      {courses.map((course) => (
        <li key={course.id}>
          <Link
            href={`/dashboard/academy/courses/${course.id}`}
            className="block rounded-2xl border border-border bg-card px-4 py-4 shadow-xs transition hover:border-brand-200 hover:bg-brand-50/40 sm:px-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display font-semibold text-brand-900">{course.title}</span>
              <Badge tone={course.status === "published" ? "success" : "neutral"}>{course.status === "published" ? "Published" : "Draft"}</Badge>
              <Badge tone="brand">{course.audience === "client" ? "Clients · NL" : "Developers · EN"}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              {course.moduleCount} modules · {course.lessonCount} lessons · {course.peopleCount} with access
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
