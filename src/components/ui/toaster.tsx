"use client";

import { useEffect, useSyncExternalStore } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

export type ToastTone = "success" | "error" | "info";
export type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
  /** A button in the toast, e.g. Undo. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it goes away by itself; errors stay a little longer. */
  duration: number;
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a short message at the bottom of the screen (above the tab bar on phones). */
export function toast(message: string, options: { tone?: ToastTone; action?: Toast["action"]; duration?: number } = {}) {
  const tone = options.tone ?? "success";
  const item: Toast = {
    id: nextId++,
    message,
    tone,
    action: options.action,
    duration: options.duration ?? (tone === "error" ? 8000 : options.action ? 6000 : 4000),
  };
  // At most three at a time; the oldest goes first.
  toasts = [...toasts.slice(-2), item];
  emit();
  return item.id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Mount once per shell. */
export function Toaster() {
  const items = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  );
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[60] flex flex-col items-center gap-2 px-4 lg:right-6 lg:bottom-6 lg:left-auto lg:items-end"
    >
      {items.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </div>
  );
}

function ToastItem({ item }: { item: Toast }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item]);
  const Icon = item.tone === "error" ? CircleAlert : item.tone === "info" ? Info : CheckCircle2;
  return (
    <div
      role={item.tone === "error" ? "alert" : "status"}
      className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-brand-950 py-2 pr-2 pl-4 text-sm text-white shadow-xl"
    >
      <Icon
        className={`size-5 shrink-0 ${item.tone === "error" ? "text-red-300" : item.tone === "info" ? "text-brand-200" : "text-emerald-300"}`}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 py-1.5">{item.message}</p>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            dismissToast(item.id);
            item.action?.onClick();
          }}
          className="shrink-0 rounded-lg px-3 py-2 font-semibold text-accent-500 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent-500"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="Close"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-brand-200 hover:bg-white/10"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
