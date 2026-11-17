"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { resetCheatsheet, saveCheatsheet } from "@/app/dashboard/settings/sales-list-actions";
import { Button } from "@/components/ui/button";
import { cheatsheetKeyFromTitle, hasPlaceholder, type CheatsheetSection } from "@/lib/sales/cheatsheet";

const input = "w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm";

/**
 * The cheat sheet of the call screen (feedback Julius, 21637c48): per section
 * a title and the text, in the order the caller sees it. [Square brackets]
 * mark what still has to be filled in. Callers and the team read it in the
 * foldable block on the call screen.
 */
export function CheatsheetEditor({ sections: initial }: { sections: CheatsheetSection[] }) {
  const [sections, setSections] = useState(initial);
  const [removed, setRemoved] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(sections) !== JSON.stringify(initial) || removed.length > 0;
  const open = sections.filter((s) => !s.hidden && hasPlaceholder(s.body)).length;

  const patch = (i: number, change: Partial<CheatsheetSection>) => setSections((prev) => prev.map((s, j) => (j === i ? { ...s, ...change } : s)));
  const move = (i: number, d: -1 | 1) =>
    setSections((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveCheatsheet({
        sections: sections.map((s) => ({ key: s.key, title: s.title, body: s.body, hidden: s.hidden })),
        removed,
      });
      setMessage(result.ok ? { tone: "ok", text: "Cheat sheet saved." } : { tone: "error", text: result.error });
      if (result.ok) setRemoved([]);
    });
  }

  function reset() {
    if (!window.confirm("Back to the draft text for the built in sections? Your own text in them is lost.")) return;
    setMessage(null);
    startTransition(async () => {
      const result = await resetCheatsheet();
      setMessage(result.ok ? { tone: "ok", text: "Back to the draft text. Reload the page to see it." } : { tone: "error", text: result.error });
    });
  }

  return (
    <div className="space-y-3">
      {open > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {open} {open === 1 ? "section has" : "sections have"} a [placeholder] to fill in. Nothing is made up: what is not known yet is in square brackets.
        </p>
      )}
      <ol className="space-y-3">
        {sections.map((s, i) => (
          <li key={s.key} className={`space-y-2 rounded-xl border px-3 py-2 ${s.hidden ? "border-dashed bg-surface" : "border-border"}`}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-48 flex-1 space-y-0.5 text-xs text-muted">
                Title
                <input className={input} value={s.title} maxLength={80} onChange={(e) => patch(i, { title: e.target.value })} />
              </label>
              <span className="flex items-center gap-1">
                <button type="button" className="rounded p-2 hover:bg-brand-50 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s.title} up`}>
                  <ArrowUp className="size-4" />
                </button>
                <button type="button" className="rounded p-2 hover:bg-brand-50 disabled:opacity-30" disabled={i === sections.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${s.title} down`}>
                  <ArrowDown className="size-4" />
                </button>
                <button type="button" className="rounded p-2 hover:bg-brand-50" onClick={() => patch(i, { hidden: !s.hidden })} aria-label={s.hidden ? `Show ${s.title}` : `Hide ${s.title}`}>
                  {s.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
                {!s.builtin && (
                  <button
                    type="button"
                    className="rounded p-2 text-danger hover:bg-danger-bg"
                    onClick={() => {
                      setSections((prev) => prev.filter((_, j) => j !== i));
                      if (initial.some((x) => x.key === s.key)) setRemoved((r) => [...r, s.key]);
                    }}
                    aria-label={`Delete ${s.title}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </span>
            </div>
            <label className="block space-y-0.5 text-xs text-muted">
              Text{s.draft ? " (draft of the code, not saved yet)" : ""}
              <textarea className={`${input} min-h-24 resize-y`} rows={5} value={s.body} maxLength={4000} onChange={(e) => patch(i, { body: e.target.value })} />
            </label>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || sections.length >= 30}
          onClick={() =>
            setSections((prev) => [
              ...prev,
              {
                key: cheatsheetKeyFromTitle("New section", prev.map((x) => x.key)),
                title: "New section",
                body: "",
                hidden: false,
                builtin: false,
                draft: false,
              },
            ])
          }
        >
          <Plus aria-hidden="true" />
          Add a section
        </Button>
        <Button size="sm" onClick={save} disabled={pending || !dirty}>
          Save cheat sheet
        </Button>
        <Button size="sm" variant="ghost" onClick={reset} disabled={pending}>
          Back to the drafts
        </Button>
        {message && (
          <span role="status" className={`text-sm ${message.tone === "ok" ? "text-emerald-700" : "text-danger"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
