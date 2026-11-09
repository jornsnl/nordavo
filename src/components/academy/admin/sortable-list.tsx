"use client";

import { type ReactNode, useOptimistic, useTransition } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDragSensors } from "@/components/ui/dnd";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

export type DragHandle = ReactNode;

/**
 * A vertical list that can be reordered by dragging the handle (mouse,
 * touch or keyboard: space, arrows, space). onReorder gets the new order of
 * ids and saves it; the list shows the new order straight away.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  label,
  className = "space-y-3",
}: {
  items: T[];
  onReorder: (ids: string[]) => Promise<unknown>;
  renderItem: (item: T, handle: DragHandle) => ReactNode;
  label: string;
  className?: string;
}) {
  // The new order shows at once and holds until the saved order comes back.
  const [order, setOrder] = useOptimistic(items);
  const [, startTransition] = useTransition();

  const sensors = useDragSensors(sortableKeyboardCoordinates);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((i) => i.id === active.id);
    const to = order.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    startTransition(async () => {
      setOrder(next);
      await onReorder(next.map((i) => i.id));
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className={className} aria-label={label}>
          {order.map((item) => (
            <SortableItem key={item.id} id={item.id} render={(handle) => renderItem(item, handle)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ id, render }: { id: string; render: (handle: DragHandle) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-900 active:cursor-grabbing pointer-coarse:size-10"
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      {render(handle)}
    </li>
  );
}
