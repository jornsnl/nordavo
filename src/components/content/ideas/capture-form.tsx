"use client";

import { useRef, useState } from "react";
import { Camera, Link2, Tag } from "lucide-react";
import { captureIdeaAction } from "@/app/content/actions/ideas";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";
import { useContentAction } from "@/components/content/post/use-content-action";

const LAST_KEY = "content:capture:workspace";

/** Picks the workspace used last on this device (a per-device convenience). */
function rememberLast(select: HTMLSelectElement | null) {
  if (!select || select.dataset.restored) return;
  select.dataset.restored = "1";
  try {
    const last = window.localStorage.getItem(LAST_KEY);
    if (last && [...select.options].some((o) => o.value === last)) select.value = last;
  } catch {}
}

/**
 * Capture an idea in seconds, also on a phone: one field and one tap. Tag,
 * link and photo are optional and folded away. The form clears and keeps
 * focus, so the next idea can follow at once.
 */
export function CaptureForm({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [extras, setExtras] = useState(false);

  const { formAction, pending, errors, state } = useContentAction(captureIdeaAction, () => {
    formRef.current?.reset();
    const select = formRef.current?.elements.namedItem("workspace_id");
    if (select instanceof HTMLSelectElement) {
      delete select.dataset.restored;
      rememberLast(select);
    }
    setExtras(false);
    textRef.current?.focus();
  });

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {workspaces.length > 1 ? (
        <Field label="Workspace" htmlFor="capture-workspace">
          <Select
            id="capture-workspace"
            name="workspace_id"
            defaultValue={workspaces[0]?.id}
            ref={rememberLast}
            onChange={(e) => {
              try {
                window.localStorage.setItem(LAST_KEY, e.target.value);
              } catch {}
            }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="workspace_id" value={workspaces[0]?.id ?? ""} />
      )}

      <Field label="Your idea" htmlFor="capture-text" error={errors.text}>
        <Textarea
          ref={textRef}
          id="capture-text"
          name="text"
          rows={5}
          autoFocus
          required
          maxLength={5000}
          enterKeyHint="done"
          placeholder="A loose thought. It is not a post yet."
          className="text-base"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) formRef.current?.requestSubmit();
          }}
        />
      </Field>

      {extras ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tags" htmlFor="capture-tags" hint="Separate with commas">
            <Input id="capture-tags" name="tags" placeholder="india, hiring" autoCapitalize="none" />
          </Field>
          <Field label="Link" htmlFor="capture-link" error={errors.link}>
            <Input id="capture-link" name="link" type="url" inputMode="url" placeholder="https://" />
          </Field>
          <Field label="Photo" htmlFor="capture-photo" error={errors.photo} className="sm:col-span-2">
            <Input id="capture-photo" name="photo" type="file" accept="image/*" />
          </Field>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExtras(true)}
          className="flex items-center gap-3 rounded-lg px-1 text-sm font-medium text-brand-700 hover:text-brand-900 pointer-coarse:min-h-10"
        >
          <Tag className="size-4" aria-hidden="true" />
          <Link2 className="size-4" aria-hidden="true" />
          <Camera className="size-4" aria-hidden="true" />
          Add a tag, link or photo
        </button>
      )}

      {state.error && state.fieldErrors && <p className="text-sm text-danger">{state.error}</p>}
      <PendingSubmit pending={pending} pendingLabel="Saving" className="w-full sm:w-auto">
        Save idea
      </PendingSubmit>
    </form>
  );
}
