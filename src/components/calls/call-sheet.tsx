"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Copy, ExternalLink, History, LoaderCircle, Pencil, Phone, PhoneOff, UserPlus } from "lucide-react";
import { emptyPerson, initialOf, PersonForm, type ContactActions } from "@/components/calls/call-brief-sections";
import { OutcomeDialog, outcomeToneClasses } from "@/components/calls/outcome-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { dismissToast, toast } from "@/components/ui/toaster";
import { formatDate, formatDateTime, todayIso } from "@/lib/format";
import { contactStatuses } from "@/lib/labels";
import { buildSalesBookingUrl } from "@/lib/sales/booking";
import { callNumbers } from "@/lib/sales/call-brief";
import { needsFollowUp, type OutcomeFields } from "@/lib/sales/call-outcome";
import type { ClaimedContact, SheetHistory, SheetLogged, SheetReloaded, SheetUndone } from "@/lib/sales/call-sheet-actions";
import { matchesSheetFilter, sheetFilters, sheetToTsv, type SheetCompanyRow, type SheetFilter, type SheetRow } from "@/lib/sales/call-sheet";
import type { CallInput, CallOptions, CallTimelineItem } from "@/lib/sales/call-session";
import type { CallOutcome } from "@/lib/sales/database";
import { callOutcomes, labelOf } from "@/lib/sales/labels";
import { dialHref, dialsInBrowser } from "@/lib/sales/telephony";
import { outcomeName } from "@/lib/sales/timeline";

/**
 * The call list as a spreadsheet you can work in (feedback Julius, 896704e2 and
 * f5d4375a): one row per company that folds out to its contacts, with the
 * last outcome, attempts, call back, last note and who called last. Every
 * contact has all the outcome buttons of the call screen, with the same
 * follow-up window (OutcomeDialog, as a side panel) and the same rules on the
 * server (sales_log_call). A row you open or call is held for you
 * (sales_claim_contact) like on the call screen, contacts can be changed and
 * added in the row, and the history folds out per row.
 * leadLinks: the team opens the lead page, callers do not.
 */

export type CallSheetActions = {
  claim: (contactId: string) => Promise<ClaimedContact>;
  release: (contactId: string) => Promise<void>;
  log: (input: CallInput) => Promise<SheetLogged>;
  undo: (activityId: string) => Promise<SheetUndone>;
  history: (companyId: string) => Promise<SheetHistory>;
  reload: (companyId: string) => Promise<SheetReloaded>;
  contacts: ContactActions;
};

/** How long Undo stays on the screen after saving a call (as on the call screen). */
const UNDO_MS = 10_000;
/** Rows drawn at once; more come with "Show more". */
const PAGE = 100;

type OutcomeButton = { value: CallOutcome; label: string; description: string | null };
type Dialog = { companyId: string; contactId: string; outcome: CallOutcome };

const lastOutcomeTone = (o: string | null) =>
  o === "reached_interested" || o === "meeting_planned" ? "success" : o === "reached_not_interested" || o === "wrong_number" || o === "wrong_person" ? "danger" : "neutral";

export function CallSheet({
  rows: initialRows,
  dialTemplate,
  leadLinks,
  callHref,
  actions,
  outcomes,
  options,
  booking,
}: {
  rows: SheetCompanyRow[];
  dialTemplate: string | null;
  leadLinks: boolean;
  /** The call screen for this list. */
  callHref: string;
  actions: CallSheetActions;
  outcomes: OutcomeButton[];
  options: CallOptions;
  /** The Cal.com sales link for Meeting planned, or null when none is set. */
  booking: { base: string; callerId: string | null } | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SheetFilter>("all");
  const [visible, setVisible] = useState(PAGE);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // A note typed in the row; it goes along with the next outcome of that company.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [saveError, setSaveError] = useState<string>();
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  // Contacts held for me, per company. The ref answers at once (inside handlers); the state draws.
  const heldRef = useRef<Record<string, string[]>>({});
  const [held, setHeld] = useState<Record<string, string[]>>({});
  const undoToast = useRef<number | null>(null);
  const today = todayIso();

  // The history per company, loaded when it is first folded out.
  const [history, setHistory] = useState<Record<string, { items?: CallTimelineItem[]; error?: string; loading?: boolean }>>({});
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set());
  function loadHistory(companyId: string) {
    setHistory((h) => ({ ...h, [companyId]: { ...h[companyId], loading: true } }));
    void actions.history(companyId).then((r) => setHistory((h) => ({ ...h, [companyId]: r.ok ? { items: r.items } : { error: r.error } })));
  }
  function toggleHistory(companyId: string) {
    const next = new Set(historyOpen);
    if (next.has(companyId)) next.delete(companyId);
    else {
      next.add(companyId);
      if (!history[companyId]?.items) loadHistory(companyId);
    }
    setHistoryOpen(next);
  }

  function commitHeld(next: Record<string, string[]>) {
    heldRef.current = next;
    setHeld(next);
  }
  function addHeld(companyId: string, contactId: string) {
    const ids = heldRef.current[companyId] ?? [];
    if (!ids.includes(contactId)) commitHeld({ ...heldRef.current, [companyId]: [...ids, contactId] });
  }
  function dropHeld(companyId: string, contactId?: string) {
    const ids = heldRef.current[companyId] ?? [];
    commitHeld({ ...heldRef.current, [companyId]: contactId ? ids.filter((id) => id !== contactId) : [] });
  }

  // Let go of everything held when leaving the page (else it is free after 30 minutes).
  const releaseRef = useRef(actions.release);
  useEffect(() => {
    releaseRef.current = actions.release;
  }, [actions.release]);
  useEffect(() => {
    return () => {
      for (const ids of Object.values(heldRef.current)) for (const id of ids) void releaseRef.current(id);
    };
  }, []);

  /** Holds a contact for me; false (with the reason on the row) when somebody else has it. */
  async function hold(companyId: string, contactId: string): Promise<boolean> {
    if (heldRef.current[companyId]?.includes(contactId)) return true;
    const result = await actions.claim(contactId);
    if (!result.ok) {
      setRowError((e) => ({ ...e, [companyId]: result.error }));
      return false;
    }
    setRowError((e) => ({ ...e, [companyId]: "" }));
    addHeld(companyId, contactId);
    return true;
  }

  /** For changes to contacts: the company needs one held contact, no matter which. */
  async function holdAny(companyId: string, contactId: string): Promise<boolean> {
    if ((heldRef.current[companyId]?.length ?? 0) > 0) return true;
    return hold(companyId, contactId);
  }

  function replaceRow(row: SheetCompanyRow | null) {
    if (row) setRows((all) => all.map((r) => (r.companyId === row.companyId ? row : r)));
  }

  function toggle(row: SheetCompanyRow) {
    const next = new Set(open);
    if (next.has(row.companyId)) {
      next.delete(row.companyId);
      for (const id of heldRef.current[row.companyId] ?? []) void actions.release(id);
      dropHeld(row.companyId);
    } else {
      next.add(row.companyId);
      // Opening a row holds its first contact, like the call screen does.
      startTransition(async () => void (await hold(row.companyId, row.leadContactId)));
    }
    setOpen(next);
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        matchesSheetFilter(r, filter, today) &&
        (!q ||
          [r.company, r.openingLine, r.roles.join(" "), r.lastNote, r.lastBy, ...r.contacts.flatMap((c) => [c.contact, c.title, c.email])].some((v) =>
            v?.toLowerCase().includes(q),
          )),
    );
  }, [rows, search, filter, today]);
  const counts = useMemo(
    () => Object.fromEntries(sheetFilters.map((f) => [f.value, rows.filter((r) => matchesSheetFilter(r, f.value, today)).length])) as Record<SheetFilter, number>,
    [rows, today],
  );

  const dialogRow = dialog ? rows.find((r) => r.companyId === dialog.companyId) : undefined;
  const dialogContact = dialogRow?.contacts.find((c) => c.contactId === dialog?.contactId);

  function save(fields: OutcomeFields) {
    if (!dialogRow || !dialogContact) return;
    const row = dialogRow;
    const contact = dialogContact;
    setSaveError(undefined);
    if (fields.outcome === "meeting_planned" && booking) {
      // Opened in the click on Save, so the browser allows the new tab.
      const url = buildSalesBookingUrl(booking.base, {
        name: contact.contact,
        email: contact.email,
        notes: [row.company, fields.meetingReason?.trim()].filter(Boolean).join(": "),
        contactId: contact.contactId,
        companyId: row.companyId,
        callerId: booking.callerId,
      });
      window.open(url, "_blank", "noopener");
    }
    startTransition(async () => {
      if (!(await hold(row.companyId, contact.contactId))) {
        setSaveError("Someone else has this contact open. Try again in a few minutes.");
        return;
      }
      const result = await actions.log({ ...fields, contactId: contact.contactId, note: fields.note?.trim() || null });
      if (!result.ok) {
        // Not saved: the window stays open and shows what is wrong.
        setSaveError(result.error);
        return;
      }
      // The database let go of the contact with the outcome.
      dropHeld(row.companyId, contact.contactId);
      replaceRow(result.row);
      setNotes((n) => ({ ...n, [row.companyId]: "" }));
      setDialog(null);
      if (historyOpen.has(row.companyId)) loadHistory(row.companyId);
      else setHistory((h) => omit(h, row.companyId));
      if (undoToast.current !== null) dismissToast(undoToast.current);
      const activityId = result.activityId;
      undoToast.current = toast(`Saved: ${result.outcome} (${contact.contact}, attempt ${result.attempts})`, {
        duration: UNDO_MS,
        action: activityId ? { label: "Undo", onClick: () => undo(activityId, row.companyId) } : undefined,
      });
    });
  }

  function undo(activityId: string, companyId: string) {
    startTransition(async () => {
      const result = await actions.undo(activityId);
      if (!result.ok) {
        toast(result.error, { tone: "error" });
        return;
      }
      // sales_undo_call holds the contact again.
      addHeld(companyId, result.contactId);
      replaceRow(result.row);
      if (historyOpen.has(companyId)) loadHistory(companyId);
      toast("Undone: the call is open again.", { tone: "info", duration: 4000 });
    });
  }

  function press(row: SheetCompanyRow, contact: SheetRow, outcome: CallOutcome) {
    if (pending) return;
    setSaveError(undefined);
    const target: Dialog = { companyId: row.companyId, contactId: contact.contactId, outcome };
    if (needsFollowUp(outcome)) {
      // Hold the contact now, so nobody else opens it while the window is filled in.
      startTransition(async () => {
        if (await hold(row.companyId, contact.contactId)) setDialog(target);
      });
      return;
    }
    // No answer saves at once, with the note typed in the row.
    startTransition(async () => {
      if (!(await hold(row.companyId, contact.contactId))) return;
      const result = await actions.log({ outcome, contactId: contact.contactId, note: notes[row.companyId]?.trim() || null });
      if (!result.ok) {
        setRowError((e) => ({ ...e, [row.companyId]: result.error }));
        return;
      }
      setRowError((e) => ({ ...e, [row.companyId]: "" }));
      dropHeld(row.companyId, contact.contactId);
      replaceRow(result.row);
      setNotes((n) => ({ ...n, [row.companyId]: "" }));
      if (historyOpen.has(row.companyId)) loadHistory(row.companyId);
      else setHistory((h) => omit(h, row.companyId));
      if (undoToast.current !== null) dismissToast(undoToast.current);
      const activityId = result.activityId;
      undoToast.current = toast(`Saved: ${result.outcome} (${contact.contact}, attempt ${result.attempts})`, {
        duration: UNDO_MS,
        action: activityId ? { label: "Undo", onClick: () => undo(activityId, row.companyId) } : undefined,
      });
    });
  }

  // A change to a contact: the row is loaded again, so every column follows.
  function changeContact(row: SheetCompanyRow, contactId: string, change: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) {
    startTransition(async () => {
      if (!(await holdAny(row.companyId, contactId))) return;
      const result = await change();
      if (!result.ok) {
        setRowError((e) => ({ ...e, [row.companyId]: result.error }));
        return;
      }
      setRowError((e) => ({ ...e, [row.companyId]: "" }));
      const fresh = await actions.reload(row.companyId);
      if (fresh.ok) replaceRow(fresh.row);
      done?.();
    });
  }

  const columns = ["Company", "Phone", "Last outcome", "Attempts", "Call back", "Last note", "Last called by", "Note", "Opening line", "Open roles", "Vacancies", "Days open", "Links", "Status"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search the call list"
          placeholder="Search company, contact, role, note"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setVisible(PAGE);
          }}
          className="h-9 min-w-48 flex-1 rounded-xl border border-border bg-white px-3 text-sm sm:max-w-80"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(sheetToTsv(shown.flatMap((r) => r.contacts)));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          <Copy aria-hidden="true" />
          {copied ? "Copied" : "Copy for Excel"}
        </Button>
        <span className="text-xs text-muted tabular-nums">
          {shown.length} of {rows.length} companies
        </span>
      </div>

      <div role="group" aria-label="Filter" className="flex flex-wrap gap-1.5">
        {sheetFilters.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => {
              setFilter(f.value);
              setVisible(PAGE);
            }}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${
              filter === f.value ? "border-brand-700 bg-brand-700 text-white" : "border-border bg-white text-brand-800 hover:bg-brand-50"
            }`}
          >
            {f.label}
            <span className={`text-xs tabular-nums ${filter === f.value ? "text-white/80" : "text-muted"}`}>{counts[f.value]}</span>
          </button>
        ))}
      </div>

      <div className="max-h-[calc(100dvh-20rem)] min-h-80 overflow-auto rounded-2xl border border-border bg-card shadow-xs">
        <table className="w-max min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-left text-xs font-semibold tracking-wide text-brand-900 uppercase">
            <tr>
              {columns.map((h) => (
                <th key={h} scope="col" className="border-b border-border px-3 py-2 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted">
                  Nobody on this list matches.
                </td>
              </tr>
            )}
            {shown.slice(0, visible).map((r) => {
              const isOpen = open.has(r.companyId);
              const lead = r.contacts.find((c) => c.contactId === r.leadContactId) ?? r.contacts[0];
              const dial = lead ? callNumbers({ phone: lead.ownPhone, phoneWrong: lead.phoneWrong }, r.generalPhone, (n) => dialHref(n, dialTemplate)).dial : null;
              return (
                <Fragment key={r.companyId}>
                  <tr className={`border-b border-border/70 align-top ${r.callable ? "" : "text-muted"} ${isOpen ? "bg-brand-50/40" : ""}`}>
                    <td className="max-w-64 px-3 py-2">
                      <div className="flex items-start gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggle(r)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Fold in" : "Fold out"} the contacts of ${r.company}`}
                          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-brand-700 hover:bg-brand-50"
                        >
                          <ChevronRight className={`size-4 transition ${isOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                        </button>
                        <div className="min-w-0">
                          {leadLinks ? (
                            <Link href={`/dashboard/leads/${r.companyId}`} className="font-medium text-brand-800 hover:underline">
                              {r.company}
                            </Link>
                          ) : (
                            <span className="font-medium text-ink">{r.company}</span>
                          )}
                          <span className="block text-xs text-muted">
                            {r.contacts.length} {r.contacts.length === 1 ? "contact" : "contacts"}
                            {(held[r.companyId]?.length ?? 0) > 0 && <span className="ml-1.5 font-medium text-emerald-700">Held for you</span>}
                          </span>
                          {r.redFlags.length > 0 && (
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-danger" title={r.redFlags.join(" ")}>
                              <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                              <span className="line-clamp-2">{r.redFlags.join(" ")}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {lead && dial ? (
                        <>
                          <a
                            href={dial.href}
                            {...(dialsInBrowser(dial.href) ? { target: "_blank", rel: "noreferrer" } : {})}
                            onClick={() => void hold(r.companyId, lead.contactId)}
                            className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                          >
                            <Phone className="size-3.5" aria-hidden="true" />
                            {dial.number}
                          </a>
                          <span className="block text-xs text-muted">
                            {lead.contact}
                            {dial.kind === "general" ? ", general number" : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted">No number</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {r.lastOutcome ? (
                        <>
                          <Badge tone={lastOutcomeTone(r.lastOutcome)}>{outcomeName(r.lastOutcome)}</Badge>
                          {r.lastOutcomeAt && <span className="mt-0.5 block text-muted">{formatDate(r.lastOutcomeAt)}</span>}
                        </>
                      ) : (
                        <span className="text-muted">Not called</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.attempts}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {r.callbackAt ? (
                        <>
                          {formatDate(r.callbackAt)}
                          {r.nextAction?.startsWith("Call back") && <span className="block max-w-48 truncate text-muted">{r.nextAction}</span>}
                        </>
                      ) : null}
                    </td>
                    <td className="max-w-64 px-3 py-2 text-xs whitespace-pre-line">
                      <span className="line-clamp-3">{r.lastNote ?? ""}</span>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.lastBy ?? ""}</td>
                    <td className="min-w-52 px-3 py-2">
                      <Textarea
                        rows={1}
                        maxLength={5000}
                        aria-label={`Note for ${r.company}`}
                        placeholder="Note, saved with the next outcome"
                        value={notes[r.companyId] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.companyId]: e.target.value }))}
                        className="min-h-9 text-xs"
                      />
                    </td>
                    <td className="max-w-80 px-3 py-2 text-xs whitespace-pre-line">{r.openingLine ?? ""}</td>
                    <td className="max-w-64 px-3 py-2 text-xs">{r.roles.join(", ")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.vacancyCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.daysOpen ?? ""}</td>
                    <td className="max-w-56 px-3 py-2 text-xs">
                      <ul className="space-y-0.5">
                        {r.links.map((l) => (
                          <li key={`${l.label}-${l.url}`}>
                            <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                              <span className="max-w-44 truncate">{l.label}</span>
                              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.callable ? <Badge tone="success">Can call now</Badge> : <Badge>Not now</Badge>}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border bg-brand-50/20">
                      <td colSpan={columns.length} className="p-0">
                        {/* Sticky to the left edge, so the contacts stay in view while the sheet scrolls sideways. */}
                        <div className="sticky left-0 w-[min(100%,72rem)] space-y-3 px-4 py-3">
                          <ContactsPanel
                            row={r}
                            dialTemplate={dialTemplate}
                            outcomes={outcomes}
                            pending={pending}
                            error={rowError[r.companyId]}
                            held={held[r.companyId]}
                            actions={actions.contacts}
                            onPress={(contact, outcome) => press(r, contact, outcome)}
                            onHold={(contactId) => void hold(r.companyId, contactId)}
                            onChange={(contactId, change, done) => changeContact(r, contactId, change, done)}
                          />
                          <HistoryPanel
                            open={historyOpen.has(r.companyId)}
                            state={history[r.companyId]}
                            onToggle={() => toggleHistory(r.companyId)}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length > visible && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" onClick={() => setVisible((v) => v + PAGE)}>
            Show more ({shown.length - visible} left)
          </Button>
        </div>
      )}
      <p className="text-xs text-muted">
        Open a company to see its contacts and pick an outcome: the same windows and rules as the{" "}
        <Link href={callHref} className="font-medium text-brand-600 hover:underline">
          call screen
        </Link>
        . A company you open or call is held for you, so nobody else calls it for 30 minutes.
      </p>

      <OutcomeDialog
        outcome={dialog?.outcome ?? null}
        outcomeLabel={outcomes.find((o) => o.value === dialog?.outcome)?.label ?? labelOf(callOutcomes, dialog?.outcome ?? "no_answer")}
        contactName={dialogContact?.contact ?? ""}
        companyName={dialogRow?.company ?? ""}
        options={options}
        initialNote={dialogRow ? (notes[dialogRow.companyId] ?? "") : ""}
        placement="side"
        pending={pending}
        error={saveError}
        onSave={save}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  void _removed;
  return rest;
}

/** The contacts of one company, each with number, status, outcome buttons and the contact actions. */
function ContactsPanel({
  row,
  dialTemplate,
  outcomes,
  pending,
  error,
  held,
  actions,
  onPress,
  onHold,
  onChange,
}: {
  row: SheetCompanyRow;
  dialTemplate: string | null;
  outcomes: OutcomeButton[];
  pending: boolean;
  error?: string;
  held?: string[];
  actions: ContactActions;
  onPress: (contact: SheetRow, outcome: CallOutcome) => void;
  onHold: (contactId: string) => void;
  onChange: (contactId: string, change: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand-900">Contacts</h3>
        <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)} aria-expanded={adding} disabled={pending}>
          <UserPlus aria-hidden="true" />
          Add contact
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-1.5 text-sm text-danger">
          {error}
        </p>
      )}
      {adding && (
        <PersonForm
          idPrefix={`sheet-add-${row.companyId}`}
          initial={emptyPerson}
          submitLabel="Add contact"
          pending={pending}
          onCancel={() => setAdding(false)}
          onSubmit={(v) =>
            onChange(
              row.leadContactId,
              async () => {
                const r = await actions.add(row.companyId, v);
                return r.ok ? { ok: true } : r;
              },
              () => setAdding(false),
            )
          }
        />
      )}
      <ul className="space-y-2">
        {row.contacts.map((c) => {
          const { dial, generalDial } = callNumbers({ phone: c.ownPhone, phoneWrong: c.phoneWrong }, c.generalPhone, (n) => dialHref(n, dialTemplate));
          return (
            <li key={c.contactId} className="space-y-2 rounded-xl border border-border bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {c.contact}
                    {c.title && <span className="font-normal text-muted"> · {c.title}</span>}
                  </p>
                  <p className="text-xs text-muted">
                    <Badge>{labelOf(contactStatuses, c.status)}</Badge>
                    {c.callable ? <span className="ml-1.5 font-medium text-emerald-700">Can call now</span> : <span className="ml-1.5">Not now</span>}
                    {held?.includes(c.contactId) && <span className="ml-1.5 font-medium text-emerald-700">Held for you</span>}
                    {c.email && <> · {c.email}</>}
                  </p>
                </div>
                <div className="text-right text-xs text-muted">
                  <p>
                    {c.attempts === 0 ? "Not called" : `${c.attempts} ${c.attempts === 1 ? "attempt" : "attempts"}`}
                    {c.lastAttemptAt ? `, last ${formatDateTime(c.lastAttemptAt)}` : ""}
                  </p>
                  {c.lastOutcome && <p>Last outcome: {outcomeName(c.lastOutcome)}</p>}
                  {c.callbackAt && <p>Call back {formatDate(c.callbackAt)}</p>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                {dial ? (
                  <a
                    href={dial.href}
                    {...(dialsInBrowser(dial.href) ? { target: "_blank", rel: "noreferrer" } : {})}
                    onClick={() => onHold(c.contactId)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-1.5 font-medium text-white hover:bg-brand-800"
                  >
                    <Phone className="size-4" aria-hidden="true" />
                    {dial.number}
                    <span className="text-xs font-normal text-brand-100/80">{dial.kind === "contact" ? "mobile" : "general"}</span>
                  </a>
                ) : (
                  <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">No number to call</span>
                )}
                {generalDial && (
                  <a
                    href={generalDial.href}
                    {...(dialsInBrowser(generalDial.href) ? { target: "_blank", rel: "noreferrer" } : {})}
                    onClick={() => onHold(c.contactId)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-brand-50"
                  >
                    <Phone className="size-3.5 text-brand-600" aria-hidden="true" />
                    {generalDial.number} <span className="text-muted">general</span>
                  </a>
                )}
                <Button size="sm" variant="ghost" onClick={() => setEditing(editing === c.contactId ? null : c.contactId)} aria-expanded={editing === c.contactId} disabled={pending}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
                {c.ownPhone && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      onChange(c.contactId, async () => {
                        const r = await actions.markPhone(c.contactId, !c.phoneWrong);
                        return r.ok ? { ok: true } : r;
                      })
                    }
                  >
                    <PhoneOff aria-hidden="true" />
                    {c.phoneWrong ? "Number is fine" : "Number is wrong"}
                  </Button>
                )}
              </div>
              {c.phoneWrong && c.ownPhone && (
                <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                  The mobile number {c.ownPhone} is marked as wrong, so the call button uses the general number.
                </p>
              )}
              {editing === c.contactId && (
                <PersonForm
                  idPrefix={`sheet-edit-${c.contactId}`}
                  initial={initialOf({
                    id: c.contactId,
                    name: c.contact,
                    firstName: c.firstName,
                    lastName: c.lastName,
                    title: c.title,
                    phone: c.ownPhone,
                    phoneWrong: c.phoneWrong,
                    email: c.email,
                  })}
                  submitLabel="Save contact"
                  pending={pending}
                  onCancel={() => setEditing(null)}
                  onSubmit={(v) =>
                    onChange(
                      c.contactId,
                      async () => {
                        const r = await actions.edit(c.contactId, v);
                        return r.ok ? { ok: true } : r;
                      },
                      () => setEditing(null),
                    )
                  }
                />
              )}

              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Outcome for ${c.contact}`}>
                {outcomes.map((o) => {
                  const tone = callOutcomes.find((x) => x.value === o.value)?.tone ?? "neutral";
                  return (
                    <button
                      key={o.value}
                      type="button"
                      disabled={pending}
                      title={o.description ?? undefined}
                      onClick={() => onPress(c, o.value)}
                      className={`min-h-8 rounded-lg border px-2.5 py-1 text-xs font-semibold transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60 ${outcomeToneClasses[tone]}`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The contact moments of the company, folded out on demand. */
function HistoryPanel({
  open,
  state,
  onToggle,
}: {
  open: boolean;
  state?: { items?: CallTimelineItem[]; error?: string; loading?: boolean };
  onToggle: () => void;
}) {
  return (
    <div className="space-y-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-800 hover:underline">
        <History className="size-4" aria-hidden="true" />
        History
        <ChevronRight className={`size-4 transition ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="rounded-xl border border-border bg-white p-3">
          {state?.loading && !state.items ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Loading the history
            </p>
          ) : state?.error ? (
            <p className="text-sm text-danger">{state.error}</p>
          ) : !state?.items || state.items.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet: no call, mail or meeting is known.</p>
          ) : (
            <ol className="space-y-2">
              {state.items.map((item) => (
                <li key={item.id} className="rounded-lg border border-border px-3 py-2 text-sm">
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
        </div>
      )}
    </div>
  );
}
