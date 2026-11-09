"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createDocument, deleteDocument, reopenWorksheet, setModuleWorkbook, updateDocument } from "@/app/dashboard/academy/media-actions";
import type { AcademyDocumentCategory, AcademyDocumentRow } from "@/lib/academy/database";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { CATEGORY_OPTIONS } from "@/lib/academy/media/files";
import { useMediaRun } from "@/components/academy/media/document-parts";

/** A new document or worksheet; opens its page. */
export function NewDocumentForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"download" | "worksheet">("download");
  const [category, setCategory] = useState<AcademyDocumentCategory>("template");
  const { busy, result, run } = useMediaRun();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const result = await createDocument({ title, kind, category });
          if (result.id) router.push(`/dashboard/academy/documents/${result.id}`);
          return result;
        });
      }}
    >
      <Field label="Title" htmlFor="new-doc-title">
        <Input id="new-doc-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Form" htmlFor="new-doc-kind" hint="A download is a file; a worksheet is filled in in the portal.">
          <Select id="new-doc-kind" value={kind} onChange={(e) => setKind(e.target.value as "download" | "worksheet")}>
            <option value="download">Download (PDF, Word, Excel)</option>
            <option value="worksheet">Worksheet to fill in</option>
          </Select>
        </Field>
        <Field label="Kind" htmlFor="new-doc-category">
          <Select id="new-doc-category" value={category} onChange={(e) => setCategory(e.target.value as AcademyDocumentCategory)}>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormMessage error={result.error} />
      <Button type="submit" disabled={busy || !title.trim()}>
        Create
      </Button>
    </form>
  );
}

/** Title, description and kind; the form (download or worksheet) is fixed. */
export function DocumentSettingsForm({ document }: { document: AcademyDocumentRow }) {
  const router = useRouter();
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description ?? "");
  const [category, setCategory] = useState<AcademyDocumentCategory>(document.category);
  const { busy, result, run } = useMediaRun();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => updateDocument({ id: document.id, title, description, category }));
      }}
    >
      <Field label="Title" htmlFor="doc-title">
        <Input id="doc-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <Field label="Description for the learner (optional)" htmlFor="doc-description">
        <Textarea id="doc-description" rows={3} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Kind" htmlFor="doc-category">
        <Select id="doc-category" value={category} onChange={(e) => setCategory(e.target.value as AcademyDocumentCategory)}>
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage error={result.error} success={result.message} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            run(
              async () => {
                const result = await deleteDocument(document.id);
                if (result.ok) router.push("/dashboard/academy/documents");
                return result;
              },
              { confirm: `Delete "${document.title}" with all versions${document.kind === "worksheet" ? " and all answers" : ""}? Lessons that use it lose it.`,
              },
            )
          }
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </div>
    </form>
  );
}

/** Use the document as the workbook of a module (one per module), in either course. */
export function WorkbookModules({
  documentId,
  modules,
}: {
  documentId: string;
  modules: { id: string; title: string; courseTitle: string; workbookDocumentId: string | null }[];
}) {
  const [picked, setPicked] = useState("");
  const { busy, result, run } = useMediaRun();
  const using = modules.filter((m) => m.workbookDocumentId === documentId);
  const others = modules.filter((m) => m.workbookDocumentId !== documentId);
  return (
    <div className="space-y-3">
      {using.length === 0 ? (
        <p className="text-sm text-muted">Not the workbook of a module.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {using.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {m.courseTitle} · {m.title}
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setModuleWorkbook(m.id, null))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Workbook of module" htmlFor="workbook-module" className="min-w-0 flex-1" hint="Replaces the module's current workbook, if any.">
          <Select id="workbook-module" value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="">Choose a module</option>
            {others.map((m) => (
              <option key={m.id} value={m.id}>
                {m.courseTitle} · {m.title}
                {m.workbookDocumentId ? " (has a workbook)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Button size="sm" disabled={busy || !picked} onClick={() => run(() => setModuleWorkbook(picked, documentId))}>
          Set as workbook
        </Button>
      </div>
      <FormMessage error={result.error} success={result.message} />
    </div>
  );
}

export function ReopenWorksheetButton({ answerId }: { answerId: string }) {
  const { busy, result, run } = useMediaRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => reopenWorksheet(answerId), { confirm: "Reopen this worksheet so the person can change it?" })}>
        Reopen
      </Button>
      {result.error && <span className="text-xs text-danger">{result.error}</span>}
    </span>
  );
}
