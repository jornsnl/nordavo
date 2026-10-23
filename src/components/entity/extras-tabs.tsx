"use client";

import { useId, useRef, useState, type ReactNode } from "react";

export type ExtrasTab = { key: string; label: string; count?: number; content: ReactNode };

/** Accessible tabs (arrow keys, Home, End) for the side column of a detail page. */
export function ExtrasTabs({ tabs, label }: { tabs: ExtrasTab[]; label: string }) {
  const id = useId();
  const [active, setActive] = useState(tabs[0]?.key);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(index: number) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    setActive(tab.key);
    refs.current[(index + tabs.length) % tabs.length]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-2"
      >
        {tabs.map((tab, index) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.key)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") focusTab(index + 1);
                else if (event.key === "ArrowLeft") focusTab(index - 1);
                else if (event.key === "Home") focusTab(0);
                else if (event.key === "End") focusTab(tabs.length - 1);
                else return;
                event.preventDefault();
              }}
              className={`relative -mb-px inline-flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 ${
                selected
                  ? "border-accent-500 text-brand-900"
                  : "border-transparent text-muted hover:text-brand-900"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    selected ? "bg-brand-100 text-brand-700" : "bg-surface text-muted"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${id}-panel-${tab.key}`}
          aria-labelledby={`${id}-tab-${tab.key}`}
          hidden={tab.key !== active}
          tabIndex={0}
          className="p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
