"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { PendingSubmit } from "@/components/placements/form-utils";
import type { ContentActionState } from "@/lib/content/errors";
import { useContentForm, type ContentFormAction } from "./use-content-action";

/** Measure images in the browser, so the library knows their size and orientation. */
async function dimensions(files: File[]): Promise<Record<string, { width: number; height: number }>> {
  const result: Record<string, { width: number; height: number }> = {};
  for (const file of files) {
    if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") continue;
    try {
      const bitmap = await createImageBitmap(file);
      result[file.name] = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
    } catch {
      // HEIC and other formats the browser cannot read: no size, that is fine.
    }
  }
  return result;
}

/** Upload photos, videos and PDFs (at most 20 MB per upload) to a library. */
export function UploadForm({ action, folders }: { action: ContentFormAction; folders: string[] }) {
  const form = useRef<HTMLFormElement>(null);
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const withSizes = async (prev: ContentActionState, formData: FormData) => {
    for (const [name, size] of Object.entries(sizes)) {
      formData.set(`width_${name}`, String(size.width));
      formData.set(`height_${name}`, String(size.height));
    }
    return action(prev, formData);
  };
  const { state, formAction, pending } = useContentForm(withSizes, () => {
    form.current?.reset();
    setSizes({});
  });

  return (
    <form ref={form} action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Files" htmlFor="media-files" hint="Photos, videos or PDFs, at most 20 MB per upload. Large sets: link a Google Drive folder.">
          <Input
            id="media-files"
            name="files"
            type="file"
            multiple
            accept="image/*,video/*,application/pdf"
            required
            onChange={async (e) => setSizes(await dimensions([...(e.currentTarget.files ?? [])]))}
          />
        </Field>
        <Field label="Folder" htmlFor="media-folder" hint="Optional, for example Photoshoot/Day 1">
          <Input id="media-folder" name="folder" list="media-folders" maxLength={300} />
          <datalist id="media-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
      </div>
      {state.error && <FormMessage error={state.error} />}
      <PendingSubmit pending={pending} pendingLabel="Uploading">
        <Upload aria-hidden="true" />
        Upload
      </PendingSubmit>
    </form>
  );
}
