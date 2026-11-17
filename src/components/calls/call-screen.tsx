"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  Briefcase,
  CalendarClock,
  CalendarDays,
  History,
  LoaderCircle,
  Phone,
  PhoneOff,
  SkipForward,
  Square,
  Users,
} from "lucide-react";
import { VacancyItem } from "@/components/leads/vacancy-item";
import {
  CheatSheet,
  MainContact,
  ObjectionsSection,
  OtherContacts,
  PrioLine,
  QuestionsSection,
  RedFlagsSection,
  SignalsSection,
  usePeople,
  type ContactActions,
} from "@/components/calls/call-brief-sections";
import type { CallOutcome } from "@/lib/sales/database";
import { buildSalesBookingUrl, pickBookingLink } from "@/lib/sales/booking";
import { BookingModal } from "@/components/calls/booking-modal";
import { dialHref, dialsInBrowser } from "@/lib/sales/telephony";
import { callNumbers } from "@/lib/sales/call-brief";
import type { BookingState, CallCard, CallInput, CallOptions, CallStep, StartedBooking } from "@/lib/sales/call-session";
import { callOutcomes, companyPrios } from "@/lib/sales/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Textarea } from "@/components/ui/field";
import { dismissToast, toast } from "@/components/ui/toaster";
import { OutcomeDialog, outcomeToneClasses } from "@/components/calls/outcome-dialog";
import { needsFollowUp, type OutcomeFields } from "@/lib/sales/call-outcome";

export type CallScreenActions = {
  start: (exclude: string[]) => Promise<CallStep>;
  log: (input: CallInput, exclude: string[]) => Promise<CallStep>;
  skip: (contactId: string | null, exclude: string[]) => Promise<CallStep>;
  release: (contactId: string) => Promise<void>;
  /** Puts the last call back (feedback Julius, 66065265): the activity it returned and the contact open now. */
  undo: (activityId: string, current: string | null) => Promise<CallStep>;
  /** Change, mark and add contacts on the screen; without it the contacts are read only. */
  contacts?: ContactActions;
  /** Meeting planned: the awaiting meeting, its state, finishing it once booked and giving up. */
  booking: {
    start: (input: CallInput) => Promise<StartedBooking>;
    status: (meetingId: string) => Promise<BookingState>;
    finish: (contactId: string, meetingId: string, exclude: string[]) => Promise<CallStep>;
    cancel: (meetingId: string) => Promise<boolean>;
  };
};

/** A "Meeting planned" that waits for the Cal.com booking. The lead stays open on the screen. */
type Awaiting = { meetingId: string; contactId: string; label: string | null; since: number };

/** How often the screen asks whether the booking is in, and when it says the booking is late. */
const POLL_MS = 4_000;
const LATE_MS = 15 * 60_000;

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
  // The agenda (Cal.com) in a window: opened by the Agenda button, or after Meeting planned (then with the awaiting meeting).
  const [agenda, setAgenda] = useState<{ linkId: string | null } | null>(null);
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const [late, setLate] = useState(false);
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
    // Another outcome than the awaited meeting: the awaiting meeting is given up.
    const wait = awaiting;
    startTransition(async () => {
      if (wait && wait.contactId === input.contactId) {
        await actions.booking.cancel(wait.meetingId);
      }
      const result = await actions.log(input, before);
      if (!result.logged) {
        // Not saved: stay on this contact, the window shows what is wrong.
        setSaveError(result.error ?? "The outcome was not saved. Please try again.");
        return;
      }
      if (wait) {
        setAwaiting(null);
        setAgenda(null);
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

  // The booking comes in through Cal.com (webhook or the Claude task); the meeting is planned
  // then, and only then the call counts. Ask for it while it is awaited.
  const awaitingRef = useRef<Awaiting | null>(null);
  useEffect(() => {
    awaitingRef.current = awaiting;
  }, [awaiting]);
  const excludeRef = useRef<string[]>([]);
  useEffect(() => {
    excludeRef.current = exclude;
  }, [exclude]);
  useEffect(() => {
    if (!awaiting) return;
    let busy = false;
    const timer = setInterval(async () => {
      const wait = awaitingRef.current;
      if (!wait || busy) return;
      busy = true;
      try {
        const state = await actions.booking.status(wait.meetingId);
        if (awaitingRef.current?.meetingId !== wait.meetingId) return;
        if (state.status === "planned") {
          booked(wait);
        } else if (state.status === "gone") {
          setAwaiting(null);
          setAgenda(null);
          setSaveError("The meeting was cancelled. The lead is still open.");
        } else if (Date.now() - wait.since > LATE_MS) {
          setLate(true);
        }
      } finally {
        busy = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // booked is stable enough: it reads refs and the latest actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting?.meetingId]);

  // The booking is in: the database logged the call, so open the next company.
  function booked(wait: Awaiting) {
    setAwaiting(null);
    setAgenda(null);
    setLate(false);
    startTransition(async () => {
      const result = await actions.booking.finish(wait.contactId, wait.meetingId, excludeRef.current);
      if (result.error && !result.card && !result.logged) {
        setSaveError(result.error);
        return;
      }
      setExclude([...new Set([...excludeRef.current, ...(result.handled ?? [])])]);
      setStep(result);
      toast("Meeting booked and saved.", { duration: UNDO_MS });
    });
  }

  // Save in the Meeting planned window: nothing is logged yet, the meeting waits for its booking.
  function startBooking(input: CallInput, linkId: string | null) {
    setSaveError(undefined);
    startTransition(async () => {
      const result = await actions.booking.start(input);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      const wait: Awaiting = { meetingId: result.meetingId, contactId: input.contactId, label: result.label, since: Date.now() };
      if (result.booked) {
        // Already booked through the agenda button: the database completed it.
        booked(wait);
        return;
      }
      setLate(false);
      setAwaiting(wait);
      setAgenda({ linkId });
    });
  }

  function cancelBooking() {
    const wait = awaiting;
    if (!wait) return;
    setAwaiting(null);
    setAgenda(null);
    setLate(false);
    void actions.booking.cancel(wait.meetingId);
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
          onBook={startBooking}
          onAgenda={() => setAgenda({ linkId: null })}
          awaiting={awaiting && awaiting.contactId === card.contact.id ? awaiting : null}
          late={late}
          onCancelBooking={cancelBooking}
          contactActions={actions.contacts}
        />
      )}

      {card?.booking && (
        <AgendaWindow
          key={`${card.contact.id}:${agenda?.linkId ?? ""}`}
          card={card}
          open={agenda !== null}
          linkId={agenda?.linkId ?? null}
          meetingId={awaiting && awaiting.contactId === card.contact.id ? awaiting.meetingId : null}
          awaiting={awaiting !== null}
          onClose={() => setAgenda(null)}
        />
      )}
    </div>
  );
}

/** The Cal.com agenda in a window, prefilled with what the portal knows about the lead. */
function AgendaWindow({
  card,
  open,
  linkId,
  meetingId,
  awaiting,
  onClose,
}: {
  card: CallCard;
  open: boolean;
  linkId: string | null;
  meetingId: string | null;
  awaiting: boolean;
  onClose: () => void;
}) {
  const booking = card.booking;
  const [picked, setPicked] = useState<string | null>(null);
  if (!booking) return null;
  const link = pickBookingLink(booking.links, picked ?? linkId);
  const url = link
    ? buildSalesBookingUrl(
        link.url,
        {
          name: booking.name,
          email: booking.email,
          company: booking.company,
          role: booking.role,
          contactId: card.contact.id,
          companyId: card.company.id,
          callerId: booking.callerId,
          meetingId,
        },
        { companyField: link.companyField, roleField: link.roleField },
      )
    : null;
  return (
    <BookingModal
      open={open}
      url={url}
      title={`Agenda: ${card.contact.name}`}
      description={
        awaiting && meetingId
          ? "Book a time with them. This screen notices the booking and opens the next company."
          : "Look at the calendar with them. Nothing is saved until you book or pick an outcome."
      }
      onClose={onClose}
      links={booking.links.length > 1 ? booking.links.map((l) => ({ id: l.id, label: l.label })) : undefined}
      activeLink={link?.id}
      onPickLink={setPicked}
    />
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
  contactActions,
  onBook,
  onAgenda,
  awaiting,
  late,
  onCancelBooking,
}: {
  card: CallCard;
  remaining: number;
  pending: boolean;
  options?: CallOptions;
  saveError?: string;
  onSkip: () => void;
  onStop: () => void;
  onLog: (input: CallInput) => void;
  contactActions?: ContactActions;
  onBook: (input: CallInput, linkId: string | null) => void;
  onAgenda: () => void;
  awaiting: Awaiting | null;
  late: boolean;
  onCancelBooking: () => void;
}) {
  const { contact, company } = card;
  const prio = companyPrios.find((p) => p.value === String(company.prio));
  // The contacts as the caller changes them here; the call button follows (a number marked wrong falls back to the general number).
  const people = usePeople(card);
  const { dial, generalDial } = callNumbers(people.main, company.generalPhone, (n) => dialHref(n, card.dialTemplate));

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
          {/* Always there: look at the agenda with the prospect, no outcome is saved. */}
          {card.booking && (
            <Button variant="secondary" size="sm" onClick={onAgenda}>
              <CalendarDays aria-hidden="true" />
              Agenda
            </Button>
          )}
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
                    {prio && <Badge tone={prio.tone}>{company.prioInfo?.label ?? prio.label}</Badge>}
                    {contact.route && <Badge tone="brand">{contact.route}</Badge>}
                  </div>
                  {company.prioInfo && <PrioLine prio={company.prioInfo} />}
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
              {generalDial && (
                <a
                  href={generalDial.href}
                  {...(dialsInBrowser(generalDial.href) ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="-mt-2 flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-ink transition hover:bg-brand-50"
                >
                  <Phone className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                  <span className="font-semibold">{generalDial.number}</span>
                  <span className="text-xs text-muted">General number of the company, if there is no answer</span>
                </a>
              )}

              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <MainContact person={people.main} status={contact.status} apply={people.apply} actions={contactActions} />
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

          <CheatSheet sections={card.cheatsheet} />

          {awaiting && (
            <Card className="border-amber-300 bg-amber-50">
              <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0 text-sm text-amber-900">
                  <p className="inline-flex items-center gap-2 font-semibold">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Waiting for the booking{awaiting.label ? ` with ${awaiting.label}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs">
                    {late
                      ? "The booking is not in yet. Book it in the agenda, or give up: the lead stays open and nothing is counted."
                      : "The meeting counts once Cal.com confirms the booking. This screen opens the next company by itself."}
                  </p>
                </div>
                <div className="flex gap-2 max-sm:w-full max-sm:*:flex-1">
                  <Button size="sm" variant="secondary" onClick={onAgenda}>
                    <CalendarDays aria-hidden="true" />
                    Open agenda
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onCancelBooking}>
                    Not booked
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          <OutcomePanel card={card} options={options} saveError={saveError} pending={pending} onLog={onLog} onBook={onBook} />

          {company.openingLine && (
            <Section title="Opening line">
              <p className="text-sm whitespace-pre-line text-ink">{company.openingLine}</p>
              {company.openingLineOutdated && (
                <p className="mt-2 text-xs text-amber-700">
                  This line is about a vacancy that is not open anymore. Check the signals before you use it.
                </p>
              )}
            </Section>
          )}

          <SignalsSection signals={card.signals} />

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

          <RedFlagsSection flags={company.redFlags} />

          <ObjectionsSection items={company.objections} />

          <QuestionsSection items={company.questions} />

          <OtherContacts
            companyId={company.id}
            others={people.others}
            apply={people.apply}
            actions={contactActions}
            icon={<Users className="size-4" aria-hidden="true" />}
          />

          {(company.description || company.facts.length > 0 || company.employees !== null) && (
            <Section title="What they do">
              {company.description && <p className="text-sm whitespace-pre-line text-ink">{company.description}</p>}
              {(company.facts.length > 0 || company.employees !== null) && (
                <p className="mt-2 text-xs text-muted">
                  {[company.employees !== null ? `${company.employees} employees` : null, ...company.facts].filter(Boolean).join(" · ")}
                </p>
              )}
            </Section>
          )}
        </div>

        <Timeline items={card.timeline} last={card.lastContact} />
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
  onBook,
}: {
  card: CallCard;
  options?: CallOptions;
  saveError?: string;
  pending: boolean;
  onLog: (input: CallInput) => void;
  onBook: (input: CallInput, linkId: string | null) => void;
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
    if (fields.outcome === "meeting_planned") {
      // Nothing is logged as a call yet: the meeting waits for its Cal.com booking.
      const linkId = fields.bookingLinkId ?? card.booking?.links[0]?.id ?? null;
      onBook({ ...fields, contactId: card.contact.id, note: fields.note?.trim() || null }, linkId);
      return;
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
              className={`min-h-12 rounded-xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60 ${outcomeToneClasses[o.tone]}`}
            >
              {o.label}
              {o.description && <span className="block text-xs font-normal opacity-80">{o.description}</span>}
            </button>
          ))}
        </div>

        {!card.booking && (
          <p className="text-xs text-muted">
            No Cal.com sales link is set (Settings, General). Meeting planned still waits for a booking: it counts once Cal.com confirms it.
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
        bookingLinks={card.booking?.links.map((l) => ({ id: l.id, label: l.label }))}
        initialNote=""
        pending={pending}
        error={saveError}
        onSave={save}
        onClose={() => setOpen(null)}
      />
    </Card>
  );
}

function Timeline({ items, last }: { items: CallCard["timeline"]; last: CallCard["lastContact"] }) {
  return (
    <Card className="self-start">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <History className="size-4" aria-hidden="true" />
            Timeline
          </span>
        }
        description="Calls, mails, LinkedIn and meetings with this company, newest first."
      />
      <CardBody className="space-y-3">
        <p className={`rounded-xl px-3 py-2 text-sm ${last ? "bg-brand-50 text-brand-900" : "bg-amber-50 text-amber-800"}`}>
          {last ? (
            <>
              <span className="font-medium">Last contact:</span> {formatDateTime(last.date)}
              {last.who ? ` by ${last.who}` : ""} ({last.summary}
              {last.contactName ? `, ${last.contactName}` : ""})
            </>
          ) : (
            "Never contacted yet: no call, mail or meeting is known."
          )}
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ol className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium text-ink">{item.summary}</span>
                  <span className="text-xs text-muted">{formatDateTime(item.date)}</span>
                </div>
                {(item.contactName || item.who) && (
                  <p className="text-xs text-muted">{[item.contactName, item.who && `by ${item.who}`].filter(Boolean).join(" · ")}</p>
                )}
                {item.notes && <p className="mt-1 text-sm whitespace-pre-line text-ink/80">{item.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
