"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert, Check, ExternalLink, SkipForward, X } from "lucide-react";
import { IcpBadge, SegmentBadge, SignalTypeBadge } from "@/components/leads/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Field, FormMessage, Select, Textarea } from "@/components/ui/field";
import { initialActionState, type ActionState } from "@/lib/action-state";
import type { ReviewItem } from "@/lib/data/companies";
import { formatDate } from "@/lib/format";
import { segments } from "@/lib/labels";

type ReviewAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Review queue workspace. Holds the message of the last decision while the
 * form below remounts for the next company.
 */
export function ReviewWorkspace({
  item,
  action,
  position,
  total,
  nextId,
}: {
  item: ReviewItem;
  action: ReviewAction;
  position: number;
  total: number;
  nextId: string | null;
}) {
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {lastMessage && <FormMessage success={lastMessage} />}
      <ReviewForm
        key={item.id}
        item={item}
        action={action}
        position={position}
        total={total}
        nextId={nextId}
        onDone={setLastMessage}
      />
    </div>
  );
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function ReviewForm({
  item,
  action,
  position,
  total,
  nextId,
  onDone,
}: {
  item: ReviewItem;
  action: ReviewAction;
  position: number;
  total: number;
  nextId: string | null;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  const noGoRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [risk, setRisk] = useState(item.clientContactRisk);
  const nextHref = nextId ? `/dashboard/leads/review?id=${nextId}` : "/dashboard/leads/review";

  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result?.ok) {
      onDone(result.message ?? "Opgeslagen.");
      router.replace(nextHref, { scroll: false });
    }
    return result ?? prev;
  }, initialActionState);

  // Start every company at the top, so keyboard and screen reader users know a new one is shown.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || pending) return;
      const key = event.key.toLowerCase();
      if (key === "g" && !risk) {
        event.preventDefault();
        formRef.current?.requestSubmit(goRef.current);
      } else if (key === "n") {
        event.preventDefault();
        formRef.current?.requestSubmit(noGoRef.current);
      } else if (key === "s" && nextId) {
        event.preventDefault();
        router.push(nextHref, { scroll: false });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [risk, pending, nextId, nextHref, router]);

  const websiteHref = item.website && /^https?:\/\//i.test(item.website) ? item.website : `https://${item.domain}`;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span ref={headingRef} tabIndex={-1} className="outline-none">
              {item.name}
            </span>
            <IcpBadge decision="REVIEW" score={item.icpScore} />
          </span>
        }
        description={
          <a
            href={websiteHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand-700 hover:underline"
          >
            {item.domain}
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opent in een nieuw tabblad)</span>
          </a>
        }
        actions={
          <span className="text-sm text-muted tabular-nums">
            {position} van {total}
          </span>
        }
      />
      <CardBody className="space-y-6">
        <DetailList
          items={[
            { label: "Segment", value: <SegmentBadge segment={item.segment} /> },
            { label: "Medewerkers", value: item.employees ?? null },
            { label: "Sector", value: item.sector },
            { label: "Rechtsvorm", value: item.legalForm },
            { label: "Plaats", value: item.city },
            {
              label: "Detail",
              value: (
                <Link href={`/dashboard/leads/${item.id}`} className="text-brand-700 hover:underline">
                  Open de leadpagina
                </Link>
              ),
            },
          ]}
        />

        <section aria-labelledby="review-reason" className="space-y-2">
          <h3 id="review-reason" className="text-xs font-medium tracking-wide text-muted uppercase">
            Reden van Claude
          </h3>
          <p className="text-sm whitespace-pre-line text-ink">{item.icpReason || "Claude gaf geen reden."}</p>
          {item.redFlags.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Rode vlaggen">
              {item.redFlags.map((flag) => (
                <li key={flag}>
                  <Badge tone="danger">
                    <TriangleAlert className="size-3" aria-hidden="true" />
                    {flag}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {item.openingLine && (
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">Openingszin:</span> {item.openingLine}
            </p>
          )}
        </section>

        <section aria-labelledby="review-signals" className="space-y-2">
          <h3 id="review-signals" className="text-xs font-medium tracking-wide text-muted uppercase">
            Signalen
          </h3>
          {item.signals.length === 0 ? (
            <p className="text-sm text-muted">Geen signalen bij dit bedrijf.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {item.signals.map((s) => (
                <li key={s.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SignalTypeBadge type={s.type} />
                      {s.sourceUrl ? (
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                        >
                          <span className="truncate">{s.title || "Vacature"}</span>
                          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="sr-only">(opent in een nieuw tabblad)</span>
                        </a>
                      ) : (
                        <span className="text-sm font-medium">{s.title || "Zonder titel"}</span>
                      )}
                    </div>
                  </div>
                  <p className="shrink-0 text-xs text-muted">
                    {formatDate(s.firstSeenAt)} tot {formatDate(s.lastSeenAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form
          ref={formRef}
          className="space-y-4 border-t border-border pt-5"
          onSubmit={(event) => {
            // Submit by hand so the note survives an error; the submitter carries the decision.
            event.preventDefault();
            const submitter = (event.nativeEvent as SubmitEvent).submitter;
            const formData = new FormData(event.currentTarget, submitter);
            startTransition(() => formAction(formData));
          }}
        >
          <FormMessage error={state.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Segment" htmlFor="review-segment" error={state.fieldErrors?.segment}>
              <Select id="review-segment" name="segment" defaultValue={item.segment ?? ""}>
                <option value="">Geen segment</option>
                {segments.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <label className="flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  name="client_contact_risk"
                  checked={risk}
                  onChange={(e) => setRisk(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-border accent-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                />
                <span>
                  Risico op klantcontact
                  <span className="block text-xs text-muted">
                    De developer zou direct met klanten van de klant werken. Dit is altijd No go.
                  </span>
                </span>
              </label>
            </div>
          </div>
          <Field
            label="Notitie"
            htmlFor="review-note"
            hint="Optioneel. Komt onder de reden van Claude te staan."
            error={state.fieldErrors?.note}
          >
            <Textarea id="review-note" name="note" rows={3} />
          </Field>
          {risk && (
            <p className="rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
              Met risico op klantcontact zet de database dit bedrijf altijd op No go. GO kan daarom niet.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              Sneltoetsen: <kbd className="font-semibold">G</kbd> voor GO, <kbd className="font-semibold">N</kbd> voor
              No go, <kbd className="font-semibold">S</kbd> om over te slaan.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {nextId && (
                <Link
                  href={nextHref}
                  scroll={false}
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                >
                  <SkipForward className="size-[18px]" aria-hidden="true" />
                  Overslaan
                </Link>
              )}
              <Button
                ref={noGoRef}
                type="submit"
                name="decision"
                value="NO_GO"
                variant="secondary"
                disabled={pending}
                aria-keyshortcuts="N"
              >
                <X aria-hidden="true" />
                No go
              </Button>
              <Button
                ref={goRef}
                type="submit"
                name="decision"
                value="GO"
                disabled={pending || risk}
                aria-keyshortcuts="G"
              >
                <Check aria-hidden="true" />
                GO
              </Button>
            </div>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
