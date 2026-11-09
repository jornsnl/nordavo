import type { ComponentType } from "react";
import {
  CheckSquare,
  ClipboardList,
  FileText,
  ListChecks,
  NotebookPen,
  PenLine,
  PlayCircle,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { AcademyBlockType } from "@/lib/academy/database";
import { ExplanationEditor } from "./explanation-editor";
import { ExplanationViewer } from "./explanation-viewer";
import { NotesEditor, NotesViewer } from "./notes";
// Area: media (video, document, worksheet).
import { DocumentEditor, DocumentViewer } from "./document";
import { VideoEditor } from "./video-editor";
import { VideoViewer } from "./video-viewer";
import { WorksheetEditor, WorksheetViewer } from "./worksheet";
import { PlaceholderEditor, PlaceholderViewer } from "./placeholder";
import type { BlockEditorProps, BlockViewerProps } from "./types";

/**
 * The UI half of the lesson block registry (docs/academy.md). Per type:
 *   editor  rendered in the lesson editor (/dashboard/academy/lessons/[id])
 *           inside the block card; edits block.content through onChange,
 *           the card saves it (updateBlock, sanitized by contentSanitizers);
 *           may call its own server actions for uploads and child rows
 *   viewer  rendered in the lesson player (/academy/courses/[c]/lessons/[l])
 *           with done (SQL) and state (blockStateLoaders)
 *   icon    shown in the editor menu and above the block in the player
 * The pure half (defaults, completion fields, requirement text) is
 * src/lib/academy/blocks/types.ts; the server half (content sanitizers,
 * state loaders) src/lib/academy/blocks/server.ts; completion itself is
 * public.academy_block_done_<type>() in SQL.
 */
export type BlockComponents = {
  icon: LucideIcon;
  editor: ComponentType<BlockEditorProps>;
  viewer: ComponentType<BlockViewerProps>;
};

export const blockRegistry: Record<AcademyBlockType, BlockComponents> = {
  explanation: { icon: ScrollText, editor: ExplanationEditor, viewer: ExplanationViewer },
  notes: { icon: NotebookPen, editor: NotesEditor, viewer: NotesViewer },
  video: { icon: PlayCircle, editor: VideoEditor, viewer: VideoViewer },
  document: { icon: FileText, editor: DocumentEditor, viewer: DocumentViewer },
  worksheet: { icon: ClipboardList, editor: WorksheetEditor, viewer: WorksheetViewer },
  assignment: { icon: PenLine, editor: PlaceholderEditor, viewer: PlaceholderViewer },
  tasks: { icon: CheckSquare, editor: PlaceholderEditor, viewer: PlaceholderViewer },
  knowledge_check: { icon: ListChecks, editor: PlaceholderEditor, viewer: PlaceholderViewer },
  questionnaire: { icon: Sparkles, editor: PlaceholderEditor, viewer: PlaceholderViewer },
};
