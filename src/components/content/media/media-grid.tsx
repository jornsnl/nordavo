"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban, CircleCheck, Download, ExternalLink, Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PendingSubmit } from "@/components/placements/form-utils";
import { CustomFieldInputs } from "@/components/content/custom-field-inputs";
import { acceptMediaSuggestionAction, rejectMediaSuggestionAction, updateMediaAction } from "@/app/content/actions/media";
import { formatBytes } from "@/lib/content/media-utils";
import type { MediaItem } from "@/lib/content/media";
import { reuseWarning, type FieldDef } from "@/lib/content/rules";
import { MediaThumb } from "./media-thumb";
import { useContentButton, useContentForm } from "./use-content-action";

/**
 * Grid of a media library. A file opens in a panel with its details, where
 * it was used, Claude's suggestion and (for writers) the edit form.
 */
export function MediaGrid({
  items,
  canEdit,
  fields,
  reuseMonths,
  today,
}: {
  items: MediaItem[];
  canEdit: boolean;
  fields: FieldDef[];
  reuseMonths: number;
  today: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((i) => i.id === openId) ?? null;

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((item) => {
          const used = item.uses.some((u) => u.published);
          const planned = item.uses.some((u) => !u.published);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setOpenId(item.id)}
                className={`group block w-full rounded-2xl border bg-card p-2 text-left shadow-xs transition hover:border-brand-200 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-brand-500 ${
                  item.doNotUse ? "border-danger/30" : "border-border"
                }`}
              >
                <div className="relative">
                  <MediaThumb url={item.url} kind={item.kind} name={item.fileName} className={item.doNotUse ? "opacity-50" : ""} />
                  <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                    {used && <Badge tone="success">Used</Badge>}
                    {!used && planned && <Badge tone="brand">Planned</Badge>}
                    {item.doNotUse && <Badge tone="danger">Do not use</Badge>}
                    {item.suggested && (
                      <Badge tone="accent">
                        <Sparkles className="size-3" aria-hidden="true" />
                        Suggestion
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="mt-2 truncate text-xs font-medium text-ink">{item.description || item.fileName}</p>
                <p className="truncate text-[11px] text-muted">
                  {[item.folder, item.takenOn].filter(Boolean).join(" · ") || "Not described yet"}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      <Modal open={open !== null} onClose={() => setOpenId(null)} title={open?.fileName ?? "File"} size="lg">
        {open && (
          <MediaDetail
            key={open.id}
            item={open}
            canEdit={canEdit}
            fields={open.workspaceId ? fields : []}
            reuse={reuseWarning(open.usedOn, today, reuseMonths)}
            onSaved={() => setOpenId(null)}
          />
        )}
      </Modal>
    </>
  );
}

function MediaDetail({
  item,
  canEdit,
  fields,
  reuse,
  onSaved,
}: {
  item: MediaItem;
  canEdit: boolean;
  fields: FieldDef[];
  reuse: string | null;
  onSaved: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          {item.kind === "image" && item.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt={item.description || item.fileName} className="max-h-80 w-full rounded-xl bg-surface object-contain" />
          ) : item.kind === "video" && item.url ? (
            <video src={item.url} controls className="max-h-80 w-full rounded-xl bg-black" />
          ) : (
            <MediaThumb url={item.url} kind={item.kind} name={item.fileName} />
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
            <span>{item.source === "drive" ? "Google Drive" : "Uploaded"}</span>
            {item.width && item.height && (
              <span>
                {item.width} × {item.height}
              </span>
            )}
            {item.sizeBytes ? <span>{formatBytes(item.sizeBytes)}</span> : null}
            <a href={`/content/files/${item.id}?download=${encodeURIComponent(item.fileName)}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
              <Download className="size-3.5" aria-hidden="true" />
              Download
            </a>
            <a href={`/content/files/${item.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Open
            </a>
          </div>
        </div>
        <UsedIn item={item} reuse={reuse} />
      </div>

      {item.suggested && <SuggestionBox item={item} canEdit={canEdit} />}

      {canEdit ? (
        <MediaEditForm item={item} fields={fields} onSaved={onSaved} />
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[
            ["Description", item.description],
            ["People", item.people.join(", ")],
            ["Setting", item.setting],
            ["Mood", item.mood],
            ["Tags", item.tags.join(", ")],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium text-muted uppercase">{label}</dt>
              <dd>{value || "Not filled in"}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function UsedIn({ item, reuse }: { item: MediaItem; reuse: string | null }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-brand-900">Used in</h3>
      {reuse && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {reuse}
        </p>
      )}
      {item.uses.length === 0 ? (
        <p className="text-sm text-muted">Not used yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {item.uses.map((use) => (
            <li key={use.postId} className="flex items-center justify-between gap-2 text-sm">
              {use.workspaceSlug ? (
                <Link href={`/content/w/${use.workspaceSlug}/posts/${use.postId}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                  {use.title}
                </Link>
              ) : (
                <span className="min-w-0 truncate">{use.title}</span>
              )}
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                {use.date ?? "No date"}
                <Badge tone={use.published ? "success" : "brand"}>{use.published ? "Live" : "Planned"}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const suggestionLabels: Record<string, string> = {
  description: "Description",
  tags: "Tags",
  people: "People",
  setting: "Setting",
  mood: "Mood",
  clothing: "Clothing",
  orientation: "Orientation",
  author_in_photo: "Author in photo",
};

/** Claude's description and tags: accept all, some, or reject. Never applied by itself. */
function SuggestionBox({ item, canEdit }: { item: MediaItem; canEdit: boolean }) {
  const { pending, run } = useContentButton();
  const entries = Object.entries(item.suggested ?? {});
  const [picked, setPicked] = useState<string[]>(entries.map(([key]) => key));
  return (
    <div className="rounded-2xl border border-accent-500/30 bg-accent-100/40 p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-900">
        <Sparkles className="size-4 text-accent-600" aria-hidden="true" />
        Suggested by Claude
      </p>
      <ul className="space-y-1.5 text-sm">
        {entries.map(([key, value]) => (
          <li key={key} className="flex items-start gap-2">
            {canEdit && (
              <input
                type="checkbox"
                aria-label={`Accept ${suggestionLabels[key] ?? key}`}
                checked={picked.includes(key)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, key] : p.filter((k) => k !== key)))}
                className="mt-1 size-4 accent-brand-700"
              />
            )}
            <span>
              <span className="font-medium">{suggestionLabels[key] ?? key}:</span>{" "}
              {Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
            </span>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={pending || picked.length === 0} onClick={() => run(() => acceptMediaSuggestionAction(item.id, picked))}>
            <CircleCheck aria-hidden="true" />
            {picked.length === entries.length ? "Accept all" : "Accept selected"}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => rejectMediaSuggestionAction(item.id))}>
            <Ban aria-hidden="true" />
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

function MediaEditForm({ item, fields, onSaved }: { item: MediaItem; fields: FieldDef[]; onSaved: () => void }) {
  const { state, formAction, pending, errors } = useContentForm(updateMediaAction.bind(null, item.id), onSaved);
  const p = `media-${item.id}`;
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Description" htmlFor={`${p}-description`} error={errors.description}>
        <Textarea id={`${p}-description`} name="description" rows={3} maxLength={2000} defaultValue={item.description ?? ""} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="People in the photo" htmlFor={`${p}-people`} hint="Names, separated by commas">
          <Input id={`${p}-people`} name="people" defaultValue={item.people.join(", ")} />
        </Field>
        <Field label="Author in photo" htmlFor={`${p}-author`}>
          <Select id={`${p}-author`} name="author_in_photo" defaultValue={item.authorInPhoto === null ? "" : item.authorInPhoto ? "yes" : "no"}>
            <option value="">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </Field>
        <Field label="Setting" htmlFor={`${p}-setting`}>
          <Input id={`${p}-setting`} name="setting" maxLength={200} defaultValue={item.setting ?? ""} />
        </Field>
        <Field label="Mood" htmlFor={`${p}-mood`}>
          <Input id={`${p}-mood`} name="mood" maxLength={200} defaultValue={item.mood ?? ""} />
        </Field>
        <Field label="Clothing" htmlFor={`${p}-clothing`}>
          <Input id={`${p}-clothing`} name="clothing" maxLength={200} defaultValue={item.clothing ?? ""} />
        </Field>
        <Field label="Orientation" htmlFor={`${p}-orientation`} error={errors.orientation}>
          <Select id={`${p}-orientation`} name="orientation" defaultValue={item.orientation ?? ""}>
            <option value="">Unknown</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
            <option value="square">Square</option>
          </Select>
        </Field>
        <Field label="Folder or source" htmlFor={`${p}-folder`}>
          <Input id={`${p}-folder`} name="folder" maxLength={300} defaultValue={item.folder ?? ""} />
        </Field>
        <Field label="Date" htmlFor={`${p}-taken`} error={errors.taken_on}>
          <Input id={`${p}-taken`} name="taken_on" type="date" defaultValue={item.takenOn ?? ""} />
        </Field>
      </div>
      <Field label="Tags" htmlFor={`${p}-tags`} hint="Separated by commas">
        <Input id={`${p}-tags`} name="tags" defaultValue={item.tags.join(", ")} />
      </Field>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="usable_for_linkedin" defaultChecked={item.usableForLinkedin} className="size-4 accent-brand-700" />
          Usable for LinkedIn
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="do_not_use" defaultChecked={item.doNotUse} className="size-4 accent-brand-700" />
          Do not use
        </label>
      </div>
      <CustomFieldInputs fields={fields} values={item.customFields} errors={errors} />
      {state.error && <FormMessage error={state.error} />}
      <PendingSubmit pending={pending} pendingLabel="Saving">
        Save
      </PendingSubmit>
    </form>
  );
}
