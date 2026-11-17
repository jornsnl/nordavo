"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  History,
  LoaderCircle,
  Phone,
  PhoneOff,
  SkipForward,
  Square,
  Users,
} from "lucide-react";
import { VacancyItem } from "@/components/leads/vacancy-item";
import type { CallOutcome } from "@/lib/sales/database";
import { buildSalesBookingUrl } from "@/lib/sales/booking";
import { dialsInBrowser } from "@/lib/sales/telephony";
import type { CallCard, CallInput, CallOptions, CallStep } from "@/lib/sales/call-session";
import { callOutcomes, companyPrios } from "@/lib/sales/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Textarea } from "@/components/ui/field";
import { dismissToast, toast } from "@/components/ui/toaster";
import { OutcomeDialog } from "@/components/calls/outcome-dialog";
import { needsFollowUp, type OutcomeFields } from "@/lib/sales/call-outcome";

export type CallScreenActions = {
  start: (exclude: string[]) => Promise<CallStep>;
  log: (input: CallInput, exclude: string[]) => Promise<CallStep>;
  skip: (contactId: string | null, exclude: string[]) => Promise<CallStep>;
  release: (contactId: string) => Promise<void>;
  /** Puts the last call back (feedback Julius, 66065265): the activity it returned and the contact open now. */
  undo: (activityId: string, current: string | null) => Promise<CallStep>;
};

/** How long Undo stays on the screen after saving a call. */
const UNDO_MS = 10_000;

const sourceLabels: Record<CallCard["queue"]["source"], string> = {
  assigned: "Assigned to you",
  sequence: "Sequence call due",
  list: "Call list",
};

/**
 * The call screen (feedback Julius, section 2.9): one contact at a time from
 * the queue, held for you while it is open, with the outcome buttons of the
 * Excel. Used by the team at /dashboard/calls and by external callers at
 * /caller/call; the server actions decide whose queue it is.
 */
export function CallScreen({ actions, emptyText }: { actions: CallScreenActions; emptyText: string }) {
  const [step, setStep] = useState<CallStep | null>(null);
  const [exclude, setExclude] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [stopped, setStopped] = useState(false);
  // What the last Save could not do (the follow-up window stays open and shows it).
  const [saveError, setSaveError] = useState<string>();
  const undoToast = useRef<number | null>(null);
  const started = useRef(false);
  const current = step?.card?.contact.id ?? null;
  const currentRef = useRef<string | null>(null);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startTransition(async () => setStep(await actions.start([])));
  }, [actions]);

  // Let go of the open contact when leaving the page (else it is free after 30 minutes).
  const releaseRef = useRef(actions.release);
  useEffect(() => {
    releaseRef.current = actions.release;
  }, [actions.release]);
  useEffect(() => {
    return () => {
      if (currentRef.current) void releaseRef.current(currentRef.current);
    };
  }, []);

  function run(next: () => Promise<CallStep>, handled: string | null) {
    const nextExclude = handled ? [...exclude, handled] : exclude;
    startTransition(async () => {
      const result = await next();
      setExclude(nextExclude);
      setStep(result);
    });
  }

  function skip() {
    run(() => actions.skip(current, exclude), current);
  }

  // Saves a call and opens the next contact. The confirmation is a toast with Undo, floating
  // over the page: nothing moves, so the buttons stay where they were (feedback Julius, 66065265).
  function log(input: CallInput) {
    setSaveError(undefined);
    const before = exclude;
    startTransition(async () => {
      const result = await actions.log(input, before);
      if (!result.logged) {
        // Not saved: stay on this contact, the window shows what is wrong.
        setSaveError(result.error ?? "The outcome was not saved. Please try again.");
        return;
      }
      setExclude([...new Set([...before, ...(result.handled ?? [])])]);
      setStep(result);
      if (undoToast.current !== null) dismissToast(undoToast.current);
      const activityId = result.logged.activityId;
      undoToast.current = toast(`Saved: ${result.logged.outcome}`, {
        duration: UNDO_MS,
        action: activityId ? { label: "Undo", onClick: () => undo(activityId, result.handled ?? []) } : undefined,
      });
    });
  }

  function undo(activityId: string, handled: string[]) {
    startTransition(async () => {
      const result = await actions.undo(activityId, currentRef.current);
      if (!result.card) {
        toast(result.error ?? "The undo did not work.", { tone: "error" });
        return;
      }
      setExclude((prev) => prev.filter((id) => !handled.includes(id)));
      setSaveError(undefined);
      setStep(result);
      toast("Undone: the call is open again.", { tone: "info", duration: 4000 });
    });
  }

  function stop() {
    if (current) void actions.release(current);
    setStopped(true);
    setStep(null);
  }

  function restart() {
    setStopped(false);
    setExclude([]);
    startTransition(async () => setStep(await actions.start([])));
  }

  if (stopped) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-muted">You stopped calling. The contact you had open is free again.</p>
          <Button onClick={restart}>
            <Phone aria-hidden="true" />
            Start calling again
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (!step) {
    return (
      <Card>
        <CardBody className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          Finding the next contact to call
        </CardBody>
      </Card>
    );
  }

  const card = step.card;
  return (
    <div className="space-y-4">
      {step.error && <FormMessage error={step.error} />}

      {!card ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <PhoneOff className="size-6" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-lg font-semibold text-brand-900">Nobody left to call right now</p>
              <p className="mt-1 max-w-md text-sm text-muted">{emptyText}</p>
            </div>
            <Button variant="secondary" onClick={restart} disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Check again
            </Button>
          </CardBody>
        </Card>
      ) : (
        <ContactCall
          key={card.contact.id}
          card={card}
          remaining={step.remaining}
          pending={pending}
          onSkip={skip}
          onStop={stop}
          options={step.options}
          saveError={saveError}
          onLog={log}
        />
      )}
    </div>
  );
}

function ContactCall({
  card,
  remaining,
  pending,
  onSkip,
  onStop,
  onLog,
  options,
  saveError,
}: {
  card: CallCard;
  remaining: number;
  pending: boolean;
  options?: CallOptions;
  saveError?: string;
  onSkip: () => void;
  onStop: () => void;
  onLog: (input: CallInput) => void;
}) {
  const { contact, company, dial } = card;
  const prio = companyPrios.find((p) => p.value === String(company.prio));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Contact {card.queue.position} of {card.queue.total}
          {" · "}
          {card.queue.listName ? `List: ${card.queue.listName}` : sourceLabels[card.queue.source]}
          {remaining > 0 ? ` · ${remaining} after this one` : " · last one"}
        </p>
        <div className="flex gap-2 max-sm:w-full max-sm:*:flex-1">
          <Button variant="secondary" size="sm" onClick={onStop} disabled={pending}>
            <Square aria-hidden="true" />
            Stop
          </Button>
          <Button variant="secondary" size="sm" onClick={onSkip} disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <SkipForward aria-hidden="true" />}
            Next contact
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-4 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl font-bold text-brand-900 sm:text-2xl">{company.name}</h2>
                    {prio && <Badge tone={prio.tone}>{prio.label}</Badge>}
                    {contact.route && <Badge tone="brand">{contact.route}</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {[company.city, company.sector].filter(Boolean).join(" · ")}
                    {company.website && (
                      <>
                        {company.city || company.sector ? " · " : ""}
                        <a
                          href={company.website}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-brand-600 hover:underline"
                        >
                          Website
                        </a>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {dial ? (
                <a
                  href={dial.href}
                  {...(dialsInBrowser(dial.href) ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="flex items-center gap-3 rounded-2xl bg-brand-700 px-5 py-4 text-white shadow-sm transition hover:bg-brand-800 active:scale-[0.99]"
                >
                  <Phone className="size-6 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-display text-2xl font-bold tracking-wide">{dial.number}</span>
                    <span className="block text-xs text-brand-100/80">
                      {dial.kind === "contact" ? "Mobile of the contact" : "General number of the company"}
                    </span>
                  </span>
                </a>
              ) : (
                <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">No number to call.</p>
              )}

              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-ink">{contact.name}</p>
                  <p className="text-sm text-muted">
                    {[contact.title, contact.status].filter(Boolean).join(" · ")}
                    {contact.email && <> · {contact.email}</>}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium text-ink">
                    {contact.attempts === 0 ? "Not called yet" : `${contact.attempts} ${contact.attempts === 1 ? "attempt" : "attempts"}`}
                  </p>
                  {contact.lastAttemptAt && <p className="text-xs text-muted">Last {formatDateTime(contact.lastAttemptAt)}</p>}
                </div>
              </div>

              {(contact.callbackAt || contact.callerNote || contact.referredTo) && (
                <ul className="space-y-1 rounded-xl bg-surface px-4 py-3 text-sm">
                  {contact.callbackAt && (
                    <li>
                      <CalendarClock className="mr-1.5 inline size-4 text-muted" aria-hidden="true" />
                      Call back on {formatDate(contact.callbackAt)}
                    </li>
                  )}
                  {contact.referredTo && <li>Referred to {contact.referredTo}</li>}
                  {contact.callerNote && <li className="whitespace-pre-line text-muted">{contact.callerNote}</li>}
                </ul>
              )}
            </CardBody>
          </Card>

          <OutcomePanel card={card} options={options} saveError={saveError} pending={pending} onLog={onLog} />

          {company.openingLine && (
            <Section title="Opening line">
              <p className="text-sm whitespace-pre-line text-ink">{company.openingLine}</p>
            </Section>
          )}

          <Section title="Vacancies" icon={<Briefcase className="size-4" aria-hidden="true" />}>
            {card.vacancies.length === 0 ? (
              <p className="text-sm text-muted">No vacancies known.</p>
            ) : (
              <ul className="divide-y divide-border">
                {card.vacancies.map((v) => (
                  <li key={v.id} className="py-2 text-sm first:pt-0 last:pb-0">
                    {/* Title links to the vacancy (site, LinkedIn, Indeed); date online, days open and the text to fold open. */}
                    <VacancyItem
                      title={v.title}
                      url={v.url}
                      postedAt={v.postedAt}
                      firstSeenAt={v.firstSeenAt ?? new Date().toISOString()}
                      description={v.description}
                      roleGroup={v.roleGroup}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {company.redFlags.length > 0 && (
            <Section title="Red flags" icon={<AlertTriangle className="size-4 text-danger" aria-hidden="true" />}>
              <ul className="flex flex-wrap gap-2">
                {company.redFlags.map((flag) => (
                  <li key={flag}>
                    <Badge tone="danger">{flag}</Badge>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Other contacts" icon={<Users className="size-4" aria-hidden="true" />}>
            {card.others.length === 0 ? (
              <p className="text-sm text-muted">No other contacts at this company.</p>
            ) : (
              <ul className="divide-y divide-border">
                {card.others.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0">
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{o.name}</span>
                      {o.title && <span className="text-muted"> · {o.title}</span>}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {o.phone && <span>{o.phone}</span>}
                      <Badge>{o.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {company.description && (
            <Section title="What they do">
              <p className="text-sm whitespace-pre-line text-ink">{company.description}</p>
            </Section>
          )}
        </div>

        <Timeline items={card.timeline} />
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            {icon}
            {title}
          </span>
        }
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function OutcomePanel({
  card,
  options,
  saveError,
  pending,
  onLog,
}: {
  card: CallCard;
  options?: CallOptions;
  saveError?: string;
  pending: boolean;
  onLog: (input: CallInput) => void;
}) {
  // The note box is for No answer, which saves with one tap; the other outcomes ask in their own window.
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<CallOutcome | null>(null);
  // A new contact may not be hit by the click that was meant for the last one.
  const armedAt = useRef(0);
  useEffect(() => {
    armedAt.current = performance.now() + 600;
  }, []);

  function save(fields: OutcomeFields) {
    if (fields.outcome === "meeting_planned" && card.booking) {
      // Opened in the click on Save, so the browser allows the new tab.
      const url = buildSalesBookingUrl(card.booking.base, {
        name: card.booking.name,
        email: card.booking.email,
        notes: [`${card.company.name}`, fields.meetingReason?.trim()].filter(Boolean).join(": "),
        contactId: card.contact.id,
        companyId: card.company.id,
        callerId: card.booking.callerId,
      });
      window.open(url, "_blank", "noopener");
    }
    onLog({ ...fields, contactId: card.contact.id, note: fields.note?.trim() || null });
  }

  function press(outcome: CallOutcome, clickedAt: number) {
    if (pending || clickedAt < armedAt.current) return;
    if (needsFollowUp(outcome)) {
      setOpen(outcome);
      return;
    }
    save({ outcome, note });
  }

  const toneClasses: Record<string, string> = {
    success: "border-emerald-600/30 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    danger: "border-danger/30 bg-danger-bg text-danger hover:bg-danger/10",
    warning: "border-amber-600/30 bg-amber-50 text-amber-800 hover:bg-amber-100",
    brand: "border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100",
    neutral: "border-border bg-white text-ink hover:bg-surface",
    accent: "border-accent-500/30 bg-accent-100 text-brand-900 hover:bg-accent-100/70",
  };
  const buttons = card.outcomes.map((c) => ({
    ...(callOutcomes.find((o) => o.value === c.value) ?? callOutcomes[0]),
    label: c.label,
    description: c.description,
  }));

  return (
    <Card>
      <CardHeader title="Outcome" description="No answer saves at once. Every other outcome asks what it needs first, then saves and opens the next contact." />
      <CardBody className="space-y-4">
        <Field label="Note for No answer (optional)" htmlFor="call-note">
          <Textarea
            id="call-note"
            rows={2}
            maxLength={5000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was said, who to ask for, the best time to call"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {buttons.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={pending}
              onClick={(e) => press(o.value, e.timeStamp)}
              className={`min-h-12 rounded-xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60 ${toneClasses[o.tone]}`}
            >
              {o.label}
              {o.description && <span className="block text-xs font-normal opacity-80">{o.description}</span>}
            </button>
          ))}
        </div>

        {!card.booking && (
          <p className="text-xs text-muted">
            Meeting planned saves a planned meeting. No Cal.com sales link is set, so book the time in the calendar yourself.
          </p>
        )}
        {/* Only a problem with a no-answer save shows here; the other windows show their own. */}
        {open === null && <FormMessage error={saveError} />}
      </CardBody>

      <OutcomeDialog
        outcome={open}
        outcomeLabel={buttons.find((b) => b.value === open)?.label ?? ""}
        contactName={card.contact.name}
        companyName={card.company.name}
        options={options}
        initialNote=""
        pending={pending}
        error={saveError}
        onSave={save}
        onClose={() => setOpen(null)}
      />
    </Card>
  );
}

function Timeline({ items }: { items: CallCard["timeline"] }) {
  return (
    <Card className="self-start">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <History className="size-4" aria-hidden="true" />
            Timeline
          </span>
        }
        description="Everything that happened with this company, newest first."
      />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ol className="space-y-3">
            {items.map((item) =>
              item.type === "change" ? (
                <li key={item.id} className="text-xs text-muted">
                  <span className="text-ink/70">{item.summary}</span>
                  {" · "}
                  {formatDateTime(item.date)}
                  {item.who && <> · {item.who}</>}
                </li>
              ) : (
                <li key={item.id} className="rounded-xl border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium text-ink">{item.summary}</span>
                    <span className="text-xs text-muted">{formatDateTime(item.date)}</span>
                  </div>
                  {(item.contactName || item.who) && (
                    <p className="text-xs text-muted">
                      {[item.contactName, item.who && `by ${item.who}`].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {item.notes && <p className="mt-1 text-sm whitespace-pre-line text-ink/80">{item.notes}</p>}
                </li>
              ),
            )}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
