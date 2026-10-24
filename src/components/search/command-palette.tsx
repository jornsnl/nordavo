"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Building2, Handshake, LoaderCircle, Radar, Search, Users, type LucideIcon } from "lucide-react";
import type { RecordHit, SearchGroups } from "@/lib/data/search";
import { globalSearch } from "./actions";

const groups: { key: keyof SearchGroups; label: string; icon: LucideIcon }[] = [
  { key: "company", label: "Leads", icon: Radar },
  { key: "client", label: "Klanten", icon: Building2 },
  { key: "vacancy", label: "Vacatures", icon: Briefcase },
  { key: "candidate", label: "Kandidaten", icon: Users },
  { key: "placement", label: "Plaatsingen", icon: Handshake },
];

const emptyResults: SearchGroups = { company: [], client: [], vacancy: [], candidate: [], placement: [] };

const subscribeNever = () => () => {};

/** "Ctrl K" or "⌘ K", depending on the platform. "Ctrl K" on the server. */
export function useShortcutLabel() {
  return useSyncExternalStore(
    subscribeNever,
    () => (/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? "⌘ K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

/**
 * Global search over clients, vacancies, candidates and placements.
 * Opens with Ctrl/Cmd + K or through `open`. On phones it is a full screen
 * search sheet with a large field, a "Annuleren" button and big result rows.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const id = useId();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestId = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchGroups>(emptyResults);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState("");
  const [active, setActive] = useState(0);

  // Keyboard shortcut, everywhere in the dashboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    if (!open && node.open) node.close();
  }, [open]);

  const flat: RecordHit[] = groups.flatMap((g) => results[g.key]);
  const optionId = (index: number) => `${id}-option-${index}`;

  function search(value: string) {
    clearTimeout(timer.current);
    const current = ++requestId.current;
    if (value.trim().length < 2) {
      setResults(emptyResults);
      setSearched("");
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const next = await globalSearch(value);
        if (current !== requestId.current) return;
        setResults(next);
        setSearched(value.trim());
        setActive(0);
      } finally {
        if (current === requestId.current) setLoading(false);
      }
    }, 200);
  }

  function go(hit: RecordHit | undefined) {
    if (!hit) return;
    onOpenChange(false);
    router.push(hit.href);
  }

  const showEmpty = !loading && searched !== "" && flat.length === 0;
  const offsets = groups.map((_, i) => groups.slice(0, i).reduce((sum, g) => sum + results[g.key].length, 0));

  return (
    <dialog
      ref={dialog}
      aria-label="Zoeken"
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (event.target === dialog.current) onOpenChange(false);
      }}
      className="sheet-up mx-auto mt-[12dvh] mb-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-border bg-card p-0 text-ink shadow-2xl backdrop:bg-brand-950/50 max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:shadow-none"
    >
      {open && (
        <div className="max-sm:flex max-sm:h-full max-sm:flex-col">
          <div className="flex items-center gap-3 border-b border-border px-4 max-sm:shrink-0 max-sm:gap-2 max-sm:pt-safe max-sm:pl-[max(1rem,env(safe-area-inset-left))] max-sm:pr-[max(0.5rem,env(safe-area-inset-right))]">
            {loading ? (
              <LoaderCircle className="size-5 shrink-0 animate-spin text-muted" aria-hidden="true" />
            ) : (
              <Search className="size-5 shrink-0 text-muted" aria-hidden="true" />
            )}
            <label htmlFor={`${id}-input`} className="sr-only">
              Zoek klanten, vacatures, kandidaten en plaatsingen
            </label>
            <input
              ref={inputRef}
              id={`${id}-input`}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Zoek op klant, vacature of kandidaat"
              className="h-14 min-w-0 flex-1 appearance-none bg-transparent text-base text-ink outline-none placeholder:text-muted/70 [&::-webkit-search-cancel-button]:hidden max-sm:h-16"
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={flat.length > 0 ? optionId(active) : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                search(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && flat.length > 0) {
                  event.preventDefault();
                  setActive((i) => (i + 1) % flat.length);
                } else if (event.key === "ArrowUp" && flat.length > 0) {
                  event.preventDefault();
                  setActive((i) => (i - 1 + flat.length) % flat.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  go(flat[active]);
                }
              }}
            />
            <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 font-sans text-[11px] text-muted sm:inline">
              Esc
            </kbd>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="min-h-11 shrink-0 rounded-lg px-2 text-[15px] font-semibold text-brand-700 active:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500 sm:hidden"
            >
              Annuleren
            </button>
          </div>

          <div
            id={`${id}-list`}
            role="listbox"
            aria-label="Zoekresultaten"
            className="max-h-[60dvh] overflow-y-auto overscroll-contain p-2 max-sm:max-h-none max-sm:flex-1 max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
          >
            {groups.map((group, groupIndex) => {
              const hits = results[group.key];
              if (hits.length === 0) return null;
              const Icon = group.icon;
              return (
                <div key={group.key} role="group" aria-labelledby={`${id}-group-${group.key}`} className="mb-2 last:mb-0">
                  <p
                    id={`${id}-group-${group.key}`}
                    className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase"
                  >
                    {group.label}
                  </p>
                  {hits.map((hit, hitIndex) => {
                    const current = offsets[groupIndex] + hitIndex;
                    const selected = current === active;
                    return (
                      <div
                        key={hit.id}
                        id={optionId(current)}
                        role="option"
                        aria-selected={selected}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setActive(current)}
                        onClick={() => go(hit)}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 active:bg-brand-100 max-sm:min-h-14 max-sm:py-3 ${
                          selected ? "bg-brand-50 text-brand-900" : "text-ink"
                        }`}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 max-sm:size-10">
                          <Icon className="size-4 max-sm:size-5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium max-sm:text-[15px]">{hit.label}</span>
                          {hit.sublabel && <span className="block truncate text-xs text-muted">{hit.sublabel}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {showEmpty && (
              <p className="px-3 py-8 text-center text-sm text-muted">Niets gevonden voor &ldquo;{searched}&rdquo;.</p>
            )}
            {searched === "" && !loading && (
              <p className="px-3 py-8 text-center text-sm text-muted">
                Typ minstens 2 letters.
                <span className="pointer-coarse:hidden"> Gebruik de pijltjes om te kiezen en Enter om te openen.</span>
              </p>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

/** Search button for the dark sidebar, with the shortcut hint. */
export function SidebarSearchButton({ onClick }: { onClick: () => void }) {
  const shortcut = useShortcutLabel();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts="Control+K Meta+K"
      className="mb-6 flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-brand-100/70 transition hover:bg-white/10 hover:text-white active:bg-white/10 max-lg:py-2.5 focus-visible:outline-2 focus-visible:outline-accent-500"
    >
      <Search className="size-[18px] text-brand-200/60" aria-hidden="true" />
      <span className="flex-1 text-left">Zoeken</span>
      <kbd className="rounded-md border border-white/15 px-1.5 py-0.5 font-sans text-[11px] text-brand-200/70 pointer-coarse:hidden">
        {shortcut}
      </kbd>
    </button>
  );
}

/** Icon button for the mobile top bar. */
export function MobileSearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-lg text-brand-900 hover:bg-brand-50 active:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500"
      aria-label="Zoeken"
    >
      <Search className="size-5" aria-hidden="true" />
    </button>
  );
}
