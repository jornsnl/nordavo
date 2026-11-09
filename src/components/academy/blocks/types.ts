import type { AcademyBlockType, AcademyLocale } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import type { BlockCompletion, BlockContent } from "@/lib/academy/blocks/types";

// Props of the two components every block type registers
// (src/components/academy/blocks/registry.tsx). Serializable, so the server
// lesson pages can pass them to client components.

/** A block as the lesson editor holds it. */
export type EditorBlock = {
  id: string;
  lessonId: string;
  type: AcademyBlockType;
  title: string | null;
  required: boolean;
  completion: BlockCompletion;
  content: BlockContent;
  videoId: string | null;
  documentId: string | null;
};

export type BlockEditorProps = {
  block: EditorBlock;
  /** The content being edited; the editor card saves it with updateBlock(). */
  content: BlockContent;
  onChange: (content: BlockContent) => void;
  disabled?: boolean;
};

/** A block as the lesson player shows it. */
export type ViewerBlock = {
  id: string;
  lessonId: string;
  type: AcademyBlockType;
  title: string | null;
  required: boolean;
  completion: BlockCompletion;
  content: BlockContent;
  videoId: string | null;
  documentId: string | null;
};

export type BlockViewerProps = {
  block: ViewerBlock;
  /** academy_block_done_<type> for the signed-in user. */
  done: boolean;
  /** What blockStateLoaders[type] loaded for this block (src/lib/academy/blocks/server.ts). */
  state: Json | null;
  locale: AcademyLocale;
  timeZone: string;
  courseId: string;
  /** The module the lesson is shown in. */
  moduleId: string | null;
  /** Manager preview: show everything, record nothing. */
  preview: boolean;
};
