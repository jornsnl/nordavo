"use client";

import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
  type PointerSensorOptions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * PointerSensor for mouse and pen only. Pointer events fire for fingers too,
 * and a PointerSensor that claims a touch wins before the TouchSensor's press
 * delay is over: the finger then drags instead of scrolling, or the browser
 * cancels the pointer and nothing moves at all. Touch belongs to TouchSensor.
 */
export class MouseAndPenSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
        if (nativeEvent.pointerType === "touch") return false;
        if (!nativeEvent.isPrimary || nativeEvent.button !== 0) return false;
        onActivation?.({ event: nativeEvent });
        return true;
      },
    },
  ];
}

/** Press and hold this long before a finger picks something up; a swipe still scrolls. */
export const TOUCH_DELAY_MS = 250;
export const TOUCH_TOLERANCE_PX = 8;

/** The sensors every board and sortable list uses: mouse or pen, finger (after a press) and keyboard. */
export function useDragSensors(coordinateGetter?: KeyboardCoordinateGetter) {
  return useSensors(
    useSensor(MouseAndPenSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: TOUCH_DELAY_MS, tolerance: TOUCH_TOLERANCE_PX } }),
    useSensor(KeyboardSensor, coordinateGetter ? { coordinateGetter } : {}),
  );
}

/**
 * Collision detection for boards: the column under the finger (or mouse)
 * decides, not the nearest card, which on a phone is often in the next column.
 * Inside that column the nearest card is returned for the order, when cards
 * are drop targets too (sortable). Keyboard drags have no pointer and fall
 * back to the nearest corners.
 */
export function columnUnderPointer({
  isColumn,
  columnOf,
}: {
  isColumn: (container: DroppableContainer) => boolean;
  /** The column a card drop target belongs to; leave out when only columns are drop targets. */
  columnOf?: (id: UniqueIdentifier) => UniqueIdentifier | null;
}): CollisionDetection {
  return (args) => {
    if (!args.pointerCoordinates) return closestCorners(args);
    const columns = args.droppableContainers.filter(isColumn);
    const [hit] = pointerWithin({ ...args, droppableContainers: columns });
    if (!hit) return closestCorners({ ...args, droppableContainers: columns });
    if (!columnOf) return [hit];
    const cards = args.droppableContainers.filter((c) => !isColumn(c) && columnOf(c.id) === hit.id);
    if (cards.length === 0) return [hit];
    const [card] = closestCenter({ ...args, droppableContainers: cards });
    return card ? [card, hit] : [hit];
  };
}

/**
 * After a finger drag the browser still sends a tap to the link under the
 * finger, which would open the card. Call from onDragEnd: swallows that one
 * click, natively and before anything else sees it.
 */
export function swallowClickAfterTouchDrag(activatorEvent: Event | null) {
  if (typeof TouchEvent === "undefined" || !(activatorEvent instanceof TouchEvent)) return;
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener("click", swallow, true);
  };
  window.addEventListener("click", swallow, true);
  window.setTimeout(() => window.removeEventListener("click", swallow, true), 600);
}
