"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ClipboardList, ExternalLink, LoaderCircle, Lock, Send, TriangleAlert, Unlink } from "lucide-react";
import { saveWorksheet } from "@/app/academy/media-actions";
import { setBlockDocument } from "@/app/dashboard/academy/media-actions";
import { t } from "@/lib/academy/i18n";
import { readWorksheetState } from "@/lib/academy/media/state";
import { type WorksheetAnswers, type WorksheetField, isFilled, missingRequired, normalizeAnswers, normalizeFields } from "@/lib/academy/media/worksheet";
import { formatAcademyDateTime } from "@/lib/academy/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { ActionButton } from "@/components/academy/ui";
import { DocumentPicker } from "@/components/academy/media/document-parts";
import { WorksheetFieldsEditor } from "@/components/academy/media/worksheet-fields-editor";
import { EditorLoading, useBlockDocument } from "./document";
import type { BlockEditorProps, BlockViewerProps } from "./types";

/** Worksheet block editor: pick or create a worksheet and define its fields. */
export function WorksheetEditor({ block, disabled }: BlockEditorProps) {
  const router = useRouter();
  const { doc, loading } = useBlockDocument(block.documentId);
  if (loading) return <EditorLoading />;
  if (!doc) {
    return (
      <DocumentPicker
        kind="worksheet"
        blockId={block.id}
        disabled={disabled}
        onPick={async (id) => {
          await setBlockDocument(block.id, id);
        }}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList className="size-4 text-brand-600" aria-hidden="true" />
        <span className="font-medium text-brand-900">{doc.document.title}</span>
        {doc.uses > 1 && <Badge tone="brand">Used {doc.uses}×</Badge>}
        <Link href={`/dashboard/academy/documents/${doc.document.id}`} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          Answers and settings <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      <WorksheetFieldsEditor key={doc.document.id} documentId={doc.document.id} fields={normalizeFields(doc.document.worksheet_fields)} answered={0} />
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={async () => {
          await setBlockDocument(block.id, null);
          router.refresh();
        }}
      >
        <Unlink aria-hidden="true" />
        Use another worksheet
      </Button>
    </div>
  );
}

type Status = "idle" | "saving" | "saved" | "failed";

/** One field of the worksheet for the learner. */
function FieldInput({
  field,
  value,
  disabled,
  id,
  locale,
  onChange,
}: {
  field: WorksheetField;
  value: WorksheetAnswers[string] | undefined;
  disabled: boolean;
  id: string;
  locale: "nl" | "en";
  onChange: (value: WorksheetAnswers[string] | undefined) => void;
}) {
  const described = field.help ? `${id}-help` : undefined;
  switch (field.type) {
    case "short_text":
      return <Input id={id} value={typeof value === "string" ? value : ""} maxLength={500} disabled={disabled} aria-describedby={described} onChange={(e) => onChange(e.target.value)} />;
    case "long_text":
      return (
        <Textarea id={id} rows={5} value={typeof value === "string" ? value : ""} maxLength={20_000} disabled={disabled} aria-describedby={described} onChange={(e) => onChange(e.target.value)} />
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          value={typeof value === "number" ? value : ""}
          disabled={disabled}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className="sm:w-48"
        />
      );
    case "date":
      return <Input id={id} type="date" value={typeof value === "string" ? value : ""} disabled={disabled} aria-describedby={described} onChange={(e) => onChange(e.target.value || undefined)} className="sm:w-56" />;
    case "choice":
      return field.options.length <= 4 ? (
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="space-y-1.5">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-2.5 text-sm pointer-coarse:min-h-11">
              <input type="radio" name={id} checked={value === option} disabled={disabled} onChange={() => onChange(option)} className="size-4 accent-academy-orange-600" />
              {option}
            </label>
          ))}
        </div>
      ) : (
        <Select id={id} value={typeof value === "string" ? value : ""} disabled={disabled} aria-describedby={described} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{t(locale, "worksheet.choose")}</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case "checkbox":
      if (field.options.length === 0) {
        return (
          <label className="flex items-center gap-2.5 text-sm pointer-coarse:min-h-11">
            <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked ? true : undefined)} className="size-4 accent-academy-orange-600" />
            {t(locale, "worksheet.yes")}
          </label>
        );
      }
      return (
        <div className="space-y-1.5">
          {field.options.map((option) => {
            const list = Array.isArray(value) ? value : [];
            return (
              <label key={option} className="flex items-center gap-2.5 text-sm pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={list.includes(option)}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = e.target.checked ? [...list, option] : list.filter((o) => o !== option);
                    onChange(next.length ? next : undefined);
                  }}
                  className="size-4 accent-academy-orange-600"
                />
                {option}
              </label>
            );
          })}
        </div>
      );
  }
}

/** Worksheet block for the learner: fill in, saved automatically, submit once. */
export function WorksheetViewer({ block, done, state, locale, timeZone, preview }: BlockViewerProps) {
  const router = useRouter();
  const initial = readWorksheetState(state);
  const doc = initial.document;
  const [answers, setAnswers] = useState<WorksheetAnswers>(initial.answers);
  const [submittedAt, setSubmittedAt] = useState(initial.submittedAt);
  const [status, setStatus] = useState<Status>("idle");
  const [missing, setMissing] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(answers);
  const pending = useRef(false);
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(locale, key, vars);
  const locked = Boolean(submittedAt) || preview;

  async function save(value: WorksheetAnswers) {
    if (!doc || preview) return;
    pending.current = false;
    setStatus("saving");
    const result = await saveWorksheet({ documentId: doc.id, answers: value, submit: false });
    if (latest.current !== value) return;
    setStatus(result.ok ? "saved" : "failed");
  }

  // Save what is typed when the page is left before the autosave ran.
  const docId = doc?.id;
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current && docId && !preview) void saveWorksheet({ documentId: docId, answers: latest.current, submit: false });
    };
  }, [docId, preview]);

  if (!doc || doc.fields.length === 0) return <p className="rounded-xl bg-academy-blue-50 px-4 py-3 text-sm text-academy-blue-800">{tr("worksheet.missing")}</p>;

  function change(key: string, value: WorksheetAnswers[string] | undefined) {
    const next = { ...latest.current };
    if (value === undefined) delete next[key];
    else next[key] = value;
    latest.current = next;
    pending.current = true;
    setAnswers(next);
    setMissing((m) => m.filter((label) => label !== doc!.fields.find((f) => f.key === key)?.label));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), 800);
  }

  async function submit() {
    if (!doc) return;
    const clean = normalizeAnswers(doc.fields, latest.current);
    const open = missingRequired(doc.fields, clean);
    if (open.length > 0) {
      setMissing(open.map((f) => f.label));
      return;
    }
    if (!window.confirm(tr("worksheet.confirmSubmit"))) return;
    if (timer.current) clearTimeout(timer.current);
    setSubmitting(true);
    const result = await saveWorksheet({ documentId: doc.id, answers: clean, submit: true });
    setSubmitting(false);
    if (result.ok) {
      setSubmittedAt(result.submittedAt);
      setStatus("idle");
      if (!done) router.refresh();
    } else if (result.error === "missing" && result.missing) {
      setMissing(result.missing);
    } else if (result.error === "locked") {
      router.refresh();
    } else {
      setStatus("failed");
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {doc.description && <p className="text-sm whitespace-pre-line">{doc.description}</p>}
      <p className="text-xs text-muted">{preview ? tr("worksheet.preview") : tr("worksheet.privacy")}</p>
      {doc.fields.map((field) => {
        const id = `ws-${block.id}-${field.key}`;
        const isMissing = missing.includes(field.label);
        return (
          <div key={field.key} className="space-y-1.5">
            <label id={`${id}-label`} htmlFor={id} className="block text-sm font-medium text-academy-blue-900">
              {field.label}
              {field.required && (
                <span className="ml-0.5 text-academy-orange-700" aria-hidden="true">
                  *
                </span>
              )}
            </label>
            {field.help && (
              <p id={`${id}-help`} className="text-xs text-muted">
                {field.help}
              </p>
            )}
            <FieldInput field={field} value={answers[field.key]} disabled={locked} id={id} locale={locale} onChange={(v) => change(field.key, v)} />
            {field.type === "number" && field.min !== null && field.max !== null && <p className="text-xs text-muted">{tr("worksheet.range", { min: field.min, max: field.max })}</p>}
            {isMissing && !isFilled(answers[field.key]) && <p className="text-xs font-medium text-danger">{tr("worksheet.missingFields", { fields: field.label })}</p>}
          </div>
        );
      })}

      {submittedAt ? (
        <div className="space-y-1 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="flex items-center gap-2 font-medium">
            <Lock className="size-4" aria-hidden="true" />
            {tr("worksheet.submitted", { date: formatAcademyDateTime(submittedAt, locale, timeZone) })}
          </p>
          <p className="text-xs">{tr("worksheet.locked")}</p>
        </div>
      ) : (
        !preview && (
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
              {tr("worksheet.submit")}
            </ActionButton>
            <p className="flex h-5 items-center gap-1.5 text-xs text-muted" aria-live="polite">
              {status === "saving" && (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  {tr("worksheet.saving")}
                </>
              )}
              {status === "saved" && (
                <>
                  <Check className="size-3.5 text-emerald-600" aria-hidden="true" />
                  {tr("worksheet.saved")}
                </>
              )}
              {status === "failed" && (
                <span className="flex items-center gap-1.5 text-danger">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  {tr("worksheet.failed")}
                </span>
              )}
            </p>
          </div>
        )
      )}
      {missing.length > 0 && !submittedAt && (
        <p role="alert" className="text-sm font-medium text-danger">
          {tr("worksheet.missingFields", { fields: missing.join(", ") })}
        </p>
      )}
    </form>
  );
}
