"use client";

import { useActionState } from "react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import type { BookingLink } from "@/lib/sales/booking";
import { addBookingLink, deleteBookingLink, updateBookingLink } from "@/app/dashboard/settings/booking-actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * The Cal.com links for sales meetings (Settings, General, admin). Callers send a lead
 * to this link from Meeting planned and the Agenda button; with more than one link they
 * pick who the meeting is with. The two question names say where Cal.com puts the company
 * and the role in its form (the identifier of the booking question).
 */
export function SalesBookingLinks({ links }: { links: BookingLink[] }) {
  return (
    <div className="space-y-6">
      {links.length === 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No link yet, so the call screen has no agenda. Add the link of the Cal.com event leads book a meeting on.
        </p>
      )}
      {links.map((l) => (
        <LinkForm key={`${l.id}:${l.url}:${l.label}`} link={l} />
      ))}
      <div className="border-t border-border pt-5">
        <p className="mb-3 text-sm font-medium text-ink">{links.length === 0 ? "Add the link" : "Add another link (for example for a colleague)"}</p>
        <LinkForm />
      </div>
    </div>
  );
}

function LinkForm({ link }: { link?: BookingLink }) {
  const action = link ? updateBookingLink.bind(null, link.id) : addBookingLink;
  const [state, formAction] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};
  const id = link?.id ?? "new";
  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-4" noValidate>
        <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Who the meeting is with" htmlFor={`bl-label-${id}`} error={errors.label}>
            <Input id={`bl-label-${id}`} name="label" maxLength={60} placeholder="Julius" defaultValue={link?.label ?? ""} />
          </Field>
          <Field label="Cal.com link" htmlFor={`bl-url-${id}`} error={errors.url}>
            <Input
              id={`bl-url-${id}`}
              name="url"
              type="url"
              inputMode="url"
              placeholder="https://cal.com/nordavo-support-jwoop2/kennismaking"
              defaultValue={link?.url ?? ""}
            />
          </Field>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">Prefill: names of the Cal.com questions</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field
              label="Company question"
              htmlFor={`bl-company-${id}`}
              error={errors.company_field}
              hint="The identifier of the question Bedrijfsnaam in the Cal.com event (Advanced, Booking questions)."
            >
              <Input id={`bl-company-${id}`} name="company_field" defaultValue={link?.companyField ?? "bedrijfsnaam"} />
            </Field>
            <Field
              label="Role question"
              htmlFor={`bl-role-${id}`}
              error={errors.role_field}
              hint="The identifier of Welke rol zoek je? It is filled with the open vacancies of the company."
            >
              <Input id={`bl-role-${id}`} name="role_field" defaultValue={link?.roleField ?? "welke-rol-zoek-je"} />
            </Field>
          </div>
        </details>
        <div className="flex justify-end max-sm:*:w-full">
          <SubmitButton pendingLabel="Saving">{link ? "Save link" : "Add link"}</SubmitButton>
        </div>
      </form>
      {link && <RemoveLink id={link.id} />}
    </div>
  );
}

function RemoveLink({ id }: { id: string }) {
  const [state, formAction] = useActionState<ActionState>(deleteBookingLink.bind(null, id), initialActionState);
  return (
    <form action={formAction} className="flex justify-end">
      {state.error && <p className="mr-3 self-center text-xs text-danger">{state.error}</p>}
      <Button type="submit" variant="ghost" size="sm">
        Remove this link
      </Button>
    </form>
  );
}
