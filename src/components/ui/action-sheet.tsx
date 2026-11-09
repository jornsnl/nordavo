"use client";

import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { useScrollLock } from "./use-drawer";

export type ActionItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  tone?: "danger";
  disabled?: boolean;
  /** Items with the same group sit together, with a line between groups. */
  group?: string;
  /** Marks the current choice (e.g. the priority it already has). */
  checked?: boolean;
};

/**
 * The actions of one record. With an anchor (a right click on desktop) it is
 * a small menu at the pointer; on phones (a long press or the ⋯ button) a
 * sheet that slides up from the bottom, with big touch targets.
 */
export function ActionSheet({
  open,
  onClose,
  title,
  subtitle,
  items,
  anchor,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  items: ActionItem[];
  /** Where the right click was; null opens the bottom sheet. */
  anchor?: { x: number; y: number } | null;
}) {
  const titleId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const backdropPress = useRef(false);
  // The finger that opened the sheet with a long press lifts on top of it, and
  // the browser sends that tap to whatever is under it. Items only answer a
  // press that started inside the menu (or the keyboard, detail 0).
  const menuPress = useRef(false);
  // A small menu at the pointer for a right click with a mouse; the sheet otherwise.
  const popover =
    open && Boolean(anchor) && typeof window !== "undefined" && window.matchMedia("(pointer: fine) and (min-width: 768px)").matches;

  // Keep the menu on screen: placed after it has a size, without a second render.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !popover || !anchor || !menu) return;
    menu.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.style.visibility = "visible";
  }, [open, popover, anchor]);

  useScrollLock(open && !popover);

  useEffect(() => {
    if (!open) return;
    menuPress.current = false;
    backdropPress.current = false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => menuRef.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus(), 30);
    const onKey = (event: globalThis.KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      opener?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const list = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  }

  const groups: ActionItem[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0].group === item.group) last.push(item);
    else groups.push([item]);
  }

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-labelledby={titleId}
      onPointerDown={() => (menuPress.current = true)}
      onKeyDown={onMenuKey}
      className={
        popover
          ? "invisible fixed z-[70] w-60 rounded-xl border border-border bg-card py-1 text-sm shadow-xl"
          : "sheet-up fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-card pb-safe shadow-2xl sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl"
      }
    >
      {!popover && (
        <div aria-hidden="true" className="flex justify-center pt-2.5">
          <span className="h-1 w-10 rounded-full bg-border" />
        </div>
      )}
      <div className={popover ? "sr-only" : "border-b border-border px-5 pt-2 pb-3"}>
        <p id={titleId} className="truncate font-display text-base font-semibold text-brand-900">
          {title}
        </p>
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
      </div>
      {groups.map((group, index) => (
        <div key={group[0].key} role="group" className={index > 0 ? "border-t border-border" : ""}>
          {group.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={(event) => {
                  if (!menuPress.current && event.detail !== 0) return;
                  onClose();
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-3 text-left transition focus-visible:bg-brand-50 focus-visible:outline-none disabled:opacity-40 ${
                  popover ? "px-3 py-2 hover:bg-brand-50" : "min-h-12 px-5 py-3 text-[15px] active:bg-brand-50"
                } ${item.tone === "danger" ? "text-danger" : "text-ink"}`}
              >
                {Icon && <Icon className={`size-[18px] shrink-0 ${item.tone === "danger" ? "" : "text-muted"}`} aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.checked && <span className="size-2 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      ))}
      {!popover && (
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={(event) => (menuPress.current || event.detail === 0) && onClose()}
            className="min-h-12 w-full rounded-xl bg-surface text-[15px] font-semibold text-ink active:bg-brand-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className={popover ? "fixed inset-0 z-[69]" : "fixed inset-0 z-[69] bg-brand-950/50"}
        // Only a press that starts on the backdrop closes: the finger that
        // opened the sheet with a long press lifts here too.
        onPointerDown={() => (backdropPress.current = true)}
        onClick={() => {
          if (backdropPress.current) onClose();
          backdropPress.current = false;
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      {menu}
    </>,
    document.body,
  );
}
