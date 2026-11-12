import { Suspense, type ReactNode } from "react";
import { ListSkeleton } from "@/components/ui/skeleton";
import { getRecordLayout, getRecordValues } from "@/lib/custom-fields/data";
import { blocksForTab, fieldBlocks, type LayoutEntity, type ResolvedBlock, type ResolvedLayout } from "@/lib/custom-fields/layout";
import { CustomFieldsEditor } from "./custom-fields-editor";

/**
 * A record page laid out as the team set it up under Settings, Fields: the
 * blocks in their order and column, hidden ones left out, and the blocks
 * with custom fields rendered here. The page passes its fixed blocks by key:
 *
 *   <RecordLayout entity="vacancy" recordId={id} blocks={{ timeline: <TimelineCard .../>, ... }} />
 *
 * A block the page passes as null or false (not relevant for this record) is
 * skipped. With tabs (candidates) pass `tab` to render one tab's blocks.
 */
export async function RecordLayout({
  entity,
  recordId,
  blocks,
  tab = null,
  layout: given,
  gridClassName = "grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_380px]",
  mainClassName = "min-w-0 space-y-4 sm:space-y-6",
  sideClassName = "min-w-0 space-y-4 sm:space-y-6",
}: {
  entity: LayoutEntity;
  recordId: string;
  blocks: Partial<Record<string, ReactNode>>;
  tab?: string | null;
  layout?: ResolvedLayout;
  gridClassName?: string;
  mainClassName?: string;
  sideClassName?: string;
}) {
  const layout = given ?? (await getRecordLayout(entity));
  const render = (block: ResolvedBlock) => {
    if (block.holdsFields) {
      // The default block shows even when empty, so "+ Add field" is always at hand; added blocks only with fields.
      if (block.added && block.customFields.length === 0) return null;
      return (
        <Suspense key={block.key} fallback={<ListSkeleton rows={2} />}>
          <FieldsBlock entity={entity} recordId={recordId} block={block} layout={layout} />
        </Suspense>
      );
    }
    const node = blocks[block.key];
    if (node === null || node === undefined || node === false) return null;
    return <BlockSlot key={block.key}>{node}</BlockSlot>;
  };

  const main = blocksForTab(layout, tab, "main").map(render).filter(Boolean);
  const side = blocksForTab(layout, tab, "side").map(render).filter(Boolean);
  if (side.length === 0) return <div className={mainClassName}>{main}</div>;
  if (main.length === 0) return <div className={mainClassName}>{side}</div>;
  return (
    <div className={gridClassName}>
      <div className={mainClassName}>{main}</div>
      <div className={sideClassName}>{side}</div>
    </div>
  );
}

function BlockSlot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

async function FieldsBlock({
  entity,
  recordId,
  block,
  layout,
}: {
  entity: LayoutEntity;
  recordId: string;
  block: ResolvedBlock;
  layout: ResolvedLayout;
}) {
  const values = await getRecordValues(entity, recordId);
  if (values === null) return null;
  return (
    <CustomFieldsEditor
      entity={entity}
      recordId={recordId}
      definitions={block.customFields}
      values={values}
      title={block.label}
      blockKey={block.key}
      blocks={fieldBlocks(layout)}
    />
  );
}
