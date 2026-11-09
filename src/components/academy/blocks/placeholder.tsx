"use client";

import { Hourglass } from "lucide-react";
import { blockTypes } from "@/lib/academy/blocks/types";
import { t } from "@/lib/academy/i18n";
import type { BlockEditorProps, BlockViewerProps } from "./types";

// The stand-in editor and viewer for block types whose own components are
// built separately (video, document, worksheet, assignment, tasks, knowledge
// check, questionnaire). The block can already be added, ordered, titled and
// marked required; its data tables exist. Replace the registry entry in
// src/components/academy/blocks/registry.tsx with the real components.

export function PlaceholderEditor({ block }: BlockEditorProps) {
  const meta = blockTypes[block.type];
  return (
    <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-sm text-muted">
      {meta.adminDescription} The settings of this block type (
      {meta.media === "video" ? "upload, subtitles, transcript" : meta.media === "document" ? "files and versions" : "its content"}) are added in
      the next release of the Academy editor. You can already place it, give it a title and set whether it is required.
    </p>
  );
}

export function PlaceholderViewer({ locale }: BlockViewerProps) {
  return (
    <p className="flex items-center gap-2 rounded-xl bg-academy-blue-50 px-4 py-3 text-sm text-academy-blue-800">
      <Hourglass className="size-4 shrink-0" aria-hidden="true" />
      {t(locale, "block.preparing")}
    </p>
  );
}
