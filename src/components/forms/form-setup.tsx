"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Briefcase, Copy, ImagePlus, LoaderCircle, RefreshCw, Trash2, UserRoundSearch } from "lucide-react";
import {
  createFormAction,
  removeFormImage,
  rotateFormLink,
  uploadFormImage,
} from "@/app/dashboard/vacancies/[id]/form/actions";
import type { ActionState } from "@/lib/action-state";
import type { CopySource } from "@/lib/forms/data";
import { CopyButton } from "@/components/talent/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Select } from "@/components/ui/field";

/** No form yet: start from a template or copy one from another vacancy. */
export function CreateFormPanel({ vacancyId, sources }: { vacancyId: string; sources: CopySource[] }) {
  const [state, setState] = useState<ActionState>({});
  const [copyFrom, setCopyFrom] = useState(sources[0]?.vacancyId ?? "");
  const [pending, startTransition] = useTransition();

  function run(source: Parameters<typeof createFormAction>[1]) {
    startTransition(async () => setState(await createFormAction(vacancyId, source)));
  }

  return (
    <Card>
      <CardHeader title="Create the application form" description="Start from a template or copy the form of an earlier vacancy, then edit it." />
      <CardBody className="space-y-5">
        <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TemplateButton
            icon={<Briefcase aria-hidden="true" />}
            title="Fulltime role"
            text="Details, technical background, CV and video, current and expected CTC per year, notice period, relocation."
            disabled={pending}
            onClick={() => run({ template: "fulltime" })}
          />
          <TemplateButton
            icon={<UserRoundSearch aria-hidden="true" />}
            title="Freelance role"
            text="Personal information, experience and tools, a project example, hourly rate with a budget check, CV and video."
            disabled={pending}
            onClick={() => run({ template: "freelance" })}
          />
        </div>
        {sources.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end">
            <Field label="Copy from another vacancy" htmlFor="copy-from" className="flex-1">
              <Select id="copy-from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.vacancyId} value={s.vacancyId}>
                    {s.vacancyTitle}: {s.formTitle} ({s.questions} questions)
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="secondary" disabled={pending || !copyFrom} onClick={() => run({ copyFrom })}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Copy aria-hidden="true" />}
              Copy form
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function TemplateButton({ icon, title, text, onClick, disabled }: { icon: ReactNode; title: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-start gap-2 rounded-xl border border-border bg-white p-4 text-left transition hover:border-brand-200 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60 [&_svg]:size-5 [&_svg]:text-brand-700"
    >
      {icon}
      <span className="font-display font-semibold text-brand-900">{title}</span>
      <span className="text-sm text-muted">{text}</span>
    </button>
  );
}

/** The general link and the headhunted link of the form. */
export function FormLinks({
  formId,
  publicUrl,
  headhuntedUrl,
  published,
}: {
  formId: string;
  publicUrl: string;
  headhuntedUrl: string;
  published: boolean;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  function rotate(kind: "public" | "headhunted") {
    if (!window.confirm("Make a new link? The current link stops working right away.")) return;
    startTransition(async () => setState(await rotateFormLink(formId, kind)));
  }

  return (
    <Card>
      <CardHeader
        title="Links"
        description={published ? "Share these links. Personal links per candidate are made when you send the form." : "Publish the form first; until then the links show that the form is closed."}
      />
      <CardBody className="space-y-4">
        <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
        <LinkRow
          label="General link"
          hint="For job boards and posts. Applicants are matched by email or phone; new people start in Sourced."
          url={publicUrl}
          onRotate={() => rotate("public")}
          disabled={pending}
        />
        <LinkRow
          label="Headhunted link"
          hint="For people we approached ourselves. Whoever fills in via this link is marked headhunted."
          url={headhuntedUrl}
          onRotate={() => rotate("headhunted")}
          disabled={pending}
        />
      </CardBody>
    </Card>
  );
}

function LinkRow({ label, hint, url, onRotate, disabled }: { label: string; hint: string; url: string; onRotate: () => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="flex items-center gap-1 rounded-xl border border-border bg-surface/60 py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate text-xs text-ink">{url}</code>
        <CopyButton text={url} label={label.toLowerCase()} />
        <Button variant="ghost" size="sm" onClick={onRotate} disabled={disabled} aria-label={`New ${label.toLowerCase()}`} title="Make a new link">
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

/** Header image and logo, stored privately in the attachments bucket. */
export function FormImages({ formId, headerUrl, logoUrl }: { formId: string; headerUrl: string | null; logoUrl: string | null }) {
  return (
    <Card>
      <CardHeader title="Header image and logo" description="PNG, JPG or WebP, at most 3 MB. Without a header image the form shows a Nordavo blue band." />
      <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ImageSlot formId={formId} kind="header" label="Header image" url={headerUrl} />
        <ImageSlot formId={formId} kind="logo" label="Logo" url={logoUrl} />
      </CardBody>
    </Card>
  );
}

function ImageSlot({ formId, kind, label, url }: { formId: string; kind: "header" | "logo"; label: string; url: string | null }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const inputId = `image-${kind}`;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className={`flex items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface/60 ${kind === "header" ? "h-28" : "h-28"}`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className={kind === "header" ? "size-full object-cover" : "max-h-24 max-w-full object-contain"} />
        ) : (
          <span className="text-xs text-muted">None yet</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-white px-3 py-1.5 text-sm font-semibold text-brand-900 shadow-xs hover:bg-brand-50 focus-within:outline-2 focus-within:outline-brand-500 pointer-coarse:min-h-9"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="size-4" aria-hidden="true" />}
          {url ? "Replace" : "Upload"}
          <input
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const data = new FormData();
              data.append("file", file);
              startTransition(async () => setState(await uploadFormImage(formId, kind, data)));
              e.target.value = "";
            }}
          />
        </label>
        {url && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(async () => setState(await removeFormImage(formId, kind)))}>
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        )}
      </div>
      <FormMessage error={state.error} />
    </div>
  );
}
