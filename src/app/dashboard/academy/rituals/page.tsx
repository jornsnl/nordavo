import type { Metadata } from "next";
import { Suspense } from "react";
import { listRitualTemplates } from "@/lib/academy/placement/data";
import { PageHeader } from "@/components/dashboard/page-header";
import { DeleteRitualTemplateButton, RitualTemplateForm } from "@/components/academy/admin/placement/forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy rituals" };

const CADENCE = { daily: "Every working day", weekly: "Weekly", monthly: "Monthly" } as const;
const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const AUDIENCE = { both: "Client or developer", client: "Client", developer: "Developer", nordavo: "Nordavo" } as const;

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="Rituals"
        description="Rituals per course. Every placement whose people follow the course gets a copy; a copy follows changes here until it is adjusted on the placement's Academy tab. Reminders go out from 16:00 in each person's time zone when a ritual was not ticked off."
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Templates />
      </Suspense>
    </>
  );
}

async function Templates() {
  const { courses, rituals, copies } = await listRitualTemplates();
  return (
    <div className="space-y-6">
      {courses.map((course) => {
        const own = rituals.filter((r) => r.course_id === course.id);
        return (
          <Card key={course.id}>
            <CardHeader title={course.title} description={course.audience === "client" ? "Client course" : "Developer course"} />
            <CardBody>
              {own.length === 0 ? (
                <p className="text-sm text-muted">No rituals in this course.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {own.map((r) => {
                    const used = copies.filter((c) => c.template_id === r.id);
                    return (
                      <li key={r.id} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 font-medium text-brand-900">
                              {r.title}
                              {!r.active && <Badge>Off</Badge>}
                            </p>
                            <p className="text-xs text-muted">
                              {CADENCE[r.cadence]}
                              {r.cadence === "weekly" && r.weekday ? ` on ${WEEKDAY[r.weekday]}` : ""} · {AUDIENCE[r.audience]} · in {used.length}{" "}
                              {used.length === 1 ? "placement" : "placements"}
                              {used.some((c) => c.customized) && `, ${used.filter((c) => c.customized).length} adjusted`}
                            </p>
                            {r.description && <p className="mt-1 text-sm text-muted">{r.description}</p>}
                          </div>
                          <DeleteRitualTemplateButton id={r.id} title={r.title} />
                        </div>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm text-brand-700">Change</summary>
                          <div className="mt-3">
                            <RitualTemplateForm ritual={r} courses={courses} />
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        );
      })}
      <Card>
        <CardHeader title="New course ritual" />
        <CardBody>
          <RitualTemplateForm ritual={null} courses={courses} />
        </CardBody>
      </Card>
    </div>
  );
}
