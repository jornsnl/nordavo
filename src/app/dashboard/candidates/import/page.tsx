import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { CandidateImportWizard } from "@/components/screening/candidate-import-wizard";
import { CvUpload } from "@/components/screening/cv-upload";
import { hasClaude } from "@/lib/ai/claude";

export const metadata: Metadata = {
  title: "Import candidates",
};

// Each CV is one server action call; Claude may read a PDF.
export const maxDuration = 300;

/**
 * Bulk import from the candidates list (feedback round 3): a list from
 * Excel or CSV with a duplicate check, and many CVs at once. Without a
 * vacancy: the candidates are added to the list, not to a pipeline. To add
 * them to a vacancy, use Import on its pipeline.
 */
export default function Page() {
  return (
    <>
      <Link
        href="/dashboard/candidates"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-brand-700 active:text-brand-700 pointer-coarse:mb-2 pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All candidates
      </Link>
      <PageHeader
        eyebrow="Recruitment"
        title="Import candidates"
        description="Add many candidates at once from Excel or CSV, or drop a pile of CVs. Duplicates are checked on email, phone, LinkedIn and name before anything is saved. To put them straight into a vacancy, use Import on that vacancy's pipeline."
      />
      <section aria-labelledby="import-list" className="space-y-4">
        <h2 id="import-list" className="font-display text-lg font-semibold text-brand-900">
          A list from Excel or CSV
        </h2>
        <CandidateImportWizard />
      </section>
      <section aria-labelledby="import-cvs" className="mt-10 space-y-4">
        <div>
          <h2 id="import-cvs" className="font-display text-lg font-semibold text-brand-900">
            Many CVs at once
          </h2>
          <p className="text-sm text-muted">
            Each CV is read and matched to an existing candidate by the email, phone or LinkedIn in it, or by the name when exactly one candidate has it. Otherwise it
            becomes a new candidate.
          </p>
        </div>
        <CvUpload claude={hasClaude()} />
      </section>
    </>
  );
}
