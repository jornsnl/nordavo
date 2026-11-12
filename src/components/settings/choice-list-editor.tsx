"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { resetChoiceList, saveChoiceList } from "@/app/dashboard/settings/sales-list-actions";
import { Button } from "@/components/ui/button";
import { choiceValueFromLabel, nextPrioLevel, type ChoiceOption } from "@/lib/sales/choices";
import type { ChoiceListKey } from "@/lib/sales/flow-database";

const input = "h-9 w-full rounded-lg border border-border bg-white px-2 text-sm";

/** One choice list: rename, explain, reorder, hide, and for prio and category add or delete options. */
export function ChoiceListEditor({ list, extra, options: initial }: { list: ChoiceListKey; extra: boolean; options: ChoiceOption[] }) {
  const [options, setOptions] = useState(initial);
  const [removed, setRemoved] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(options) !== JSON.stringify(initial) || removed.length > 0;

  const patch = (i: number, change: Partial<ChoiceOption>) => setOptions((prev) => prev.map((o, j) => (j === i ? { ...o, ...change } : o)));
  const move = (i: number, d: -1 | 1) =>
    setOptions((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () => {
    const value = list === "prio" ? nextPrioLevel(options) : choiceValueFromLabel(`option ${options.length + 1}`, options.map((o) => o.value));
    if (!value) return setMessage({ tone: "error", text: "Prio has at most 20 levels." });
    setOptions((prev) => [
      ...prev,
      { value, label: list === "prio" ? `P${value}` : "New option", description: null, tone: "neutral", hidden: false, builtin: false },
    ]);
  };

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {options.map((o, i) => (
          <li key={o.value} className={`grid gap-2 rounded-xl border px-3 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] ${o.hidden ? "border-dashed bg-surface" : "border-border"}`}>
            <label className="space-y-0.5 text-xs text-muted">
              Name{list === "prio" ? ` (level ${o.value})` : ""}
              <input
                className={input}
                value={o.label}
                maxLength={80}
                onChange={(e) => {
                  const label = e.target.value;
                  // A new extra category takes its value from its name until it is saved.
                  if (!o.builtin && list === "category" && !initial.some((x) => x.value === o.value)) {
                    patch(i, { label, value: choiceValueFromLabel(label, options.filter((_, j) => j !== i).map((x) => x.value)) });
                  } else patch(i, { label });
                }}
              />
            </label>
            <label className="space-y-0.5 text-xs text-muted">
              Explanation
              <input className={input} value={o.description ?? ""} maxLength={300} onChange={(e) => patch(i, { description: e.target.value || null })} />
            </label>
            <span className="flex items-end gap-1">
              <button type="button" className="rounded p-2 hover:bg-brand-50 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${o.label} up`}>
                <ArrowUp className="size-4" />
              </button>
              <button type="button" className="rounded p-2 hover:bg-brand-50 disabled:opacity-30" disabled={i === options.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${o.label} down`}>
                <ArrowDown className="size-4" />
              </button>
              <button type="button" className="rounded p-2 hover:bg-brand-50" onClick={() => patch(i, { hidden: !o.hidden })} aria-label={o.hidden ? `Show ${o.label}` : `Hide ${o.label}`} title={o.hidden ? "Hidden: not offered, existing values keep their name" : "Hide"}>
                {o.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              {!o.builtin && (
                <button
                  type="button"
                  className="rounded p-2 text-danger hover:bg-danger-bg"
                  onClick={() => {
                    setOptions((prev) => prev.filter((_, j) => j !== i));
                    if (initial.some((x) => x.value === o.value)) setRemoved((r) => [...r, o.value]);
                  }}
                  aria-label={`Delete ${o.label}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {extra && (
          <Button size="sm" variant="secondary" onClick={add}>
            <Plus aria-hidden="true" />
            {list === "prio" ? "Add a level" : "Add an option"}
          </Button>
        )}
        <Button
          size="sm"
          disabled={!dirty || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await saveChoiceList({
                list,
                options: options.map((o) => ({ value: o.value, label: o.label, description: o.description, hidden: o.hidden, tone: o.tone })),
                removed,
              });
              if (!result.ok) return setMessage({ tone: "error", text: result.error });
              setRemoved([]);
              setMessage({ tone: "ok", text: "Saved." });
            })
          }
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (!window.confirm("Back to the standard names and order? Extra options stay.")) return;
              const result = await resetChoiceList(list);
              setMessage(result.ok ? { tone: "ok", text: "Back to the standard. Reload to see it." } : { tone: "error", text: result.error });
            })
          }
        >
          Standard names
        </Button>
        {message && (
          <span role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-danger" : "text-emerald-700"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
