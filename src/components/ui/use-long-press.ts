"use client";

import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

export const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

/**
 * Press and hold with a finger (or pen) calls onLongPress; a right click
 * calls onContext with the pointer position. A press that turned into a long
 * press does not also count as a tap, so the link under it does not open.
 * Moving the finger (scrolling) cancels.
 */
export function useLongPress({
  onLongPress,
  onContext,
}: {
  onLongPress: () => void;
  onContext?: (at: { x: number; y: number }) => void;
}) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  useEffect(() => cancel, []);

  return {
    onPointerDown(event: PointerEvent) {
      fired.current = false;
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        navigator.vibrate?.(10);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove(event: PointerEvent) {
      if (!start.current) return;
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu(event: MouseEvent) {
      // A long press on touch also fires contextmenu (Android): the press handles it.
      event.preventDefault();
      if (fired.current || timer.current !== null) return;
      onContext?.({ x: event.clientX, y: event.clientY });
    },
    onClickCapture(event: MouseEvent) {
      if (fired.current) {
        event.preventDefault();
        event.stopPropagation();
        fired.current = false;
      }
    },
  };
}
