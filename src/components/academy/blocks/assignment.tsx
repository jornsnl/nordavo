"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileText, MessageSquareText, RotateCcw } from "lucide-react";
import { submitAssignment } from "@/app/academy/learn-actions";
import type { AcademyLocale } from "@/lib/academy/database";
import { t } from "@/lib/academy/i18n";
import { ASSIGNMENT_FORMATS, type AssignmentFormat, MAX_SUBMISSION_FILE_BYTES, assignmentFormats, assignmentPrompt } from "@/lib/academy/learn/assignment";
import type { AssignmentAttemptState } from "@/lib/academy/learn/states";
import { formatAcademyDateTime } from "@/lib/academy/time";
import { ActionButton } from "@/components/academy/ui";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { BlockEditorProps, BlockViewerProps } from "./types";

// Assignment block (Academy: opdrachtblok): a concrete assignment in the
// learner's own situation, handed in as text, file or link. Nordavo reviews
// it in /dashboard/academy/reviews; the learner sees the feedback here and
// hands in again when Nordavo asks for changes. Earlier attempts stay.

const formatLabels: Record<AssignmentFormat, string> = { text: "Text", file: "File", link: "Link" };

export function AssignmentEditor({ block, content, onChange, disabled }: BlockEditorProps) {
  const formats = assignmentFormats(content);
  function toggle(format: AssignmentFormat, on: boolean) {
    const next = on ? [...new Set([...formats, format])] : formats.filter((f) => f !== format);
    if (next.length === 0) return; // at least one way to hand in
    onChange({ ...content, formats: ASSIGNMENT_FORMATS.filter((f) => next.includes(f)) });
  }
  return (
    <div className="space-y-4">
      <Field
        label="The assignment"
        htmlFor={`a-prompt-${block.id}`}
        hint="A concrete assignment in the learner's own situation, e.g. “Write your first task for your developer with the 5W template.”"
      >
        <Textarea
          id={`a-prompt-${block.id}`}
          rows={5}
          value={assignmentPrompt(content)}
          maxLength={10_000}
          disabled={disabled}
          onChange={(e) => onChange({ ...content, prompt: e.target.value })}
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Hand in as</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {ASSIGNMENT_FORMATS.map((format) => (
            <label key={format} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formats.includes(format)}
                disabled={disabled}
                onChange={(e) => toggle(format, e.target.checked)}
                className="size-4 accent-brand-700"
              />
              {formatLabels[format]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">
          Nordavo reviews every submission in Reviews. Claude makes an AI proposal on the rubric (clarity, proactivity, dares to say no,
          English) for you; you always set the final score.
        </p>
      </fieldset>
    </div>
  );
}

function attemptsFromState(state: BlockViewerProps["state"]): AssignmentAttemptState[] {
  if (!state || typeof state !== "object" || Array.isArray(state)) return [];
  const attempts = (state as { attempts?: unknown }).attempts;
  return Array.isArray(attempts) ? (attempts as AssignmentAttemptState[]) : [];
}

function statusClasses(status: AssignmentAttemptState["status"]) {
  if (status === "approved") return "bg-emerald-50 text-emerald-800 ring-emerald-600/15";
  if (status === "changes_requested") return "bg-academy-orange-50 text-academy-orange-800 ring-academy-orange-600/20";
  return "bg-academy-blue-50 text-academy-blue-800 ring-academy-blue-300/40";
}

function AttemptView({ attempt, locale, timeZone }: { attempt: AssignmentAttemptState; locale: AcademyLocale; timeZone: string }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-muted">
        {t(locale, "assignment.attempt", { number: attempt.attempt })} · {t(locale, "assignment.handedInOn", { date: formatAcademyDateTime(attempt.submittedAt, locale, timeZone) })}
      </p>
      {attempt.body && <p className="whitespace-pre-line text-ink">{attempt.body}</p>}
      {attempt.fileName && (
        <p className="flex items-center gap-1.5">
          <FileText className="size-4 text-academy-blue-600" aria-hidden="true" />
          {attempt.fileUrl ? (
            <a href={attempt.fileUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-academy-blue-700 hover:underline">
              {attempt.fileName}
            </a>
          ) : (
            attempt.fileName
          )}
        </p>
      )}
      {attempt.linkUrl && (
        <p className="flex items-center gap-1.5">
          <ExternalLink className="size-4 text-academy-blue-600" aria-hidden="true" />
          <a href={attempt.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-medium text-academy-blue-700 hover:underline">
            {attempt.linkUrl}
          </a>
        </p>
      )}
      {attempt.feedback && (
        <div className="rounded-xl border border-academy-blue-100 bg-academy-blue-50/60 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-academy-blue-800">
            <MessageSquareText className="size-3.5" aria-hidden="true" />
            {t(locale, "assignment.feedback")}
            {attempt.feedbackAt && <span className="font-normal text-muted"> · {formatAcademyDateTime(attempt.feedbackAt, locale, timeZone)}</span>}
          </p>
          <p className="mt-1 whitespace-pre-line text-ink">{attempt.feedback}</p>
        </div>
      )}
    </div>
  );
}

/** The form state starts from the latest attempt: remount when it changes (after handing in). */
export function AssignmentViewer(props: BlockViewerProps) {
  const latest = attemptsFromState(props.state)[0];
  return <AssignmentView key={latest ? `${latest.id}:${latest.submittedAt}:${latest.status}` : "new"} {...props} />;
}

function AssignmentView({ block, state, locale, timeZone, preview }: BlockViewerProps) {
  const router = useRouter();
  const prompt = assignmentPrompt(block.content);
  const formats = assignmentFormats(block.content);
  const attempts = attemptsFromState(state);
  const latest = attempts[0] ?? null;
  const editing = latest?.status === "submitted";
  const canHandIn = !preview && latest?.status !== "approved";

  const [body, setBody] = useState(latest && latest.status !== "approved" ? (latest.body ?? "") : "");
  const [link, setLink] = useState(latest && latest.status !== "approved" ? (latest.linkUrl ?? "") : "");
  const [keepFile, setKeepFile] = useState(Boolean(editing && latest?.filePath));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(form: HTMLFormElement) {
    setError(null);
    setSuccess(null);
    const data = new FormData(form);
    const file = data.get("file");
    if (file instanceof File && file.size > MAX_SUBMISSION_FILE_BYTES) {
      setError(t(locale, "assignment.fileTooLarge"));
      return;
    }
    data.set("block_id", block.id);
    if (keepFile && latest?.filePath) {
      data.set("keep_file_path", latest.filePath);
      data.set("keep_file_name", latest.fileName ?? "");
    }
    start(async () => {
      const result = await submitAssignment(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(t(locale, "assignment.submitted"));
      form.reset();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {prompt && <p className="whitespace-pre-line text-ink">{prompt}</p>}

      {latest && (
        <div className="space-y-3 rounded-xl border border-academy-blue-200 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClasses(latest.status)}`}>
              {latest.status === "approved" && <CheckCircle2 className="size-3.5" aria-hidden="true" />}
              {latest.status === "changes_requested" && <RotateCcw className="size-3.5" aria-hidden="true" />}
              {t(locale, `assignment.status.${latest.status}`)}
            </span>
            {latest.finalScore !== null && latest.status === "approved" && (
              <span className="text-xs font-semibold text-academy-blue-900">{t(locale, "assignment.score", { score: latest.finalScore })}</span>
            )}
          </div>
          <AttemptView attempt={latest} locale={locale} timeZone={timeZone} />
        </div>
      )}

      {preview && <p className="text-xs text-muted">{t(locale, "assignment.preview")}</p>}

      {canHandIn && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          {editing && <p className="text-xs text-muted">{t(locale, "assignment.editWhileWaiting")}</p>}
          {formats.includes("text") && (
            <Field label={t(locale, "assignment.yourWork")} htmlFor={`a-body-${block.id}`}>
              <Textarea
                id={`a-body-${block.id}`}
                name="body"
                rows={8}
                value={body}
                maxLength={50_000}
                placeholder={t(locale, "assignment.textPlaceholder")}
                onChange={(e) => setBody(e.target.value)}
                className="border-academy-blue-200"
              />
            </Field>
          )}
          {formats.includes("file") && (
            <Field label={t(locale, "assignment.file")} htmlFor={`a-file-${block.id}`} hint={t(locale, "assignment.fileHint")}>
              {keepFile && latest?.fileName ? (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {t(locale, "assignment.currentFile", { name: latest.fileName })}
                  <button type="button" onClick={() => setKeepFile(false)} className="text-xs font-medium text-academy-orange-700 hover:underline">
                    {t(locale, "assignment.removeFile")}
                  </button>
                </p>
              ) : (
                <Input id={`a-file-${block.id}`} name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp" />
              )}
            </Field>
          )}
          {formats.includes("link") && (
            <Field label={t(locale, "assignment.link")} htmlFor={`a-link-${block.id}`}>
              <Input
                id={`a-link-${block.id}`}
                name="link_url"
                type="url"
                inputMode="url"
                value={link}
                maxLength={2000}
                placeholder={t(locale, "assignment.linkPlaceholder")}
                onChange={(e) => setLink(e.target.value)}
              />
            </Field>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {success && <p className="text-sm text-emerald-700">{success}</p>}
          <ActionButton type="submit" disabled={pending}>
            {pending
              ? t(locale, "assignment.submitting")
              : editing
                ? t(locale, "assignment.update")
                : latest?.status === "changes_requested"
                  ? t(locale, "assignment.resubmit")
                  : t(locale, "assignment.submit")}
          </ActionButton>
        </form>
      )}

      {attempts.length > 1 && (
        <details className="rounded-xl border border-academy-blue-100 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-academy-blue-800">{t(locale, "assignment.history")}</summary>
          <ul className="mt-3 space-y-4">
            {attempts.slice(1).map((attempt) => (
              <li key={attempt.id} className="border-t border-academy-blue-100 pt-3 first:border-0 first:pt-0">
                <p className="mb-1 text-xs font-medium text-academy-blue-800">{t(locale, `assignment.status.${attempt.status}`)}</p>
                <AttemptView attempt={attempt} locale={locale} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
