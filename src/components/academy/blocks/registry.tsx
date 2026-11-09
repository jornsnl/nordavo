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
import { PlaceholderEditor, PlaceholderViewer } from "./placeholder";
import { AssignmentEditor, AssignmentViewer } from "./assignment";
import { KnowledgeCheckEditor, KnowledgeCheckViewer } from "./knowledge-check";
import { QuestionnaireEditor, QuestionnaireViewer } from "./questionnaire";
import { TasksEditor, TasksViewer } from "./tasks";
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
  video: { icon: PlayCircle, editor: PlaceholderEditor, viewer: PlaceholderViewer },
  document: { icon: FileText, editor: PlaceholderEditor, viewer: PlaceholderViewer },
  worksheet: { icon: ClipboardList, editor: PlaceholderEditor, viewer: PlaceholderViewer },
  // Area learn (src/lib/academy/learn, docs/academy.md section 12).
  assignment: { icon: PenLine, editor: AssignmentEditor, viewer: AssignmentViewer },
  tasks: { icon: CheckSquare, editor: TasksEditor, viewer: TasksViewer },
  knowledge_check: { icon: ListChecks, editor: KnowledgeCheckEditor, viewer: KnowledgeCheckViewer },
  questionnaire: { icon: Sparkles, editor: QuestionnaireEditor, viewer: QuestionnaireViewer },
};
