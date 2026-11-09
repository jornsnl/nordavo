"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { saveNote } from "@/app/academy/actions";
import { notesPrompt, notesScope } from "@/lib/academy/blocks/types";
import { t } from "@/lib/academy/i18n";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { BlockEditorProps, BlockViewerProps } from "./types";

/** Editor: per lesson or per module, and an optional prompt above the field. */
export function NotesEditor({ block, content, onChange, disabled }: BlockEditorProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Notes belong to" htmlFor={`notes-scope-${block.id}`} hint="Module notes are the same in every lesson of the module.">
        <Select
          id={`notes-scope-${block.id}`}
          value={notesScope(content)}
          disabled={disabled}
          onChange={(e) => onChange({ ...content, scope: e.target.value })}
        >
          <option value="lesson">This lesson</option>
          <option value="module">The whole module</option>
        </Select>
      </Field>
      <Field label="Prompt (optional)" htmlFor={`notes-prompt-${block.id}`} hint="For example: what will you try this week?">
        <Input
          id={`notes-prompt-${block.id}`}
          value={notesPrompt(content)}
          maxLength={1000}
          disabled={disabled}
          onChange={(e) => onChange({ ...content, prompt: e.target.value })}
        />
      </Field>
    </div>
  );
}

type Status = "idle" | "saving" | "saved" | "failed";

/** The learner's own notes, saved automatically while typing. */
export function NotesViewer({ block, done, state, locale, moduleId, preview }: BlockViewerProps) {
  const router = useRouter();
  const scope = notesScope(block.content);
  const prompt = notesPrompt(block.content);
  const initial = state && typeof state === "object" && !Array.isArray(state) && typeof state.body === "string" ? state.body : "";
  const [body, setBody] = useState(initial);
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(initial);
  const wasDone = useRef(done);

  async function save(value: string) {
    if (preview) return;
    setStatus("saving");
    const result = await saveNote({
      lessonId: scope === "lesson" ? block.lessonId : null,
      moduleId: scope === "module" ? moduleId : null,
      body: value,
    });
    if (latest.current !== value) return; // a newer save is on its way
    setStatus(result.ok ? "saved" : "failed");
    // The first real note completes a required notes block: show the check.
    if (result.ok && block.required && !wasDone.current && value.trim() !== "") {
      wasDone.current = true;
      router.refresh();
    }
  }

  function change(value: string) {
    setBody(value);
    latest.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), 800);
  }

  // Save what is typed when the page is left before the autosave ran.
  const target = useRef({ lessonId: scope === "lesson" ? block.lessonId : null, moduleId: scope === "module" ? moduleId : null });
  useEffect(() => {
    target.current = { lessonId: scope === "lesson" ? block.lessonId : null, moduleId: scope === "module" ? moduleId : null };
  }, [scope, block.lessonId, moduleId]);
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (!preview) void saveNote({ ...target.current, body: latest.current });
      }
    };
  }, [preview]);

  const id = `notes-${block.id}`;
  return (
    <div className="space-y-2">
      {prompt && (
        <label htmlFor={id} className="block text-sm font-medium text-academy-blue-900">
          {prompt}
        </label>
      )}
      {scope === "module" && <p className="text-xs text-muted">{t(locale, "notes.moduleHint")}</p>}
      <Textarea
        id={id}
        rows={6}
        value={body}
        maxLength={50_000}
        disabled={preview || (scope === "module" && !moduleId)}
        placeholder={t(locale, "notes.placeholder")}
        aria-label={prompt || t(locale, "block.notes")}
        onChange={(e) => change(e.target.value)}
        onBlur={() => {
          if (timer.current && latest.current !== initial) {
            clearTimeout(timer.current);
            timer.current = null;
            void save(latest.current);
          }
        }}
        className="border-academy-blue-200 bg-academy-blue-50/40"
      />
      <p className="flex h-5 items-center gap-1.5 text-xs text-muted" aria-live="polite">
        {status === "saving" && (
          <>
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            {t(locale, "notes.saving")}
          </>
        )}
        {status === "saved" && (
          <>
            <Check className="size-3.5 text-emerald-600" aria-hidden="true" />
            {t(locale, "notes.saved")}
          </>
        )}
        {status === "failed" && (
          <span className="flex items-center gap-1.5 text-danger">
            <TriangleAlert className="size-3.5" aria-hidden="true" />
            {t(locale, "notes.failed")}
          </span>
        )}
      </p>
    </div>
  );
}
