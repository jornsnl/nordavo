"use client";

import { useState, useTransition, type ReactNode } from "react";
import { BookOpen, ChevronDown, CircleHelp, Mail, PhoneOff, Pencil, ShieldAlert, UserPlus, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { contactStatuses } from "@/lib/labels";
import type { ContactEdit, PersonInput } from "@/lib/sales/call-contacts";
import type { CallCard, CallContactPerson } from "@/lib/sales/call-session";
import { hasPlaceholder } from "@/lib/sales/cheatsheet";
import { labelOf } from "@/lib/sales/labels";

// The parts of the call screen that show what is known about the company and
// let the caller correct the contacts (feedback Julius: contacts, signals,
// red flags, what they do, prio line, cheat sheet). ContactCall in
// call-screen.tsx places them.

export type ContactActions = {
  edit: (contactId: string, input: PersonInput) => Promise<ContactEdit>;
  markPhone: (contactId: string, wrong: boolean) => Promise<ContactEdit>;
  add: (companyId: string, input: PersonInput) => Promise<ContactEdit>;
};

type Other = CallCard["others"][number];

/** The contacts of the card as the caller changes them on the screen. */
export function usePeople(card: CallCard) {
  const [main, setMain] = useState<CallContactPerson>(card.contact);
  const [others, setOthers] = useState<Other[]>(card.others);
  const general = card.company.generalPhone;

  function apply(person: CallContactPerson, created = false) {
    if (person.id === main.id) {
      setMain(person);
      return;
    }
    const known = others.some((o) => o.id === person.id);
    if (known) {
      setOthers((list) => list.map((o) => (o.id === person.id ? { ...o, ...person } : o)));
    } else if (created) {
      const status = labelOf(contactStatuses, person.phone ? "new" : "enrich");
      setOthers((list) => [...list, { ...person, status, generalPhone: general }]);
    }
  }
  return { main, others, apply };
}

export const emptyPerson = { firstName: "", lastName: "", title: "", phone: "", email: "" };

export function PersonForm({
  idPrefix,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  idPrefix: string;
  initial: typeof emptyPerson;
  submitLabel: string;
  onSubmit: (value: typeof emptyPerson) => void;
  onCancel: () => void;
  pending: boolean;
  error?: string;
}) {
  const [v, setV] = useState(initial);
  const set = (key: keyof typeof emptyPerson) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  return (
    <form
      className="grid gap-3 rounded-xl border border-border bg-surface/50 p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <Field label="First name" htmlFor={`${idPrefix}-first`}>
        <Input id={`${idPrefix}-first`} value={v.firstName} maxLength={100} autoComplete="off" onChange={set("firstName")} />
      </Field>
      <Field label="Last name" htmlFor={`${idPrefix}-last`}>
        <Input id={`${idPrefix}-last`} value={v.lastName} maxLength={100} autoComplete="off" onChange={set("lastName")} />
      </Field>
      <Field label="Job title" htmlFor={`${idPrefix}-title`}>
        <Input id={`${idPrefix}-title`} value={v.title} maxLength={200} autoComplete="off" onChange={set("title")} />
      </Field>
      <Field label="Mobile number" htmlFor={`${idPrefix}-phone`}>
        <Input id={`${idPrefix}-phone`} type="tel" inputMode="tel" value={v.phone} maxLength={50} autoComplete="off" onChange={set("phone")} />
      </Field>
      <Field label="Mail" htmlFor={`${idPrefix}-email`} className="sm:col-span-2">
        <Input id={`${idPrefix}-email`} type="email" value={v.email} maxLength={320} autoComplete="off" onChange={set("email")} />
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <FormMessage error={error} />
      </div>
    </form>
  );
}

export function initialOf(p: CallContactPerson) {
  return { firstName: p.firstName ?? "", lastName: p.lastName ?? "", title: p.title ?? "", phone: p.phone ?? "", email: p.email ?? "" };
}

/** The contact on the screen: name, job title, status, mail, with edit and the wrong number mark. */
export function MainContact({
  person,
  status,
  apply,
  actions,
}: {
  person: CallContactPerson;
  status: string;
  apply: (p: CallContactPerson) => void;
  actions?: ContactActions;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function save(v: typeof emptyPerson) {
    if (!actions) return;
    setError(undefined);
    start(async () => {
      const r = await actions.edit(person.id, v);
      if (r.ok) {
        apply(r.person);
        setEditing(false);
      } else setError(r.error);
    });
  }

  function mark(wrong: boolean) {
    if (!actions) return;
    setError(undefined);
    start(async () => {
      const r = await actions.markPhone(person.id, wrong);
      if (r.ok) apply(r.person);
      else setError(r.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink">{person.name}</p>
          <p className="text-sm text-muted">
            {[person.title, status].filter(Boolean).join(" · ")}
            {person.email && <> · {person.email}</>}
          </p>
        </div>
        {actions && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)} aria-expanded={editing} disabled={pending}>
              <Pencil aria-hidden="true" />
              Edit contact
            </Button>
            {person.phone && (
              <Button size="sm" variant="secondary" onClick={() => mark(!person.phoneWrong)} disabled={pending}>
                <PhoneOff aria-hidden="true" />
                {person.phoneWrong ? "Number is fine" : "Number is wrong"}
              </Button>
            )}
          </div>
        )}
      </div>
      {person.phoneWrong && person.phone && (
        <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
          The mobile number {person.phone} is marked as wrong, so the call button uses the general number. Edit the contact to enter a new number.
        </p>
      )}
      {editing && (
        <PersonForm
          idPrefix={`edit-${person.id}`}
          initial={initialOf(person)}
          submitLabel="Save contact"
          onSubmit={save}
          onCancel={() => {
            setEditing(false);
            setError(undefined);
          }}
          pending={pending}
          error={error}
        />
      )}
      {!editing && error && <FormMessage error={error} />}
    </div>
  );
}

/** The other contacts of the company, each with the general number as a fallback, with edit and add. */
export function OtherContacts({
  companyId,
  others,
  apply,
  actions,
  icon,
}: {
  companyId: string;
  others: Other[];
  apply: (p: CallContactPerson, created?: boolean) => void;
  actions?: ContactActions;
  icon: ReactNode;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function save(id: string | null, v: typeof emptyPerson) {
    if (!actions) return;
    setError(undefined);
    start(async () => {
      const r = id ? await actions.edit(id, v) : await actions.add(companyId, v);
      if (r.ok) {
        apply(r.person, !id);
        setEditing(null);
        setAdding(false);
      } else setError(r.error);
    });
  }

  function mark(o: Other) {
    if (!actions) return;
    setError(undefined);
    start(async () => {
      const r = await actions.markPhone(o.id, !o.phoneWrong);
      if (r.ok) apply(r.person);
      else setError(r.error);
    });
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            {icon}
            Other contacts
          </span>
        }
        actions={
          actions && (
            <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)} aria-expanded={adding} disabled={pending}>
              <UserPlus aria-hidden="true" />
              Add contact
            </Button>
          )
        }
      />
      <CardBody className="space-y-3">
        {adding && (
          <PersonForm
            idPrefix={`add-${companyId}`}
            initial={emptyPerson}
            submitLabel="Add contact"
            onSubmit={(v) => save(null, v)}
            onCancel={() => {
              setAdding(false);
              setError(undefined);
            }}
            pending={pending}
            error={error}
          />
        )}
        {others.length === 0 ? (
          <p className="text-sm text-muted">No other contacts at this company.</p>
        ) : (
          <ul className="divide-y divide-border">
            {others.map((o) => (
              <li key={o.id} className="space-y-2 py-2 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{o.name}</span>
                    {o.title && <span className="text-muted"> · {o.title}</span>}
                    {o.email && (
                      <span className="block text-xs text-muted">
                        <Mail className="mr-1 inline size-3" aria-hidden="true" />
                        {o.email}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge>{o.status}</Badge>
                    {actions && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(editing === o.id ? null : o.id)} aria-expanded={editing === o.id} disabled={pending}>
                        <Pencil aria-hidden="true" />
                        Edit
                      </Button>
                    )}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {o.phone ? (
                    <>
                      Mobile <span className={o.phoneWrong ? "line-through" : "text-ink"}>{o.phone}</span>
                      {o.phoneWrong ? " (marked wrong)" : ""}
                      {actions && (
                        <button type="button" className="ml-2 font-medium text-brand-600 hover:underline" onClick={() => mark(o)} disabled={pending}>
                          {o.phoneWrong ? "Number is fine" : "Number is wrong"}
                        </button>
                      )}
                    </>
                  ) : (
                    "No mobile number"
                  )}
                  {o.generalPhone && (
                    <>
                      {" · "}General {o.generalPhone}
                    </>
                  )}
                </p>
                {editing === o.id && (
                  <PersonForm
                    idPrefix={`edit-${o.id}`}
                    initial={initialOf(o)}
                    submitLabel="Save contact"
                    onSubmit={(v) => save(o.id, v)}
                    onCancel={() => {
                      setEditing(null);
                      setError(undefined);
                    }}
                    pending={pending}
                    error={error}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {!adding && editing === null && error && <FormMessage error={error} />}
      </CardBody>
    </Card>
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

/** Prio next to the company name, with what it means and one line why. */
export function PrioLine({ prio }: { prio: NonNullable<CallCard["company"]["prioInfo"]> }) {
  return (
    <p className="mt-1 text-sm text-muted">
      {prio.meaning && <span className="font-medium text-ink">{prio.label}: {prio.meaning} </span>}
      {prio.line}
    </p>
  );
}

/** The signals of the company, strongest first, each with its kind, date and source. */
export function SignalsSection({ signals }: { signals: CallCard["signals"] }) {
  return (
    <Section title="Signals" icon={<Zap className="size-4" aria-hidden="true" />}>
      {signals.length === 0 ? (
        <p className="text-sm text-muted">No signals known.</p>
      ) : (
        <ul className="divide-y divide-border">
          {signals.map((s, i) => (
            <li key={`${s.id}-${s.type}`} className="space-y-0.5 py-2 text-sm first:pt-0 last:pb-0">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={i === 0 ? "success" : "neutral"}>{s.label}</Badge>
                {i === 0 && <span className="text-xs font-medium text-emerald-700">Strongest</span>}
                {s.detail && <span className="font-medium text-ink">{s.detail}</span>}
              </p>
              <p className="text-xs text-muted">
                {[
                  s.date ? formatDate(`${s.date}T12:00:00Z`) : "No date",
                  s.days !== null ? `${s.days} days open` : null,
                  s.source,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {s.url && (
                  <>
                    {" · "}
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                      Open source
                    </a>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Real red flags in whole sentences; nothing is shown when there are none. */
export function RedFlagsSection({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <Section title="Red flags" icon={<ShieldAlert className="size-4 text-danger" aria-hidden="true" />}>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink marker:text-danger">
        {flags.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </Section>
  );
}

/** Objections the company may raise, each with the answer. */
export function ObjectionsSection({ items }: { items: CallCard["company"]["objections"] }) {
  if (items.length === 0) return null;
  return (
    <Section title="Objection and answer" icon={<ShieldAlert className="size-4" aria-hidden="true" />}>
      <ul className="space-y-3">
        {items.map((o, i) => (
          <li key={`${i}-${o.objection}`} className="space-y-1 text-sm">
            {o.objection && (
              <p>
                <span className="font-medium text-ink">Objection: </span>
                {o.objection}
              </p>
            )}
            {o.answer && (
              <p>
                <span className="font-medium text-ink">Answer: </span>
                {o.answer}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The question to ask in the conversation. */
export function QuestionsSection({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Section title="Talking points" icon={<CircleHelp className="size-4" aria-hidden="true" />}>
      <ul className="space-y-1.5 text-sm text-ink">
        {items.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
    </Section>
  );
}

/** The foldable cheat sheet: USPs, price indication, starter fee, trade-off, meeting days. Text is edited in Settings. */
export function CheatSheet({ sections }: { sections: CallCard["cheatsheet"] }) {
  if (sections.length === 0) return null;
  return (
    <Card>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-5 py-3 font-display text-base font-semibold text-brand-900 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <BookOpen className="size-4" aria-hidden="true" />
            Cheat sheet
          </span>
          <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-4 border-t border-border px-5 py-4">
          {sections.map((s) => (
            <div key={s.key} className="space-y-1">
              <p className="text-sm font-semibold text-ink">
                {s.title}
                {s.draft && hasPlaceholder(s.body) && <span className="ml-2 text-xs font-normal text-amber-700">to fill in</span>}
              </p>
              <p className="text-sm whitespace-pre-line text-ink/90">{s.body}</p>
            </div>
          ))}
        </div>
      </details>
    </Card>
  );
}
