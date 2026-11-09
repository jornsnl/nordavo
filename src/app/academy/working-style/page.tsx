import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Message } from "@/components/wsp/person-view";
import { WspSharePanel } from "@/components/wsp/share-panel";
import { requireAcademyUser } from "@/lib/academy/auth";
import { PAGE_TITLE_MY_PROFILE } from "@/lib/wsp/content";
import { isWspEnabled, listMyAssessments } from "@/lib/wsp/data";
import { formatWspDate } from "@/lib/wsp/text";
import { STATUS_LABELS } from "@/lib/wsp/view";

export const metadata: Metadata = { title: "My working style profile" };

/**
 * "My working style profile" (part 4): every questionnaire of the person,
 * the report, and per linked client a box to share (never ticked by
 * default), with the status and the date of consent.
 */
export default function Page() {
  return (
    <div lang="en" className="mx-auto max-w-3xl space-y-5">
      <h1 className="font-display text-2xl font-bold text-academy-blue-900">{PAGE_TITLE_MY_PROFILE}</h1>
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <Overview />
      </Suspense>
    </div>
  );
}

async function Overview() {
  await requireAcademyUser();
  if (!(await isWspEnabled())) return <Message title="Not available" text="The working style profile is not available right now." />;
  const assessments = await listMyAssessments();
  if (assessments.length === 0) {
    return <Message title="Nothing here yet" text="When Nordavo invites you to the Working Style Profile, you find it here." />;
  }
  return (
    <>
      <ul className="space-y-3">
        {assessments.map((a) => (
          <li key={a.id}>
            <Link
              href={`/academy/working-style/${a.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-academy-blue-200 bg-white px-4 py-4 shadow-xs hover:border-academy-orange-600/40 sm:px-5"
            >
              <span>
                <span className="block font-semibold text-academy-blue-900">Working Style Profile</span>
                <span className="block text-sm text-academy-blue-800">
                  {a.status === "completed" ? `Completed on ${formatWspDate(a.completed_at)}` : `${STATUS_LABELS[a.status] ?? a.status} on ${formatWspDate(a.invited_at)}`}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-academy-orange-700">
                {a.status === "completed" ? "View report" : a.status === "expired" ? "Open" : a.intro_accepted_at ? "Continue" : "Start"}
                <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {assessments
        .filter((a) => a.report)
        .map((a) => (
          <div key={`share-${a.id}`} className="space-y-1">
            <p className="text-xs font-medium text-academy-blue-800">Report of {formatWspDate(a.completed_at)}</p>
            <WspSharePanel assessmentId={a.id} clients={a.report!.clients} canShare={a.report!.canShare} signInHref="/login?next=/academy/working-style" />
          </div>
        ))}
    </>
  );
}
