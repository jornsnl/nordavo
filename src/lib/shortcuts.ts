/**
 * Keyboard shortcuts of the portal and Work (feedback Julius, like Todoist):
 * one list, so the key handler and the "?" overlay never disagree. Pure, so
 * it is tested without a browser (tests/shortcuts.test.ts).
 */

export type GoTarget = { key: string; label: string; href: string; portal: boolean };

/** g, then one of these letters: jump to a screen. `portal` ones are for the team only. */
export const goTargets: GoTarget[] = [
  { key: "t", label: "My tasks", href: "/work", portal: false },
  { key: "r", label: "To review", href: "/work?tab=review", portal: false },
  { key: "i", label: "Inbox (add a task)", href: "/work/add", portal: false },
  { key: "d", label: "Overview (dashboard)", href: "/dashboard", portal: true },
  { key: "l", label: "Leads", href: "/dashboard/leads", portal: true },
  { key: "o", label: "Contacts", href: "/dashboard/contacts", portal: true },
  { key: "p", label: "Pipeline", href: "/dashboard/pipeline", portal: true },
  { key: "m", label: "Meetings", href: "/dashboard/meetings", portal: true },
  { key: "c", label: "Clients", href: "/dashboard/clients", portal: true },
  { key: "v", label: "Vacancies", href: "/dashboard/vacancies", portal: true },
  { key: "k", label: "Candidates", href: "/dashboard/candidates", portal: true },
  { key: "n", label: "Content", href: "/content", portal: true },
  { key: "s", label: "Settings", href: "/dashboard/settings", portal: true },
];

export function goTargetFor(key: string, portal: boolean): GoTarget | null {
  const target = goTargets.find((t) => t.key === key.toLowerCase());
  if (!target || (target.portal && !portal)) return null;
  return target;
}

/** How long after "g" the second letter counts. */
export const GO_TIMEOUT_MS = 1500;

export type ShortcutGroup = { title: string; items: { keys: string[]; label: string }[] };

export function shortcutGroups(portal: boolean, mac: boolean): ShortcutGroup[] {
  const mod = mac ? "⌘" : "Ctrl";
  return [
    {
      title: "Everywhere",
      items: [
        { keys: ["q"], label: "Quick add a task" },
        { keys: ["/"], label: "Search" },
        { keys: [mod, "K"], label: "Search" },
        { keys: ["?"], label: "Show these shortcuts" },
        { keys: ["Esc"], label: "Close a window" },
      ],
    },
    {
      title: "Go to",
      items: goTargets.filter((t) => portal || !t.portal).map((t) => ({ keys: ["g", t.key], label: t.label })),
    },
    {
      title: "Tasks",
      items: [
        { keys: ["j"], label: "Next task (or ↓)" },
        { keys: ["k"], label: "Previous task (or ↑)" },
        { keys: ["e"], label: "Edit the selected task" },
        { keys: ["c"], label: "Complete the selected task (or Enter)" },
        { keys: ["x"], label: "Select for bulk complete (project lists)" },
      ],
    },
  ];
}

type TargetLike = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
  type?: string;
};

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/**
 * Whether the key went to a field someone types in: then no single letter
 * shortcut fires (an "e" in a comment stays an "e").
 */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as TargetLike;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((el.type ?? "text").toLowerCase());
  return Boolean(el.closest?.("[contenteditable=''], [contenteditable='true'], [role='textbox']"));
}

/** The index after moving the selection by `step` (j/k), staying inside the list; -1 when the list is empty. */
export function moveCursor(current: number, step: number, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return step > 0 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + step));
}

/** The project of the page you are on (/work/projects/<id>), so a quick add lands there by default. */
export function projectFromPath(pathname: string | null): string | null {
  const match = /^\/work\/projects\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname ?? "");
  return match ? match[1].toLowerCase() : null;
}
