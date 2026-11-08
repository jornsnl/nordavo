"use client";

import { useActionState, useEffect, useRef } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Markdown } from "@/components/work/markdown";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { HONEYPOT_FIELD } from "@/lib/forms/answers";
import { fieldName, type Block, type Question } from "@/lib/forms/schema";

export type ApplyState = {
  ok?: boolean;
  error?: string;
  errors?: Record<string, string>;
  /** What was typed, to put back after a failed submit (React resets the form). */
  values?: Record<string, string | string[]>;
  /** Bumped on every submit so inputs remount with the returned values. */
  attempt?: number;
};

type Header = {
  title: string;
  intro: string | null;
  headerImageUrl: string | null;
  logoUrl: string | null;
};

const AUTOCOMPLETE: Partial<Record<NonNullable<Question["mapsTo"]>, string>> = {
  full_name: "name",
  email: "email",
  phone: "tel",
  current_company: "organization",
  location: "address-level2",
};

/** Header image, logo, title and intro of a form. */
export function FormHeader({ title, intro, headerImageUrl, logoUrl }: Header) {
  return (
    <header className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <div className="relative">
        {headerImageUrl ? (
          // Signed, short-lived storage URL: a plain img keeps it out of the image optimiser.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={headerImageUrl} alt="" className="h-40 w-full object-cover sm:h-52" />
        ) : (
          <div className="h-28 w-full bg-brand-700 sm:h-36" aria-hidden="true" />
        )}
        <div className="absolute -bottom-8 left-5 flex size-16 items-center justify-center overflow-hidden rounded-2xl border-4 border-card bg-card shadow-sm sm:left-8">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" className="size-full object-contain" />
          ) : (
            <LogoMark className="size-full" />
          )}
        </div>
      </div>
      <div className="space-y-3 px-5 pt-12 pb-6 sm:px-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">{title}</h1>
        {intro && <Markdown text={intro} className="text-base" />}
      </div>
    </header>
  );
}

/**
 * The form itself. With an action it submits (public page); without one it
 * is a preview for staff.
 */
export function FormRenderer({
  blocks,
  action,
  prefill,
  submitLabel = "Submit application",
}: {
  blocks: Block[];
  action?: (state: ApplyState, formData: FormData) => Promise<ApplyState>;
  prefill?: Record<string, string> | null;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action ?? (async (s: ApplyState) => s), {} as ApplyState);
  // When the form was first shown, for the minimum fill time (set after hydration, kept across retries).
  const startedAt = useRef(0);
  const startedInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!startedAt.current) startedAt.current = Date.now();
    if (startedInput.current) startedInput.current.value = String(startedAt.current);
  }, [state.attempt]);

  if (state.ok) {
    return (
      <div role="status" className="rounded-2xl border border-emerald-600/20 bg-emerald-50 p-6 text-emerald-900">
        <CheckCircle2 className="mb-3 size-8 text-emerald-700" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold">Thank you, your application is in.</h2>
        <p className="mt-1 text-sm">We review every application and get back to you by email.</p>
      </div>
    );
  }

  const errors = state.errors ?? {};
  const values = state.values ?? {};
  const errorCount = Object.keys(errors).length;

  return (
    <form action={formAction} noValidate className="space-y-6" key={state.attempt ?? 0}>
      {/* Bots fill in every field; people never see this one. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Company website
          <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <input type="hidden" name="started_at" ref={startedInput} defaultValue="" />

      {(state.error || errorCount > 0) && (
        <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
          {state.error ??
            `Please check ${errorCount === 1 ? "one answer" : `${errorCount} answers`} below.${
              blocks.some((b) => b.questions.some((q) => q.type === "file")) ? " Files need to be selected again." : ""
            }`}
        </p>
      )}

      {blocks.map((block) => (
        <section key={block.id} className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-8">
          {(block.title || block.description) && (
            <div className="mb-5 space-y-1">
              {block.title && <h2 className="font-display text-lg font-semibold text-brand-900">{block.title}</h2>}
              {block.description && <Markdown text={block.description} className="text-muted" />}
            </div>
          )}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {block.questions.map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                error={errors[q.id]}
                value={values[fieldName(q.id)] ?? (q.mapsTo ? prefill?.[q.mapsTo] : undefined)}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">
          Fields marked <span className="text-danger">*</span> are required. We only use your details for this and similar roles.
        </p>
        <Button type="submit" disabled={pending || !action} aria-busy={pending} className="sm:min-w-48">
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {action ? (pending ? "Sending…" : submitLabel) : "Preview: submitting is off"}
        </Button>
      </div>
    </form>
  );
}

function QuestionField({ question: q, error, value }: { question: Question; error?: string; value?: string | string[] }) {
  const name = fieldName(q.id);
  const id = `field-${q.id}`;
  const describedBy = [q.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const text = typeof value === "string" ? value : "";
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const common = { id, name, "aria-invalid": !!error, "aria-describedby": describedBy, "aria-required": q.required };
  const isGroup = q.type === "multiple_choice" || q.type === "yes_no" || (q.type === "single_choice" && (q.options?.length ?? 0) <= 5);

  let control;
  switch (q.type) {
    case "long_text":
      control = <Textarea {...common} rows={5} defaultValue={text} maxLength={5000} />;
      break;
    case "email":
      control = <Input {...common} type="email" inputMode="email" autoComplete="email" defaultValue={text} maxLength={320} />;
      break;
    case "phone":
      control = <Input {...common} type="tel" inputMode="tel" autoComplete="tel" defaultValue={text} maxLength={25} />;
      break;
    case "url":
      control = <Input {...common} type="text" inputMode="url" placeholder="https://" defaultValue={text} maxLength={1000} />;
      break;
    case "number":
      control = <Input {...common} type="text" inputMode="decimal" defaultValue={text} maxLength={20} />;
      break;
    case "current_ctc":
    case "expected_ctc":
      control = <Input {...common} type="text" inputMode="numeric" placeholder="For example 1200000 or 12 LPA" defaultValue={text} maxLength={40} />;
      break;
    case "hourly_rate":
      control = <Input {...common} type="text" inputMode="numeric" placeholder="Rupees per hour, for example 800" defaultValue={text} maxLength={40} />;
      break;
    case "file":
      control = (
        <Input
          {...common}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
        />
      );
      break;
    case "single_choice":
      control =
        (q.options?.length ?? 0) <= 5 ? (
          <ChoiceList q={q} type="radio" selected={list} describedBy={describedBy} />
        ) : (
          <Select {...common} defaultValue={text}>
            <option value="">Choose…</option>
            {q.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        );
      break;
    case "multiple_choice":
      control = <ChoiceList q={q} type="checkbox" selected={list} describedBy={describedBy} />;
      break;
    case "yes_no":
      control = (
        <ChoiceList q={{ ...q, options: ["yes", "no"] }} labels={{ yes: "Yes", no: "No" }} type="radio" selected={list} describedBy={describedBy} inline />
      );
      break;
    default:
      control = (
        <Input
          {...common}
          type="text"
          autoComplete={q.mapsTo ? AUTOCOMPLETE[q.mapsTo] : undefined}
          defaultValue={text}
          maxLength={300}
        />
      );
  }

  const label = (
    <>
      {q.label}
      {q.required && (
        <span className="ml-0.5 text-danger" aria-hidden="true">
          *
        </span>
      )}
    </>
  );

  return (
    <div className={`space-y-1.5 ${q.width === "half" ? "" : "sm:col-span-2"}`}>
      {isGroup ? (
        <fieldset aria-describedby={describedBy} aria-invalid={!!error} className="space-y-1.5">
          <legend className="block text-sm font-medium text-ink">{label}</legend>
          {q.help && <Help id={`${id}-help`} text={q.help} />}
          {control}
        </fieldset>
      ) : (
        <>
          <label htmlFor={id} className="block text-sm font-medium text-ink">
            {label}
          </label>
          {q.help && <Help id={`${id}-help`} text={q.help} />}
          {control}
        </>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Help({ id, text }: { id: string; text: string }) {
  return (
    <div id={id} className="text-xs text-muted">
      <Markdown text={text} className="text-xs! text-muted!" />
    </div>
  );
}

function ChoiceList({
  q,
  type,
  selected,
  labels,
  inline,
  describedBy,
}: {
  q: Question;
  type: "radio" | "checkbox";
  selected: string[];
  labels?: Record<string, string>;
  inline?: boolean;
  describedBy?: string;
}) {
  return (
    <div className={inline ? "flex flex-wrap gap-2" : "grid gap-2 sm:grid-cols-2"}>
      {q.options?.map((option) => (
        <label
          key={option}
          className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-ink transition hover:border-brand-200 has-checked:border-brand-500 has-checked:bg-brand-50 pointer-coarse:min-h-11"
        >
          <input
            type={type}
            name={fieldName(q.id)}
            value={option}
            defaultChecked={selected.includes(option)}
            aria-describedby={describedBy}
            className="size-4 accent-brand-700"
          />
          {labels?.[option] ?? option}
        </label>
      ))}
    </div>
  );
}
