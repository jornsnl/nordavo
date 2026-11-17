import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Phone } from "lucide-react";
import { AddNoteForm, CorrectCallForm } from "@/components/calls/caller-contact-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireCaller } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { callOutcomes, labelOf } from "@/lib/sales/labels";
import { dialHref, dialsInBrowser } from "@/lib/sales/telephony";
import { createAdminClient } from "@/lib/supabase/admin";
import { addCallerNote, correctCallerCall } from "./actions";

export const metadata: Metadata = {
  title: "Contact",
};

export default function Page({ params }: PageProps<"/caller/contact/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <ContactPage params={params} />
    </Suspense>
  );
}

const UNCORRECTABLE = ["meeting_planned", "referred", "call_back"];

/** A contact a caller called: what they logged, a note to add and a way to correct an outcome. Only contacts this caller called open. */
async function ContactPage({ params }: { params: PageProps<"/caller/contact/[id]">["params"] }) {
  const { id } = await params;
  const caller = await requireCaller();
  const db = createAdminClient();
  if (!db) return <p className="text-sm text-muted">Calling is not available right now. Ask Nordavo to finish the setup.</p>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [{ data: history }, { data: profile }] = await Promise.all([
    db
      .from("activities")
      .select("id, date, type, outcome, notes, next_action_date")
      .eq("contact_id", id)
      .eq("caller_id", caller.callerId)
      .eq("channel", "bellen")
      .in("type", ["contact", "note"])
      .order("date", { ascending: false })
      .limit(100),
    db.from("profiles").select("dial_template").eq("id", caller.id).maybeSingle(),
  ]);
  // Your own calls only: a contact you never called is not yours to open.
  if (!(history ?? []).some((h) => h.type === "contact")) notFound();

  const { data: contact } = await db
    .from("contacts")
    .select("id, first_name, last_name, title, phone, email, status, callback_at, caller_note, company:companies!contacts_company_id_fkey(name, phone, city)")
    .eq("id", id)
    .maybeSingle();
  if (!contact) notFound();
  const company = Array.isArray(contact.company) ? contact.company[0] : contact.company;
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Contact";
  const number = contact.phone ?? company?.phone ?? null;
  const href = number ? dialHref(number, profile?.dial_template ?? null) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/caller" className="inline-flex items-center gap-1 text-sm text-muted hover:text-brand-900 pointer-coarse:min-h-11 pointer-coarse:items-center">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Overview
        </Link>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-brand-900">{name}</h1>
        <p className="mt-1 text-sm text-muted">
          {[contact.title, company?.name, company?.city].filter(Boolean).join(" · ")}
        </p>
      </div>

      <Card>
        <CardHeader title="Contact" />
        <CardBody className="space-y-3 text-sm">
          {contact.callback_at && (
            <p>
              <span className="font-medium text-ink">Call back on</span> <span className="text-muted">{formatDate(contact.callback_at)}</span>
            </p>
          )}
          {contact.caller_note && (
            <p className="whitespace-pre-line">
              <span className="font-medium text-ink">Note</span> <span className="text-muted">{contact.caller_note}</span>
            </p>
          )}
          {href && (
            <a
              href={href}
              {...(dialsInBrowser(href) ? { target: "_blank", rel: "noreferrer" } : {})}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-brand-800 pointer-coarse:min-h-11"
            >
              <Phone className="size-4" aria-hidden="true" />
              {number}
            </a>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Add a note" description="The note is saved at the contact and in the log." />
        <CardBody>
          <AddNoteForm contactId={id} action={addCallerNote} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Your calls to this contact"
          description="Picked the wrong outcome? Correct it with a reason. The reason is saved in the log for Nordavo."
        />
        <ul className="divide-y divide-border">
          {(history ?? []).map((h) => (
            <li key={h.id} className="space-y-2 px-4 py-3 text-sm sm:px-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-muted">{formatDateTime(h.date)}</span>
                {h.type === "contact" ? (
                  <Badge tone={callOutcomes.find((o) => o.value === h.outcome)?.tone ?? "neutral"}>
                    {h.outcome ? labelOf(callOutcomes, h.outcome as never) : "Call"}
                  </Badge>
                ) : (
                  <Badge>Note</Badge>
                )}
                {h.outcome === "call_back" && h.next_action_date && (
                  <span className="text-xs text-muted">Call back {formatDate(h.next_action_date)}</span>
                )}
              </div>
              {h.notes && <p className="whitespace-pre-line text-muted">{h.notes}</p>}
              {h.type === "contact" && !UNCORRECTABLE.includes(h.outcome ?? "") && (
                <details className="group">
                  <summary className="cursor-pointer text-xs font-medium text-brand-700 select-none pointer-coarse:py-2">Correct outcome</summary>
                  <div className="mt-2">
                    <CorrectCallForm activityId={h.id} contactId={id} current={h.outcome} action={correctCallerCall} />
                  </div>
                </details>
              )}
              {h.type === "contact" && UNCORRECTABLE.includes(h.outcome ?? "") && (
                <p className="text-xs text-muted">To change this outcome, ask Nordavo.</p>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
