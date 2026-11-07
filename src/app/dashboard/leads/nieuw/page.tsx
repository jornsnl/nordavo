import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewLeadForm } from "@/components/leads/new-lead-form";
import { Card, CardBody } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Add lead",
};

export default function Page() {
  return (
    <>
      <Link
        href="/dashboard/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 max-md:-mt-2 max-md:mb-2 max-md:min-h-11 max-md:active:text-brand-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All leads
      </Link>
      <PageHeader
        eyebrow="Sales"
        title="Add lead"
        description="A company you found yourself. It gets qualified like every other lead; add the contacts on the next page."
      />
      <Card className="max-w-3xl">
        <CardBody className="py-6">
          <NewLeadForm />
        </CardBody>
      </Card>
    </>
  );
}
