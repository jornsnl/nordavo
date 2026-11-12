// Page layouts of record pages (feedback Julius, round 3: "Blokken en velden
// zelf toevoegen, verwijderen, verplaatsen en hernoemen"). Per record type
// the team decides which blocks a page shows, in which order, in which column
// and (candidates) on which tab, renames blocks and fixed fields, hides them,
// and adds blocks of its own that hold custom fields.
//
// Stored in public.record_layouts.config (20261123200000_custom_fields_layouts.sql)
// as a StoredLayout; everything here is pure so Settings, the pages and the
// tests share it. A stored layout only holds what differs from the default,
// so new blocks in the code show up by themselves.

import type { LayoutEntity } from "@/lib/database.types";
import { DEFAULT_BLOCK, KEY_PATTERN, LABEL_MAX, keyFromLabel, type CustomFieldDefinition } from "@/lib/custom-fields";

export type { LayoutEntity };

export type LayoutColumn = "main" | "side";

export type CoreFieldSpec = { key: string; label: string };

export type BlockSpec = {
  key: string;
  label: string;
  column: LayoutColumn;
  /** Default tab (record types with tabs). */
  tab?: string;
  /** The page renders the title itself, so a new name shows. False: the block has its own title. */
  renamable?: boolean;
  /** Fixed fields in this block that can be renamed, hidden and moved. */
  fields?: CoreFieldSpec[];
  /** Shown only on some records (for instance a talent pool vacancy). */
  note?: string;
};

export const layoutEntities: { value: LayoutEntity; label: string; plural: string }[] = [
  { value: "candidate", label: "Candidate", plural: "Candidates" },
  { value: "vacancy", label: "Vacancy", plural: "Vacancies" },
  { value: "client", label: "Client", plural: "Clients" },
  { value: "placement", label: "Placement", plural: "Placements" },
];

export function isLayoutEntity(value: unknown): value is LayoutEntity {
  return layoutEntities.some((e) => e.value === value);
}

/** Tabs of a record page. Candidates have tabs; the other pages are one page (tab null). */
export const layoutTabs: Record<LayoutEntity, { key: string; label: string }[]> = {
  candidate: [
    { key: "overview", label: "Overview" },
    { key: "selection", label: "Selection" },
    { key: "matching", label: "Matching" },
    { key: "contract", label: "Contract" },
    { key: "activity", label: "Activity" },
  ],
  vacancy: [],
  client: [],
  placement: [],
};

const custom = (column: LayoutColumn, tab?: string): BlockSpec => ({
  key: DEFAULT_BLOCK,
  label: "Custom fields",
  column,
  tab,
  renamable: true,
});

/** The fixed blocks of each page, in their default order. */
export const layoutBlocks: Record<LayoutEntity, BlockSpec[]> = {
  candidate: [
    {
      key: "profile",
      label: "Profile",
      column: "main",
      tab: "overview",
      renamable: true,
      fields: [
        { key: "role", label: "Role" },
        { key: "location", label: "Location" },
        { key: "experience", label: "Experience" },
        { key: "owner", label: "Owner" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
        { key: "skills", label: "Skills" },
        { key: "summary", label: "Summary" },
      ],
    },
    custom("main", "overview"),
    { key: "documents", label: "Documents and links", column: "side", tab: "overview", renamable: true },
    { key: "vacancies", label: "Vacancies", column: "main", tab: "selection", renamable: true },
    { key: "recruitment", label: "Topper, parking and notes per stage", column: "main", tab: "selection" },
    { key: "interviews", label: "Interviews", column: "main", tab: "selection" },
    { key: "screening", label: "CV screening", column: "main", tab: "selection" },
    { key: "matching", label: "Matching", column: "main", tab: "matching" },
    { key: "wsp", label: "Working style profile", column: "main", tab: "matching", renamable: true },
    { key: "compensation", label: "Compensation", column: "side", tab: "contract" },
    { key: "academy", label: "Academy", column: "main", tab: "contract" },
    { key: "extras", label: "Notes, tasks and files", column: "side", tab: "activity" },
  ],
  vacancy: [
    { key: "link_client", label: "Link to a client", column: "main", note: "Talent pool vacancies only" },
    { key: "timeline", label: "Timeline", column: "main" },
    { key: "requirements", label: "Requirements", column: "main" },
    { key: "matches", label: "Matches", column: "main" },
    { key: "search_brief", label: "Search brief", column: "main" },
    { key: "pipeline", label: "Pipeline", column: "main" },
    { key: "park", label: "Park vacancy", column: "main" },
    { key: "form", label: "Application form", column: "main" },
    { key: "wsp", label: "Working style profile", column: "main" },
    { key: "screening", label: "Screening", column: "main" },
    {
      key: "details",
      label: "Details",
      column: "main",
      renamable: true,
      fields: [
        { key: "client", label: "Client" },
        { key: "source", label: "Source" },
        { key: "onepage_deal", label: "Old OnePageCRM deal" },
        { key: "seniority", label: "Seniority" },
        { key: "monthly_budget", label: "Monthly budget" },
        { key: "desired_start", label: "Desired start" },
        { key: "opened_on", label: "Opened on" },
        { key: "closed_on", label: "Closed on" },
        { key: "owner", label: "Owner" },
        { key: "stack", label: "Stack" },
      ],
    },
    { key: "job_profile", label: "Job profile", column: "main", renamable: true },
    custom("side"),
    { key: "extras", label: "Notes, tasks and files", column: "side" },
  ],
  client: [
    {
      key: "details",
      label: "Details",
      column: "main",
      renamable: true,
      fields: [
        { key: "website", label: "Website" },
        { key: "industry", label: "Industry" },
        { key: "location", label: "Location" },
        { key: "owner", label: "Owner" },
        { key: "client_since", label: "Client since" },
        { key: "notes", label: "Notes" },
      ],
    },
    custom("main"),
    { key: "vacancies", label: "Vacancies", column: "main", renamable: true },
    { key: "placements", label: "Placements", column: "main", renamable: true },
    { key: "contacts", label: "Contact persons", column: "side" },
    { key: "extras", label: "Notes, tasks and files", column: "side" },
  ],
  placement: [
    {
      key: "details",
      label: "Details",
      column: "main",
      renamable: true,
      fields: [
        { key: "candidate", label: "Candidate" },
        { key: "client", label: "Client" },
        { key: "vacancy", label: "Vacancy" },
        { key: "monthly_rate", label: "Monthly rate" },
        { key: "start_date", label: "Start date" },
        { key: "duration", label: "Duration" },
        { key: "next_checkin", label: "Next check-in" },
        { key: "notice", label: "Notice period" },
        { key: "end_date", label: "End date" },
        { key: "notes", label: "Notes" },
      ],
    },
    custom("main"),
    { key: "checkins", label: "Check-ins", column: "main", renamable: true },
    { key: "guarantee", label: "Guarantee period", column: "side", renamable: true },
    { key: "academy", label: "Academy", column: "side" },
    { key: "wsp", label: "Working style profile (developer)", column: "side", renamable: true },
    { key: "extras", label: "Notes, tasks and files", column: "side" },
  ],
};

// ---------------------------------------------------------------------------
// Stored shape
// ---------------------------------------------------------------------------

export type StoredBlock = {
  key: string;
  label?: string;
  hidden?: boolean;
  tab?: string;
  column?: LayoutColumn;
  /** A block the team added; it holds custom fields only. */
  custom?: boolean;
  /** Order of the fixed fields (keys); fields not listed follow in the default order. */
  fieldOrder?: string[];
};

export type StoredField = { label?: string; hidden?: boolean };

export type StoredLayout = {
  blocks?: StoredBlock[];
  /** Fixed field overrides by field key (unique per record type). */
  fields?: Record<string, StoredField>;
};

export const MAX_CUSTOM_BLOCKS = 30;

// ---------------------------------------------------------------------------
// Resolved shape, what pages and Settings use
// ---------------------------------------------------------------------------

export type ResolvedField = {
  key: string;
  label: string;
  defaultLabel: string;
  hidden: boolean;
};

export type ResolvedBlock = {
  key: string;
  label: string;
  defaultLabel: string;
  hidden: boolean;
  /** Null on pages without tabs. */
  tab: string | null;
  column: LayoutColumn;
  /** Added by the team: holds custom fields, can be deleted. */
  added: boolean;
  /** Holds custom fields (the default block and blocks the team added). */
  holdsFields: boolean;
  renamable: boolean;
  note?: string;
  coreFields: ResolvedField[];
  customFields: CustomFieldDefinition[];
};

export type ResolvedLayout = {
  entity: LayoutEntity;
  blocks: ResolvedBlock[];
  tabs: { key: string; label: string }[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  return label || undefined;
}

/**
 * Checks and cleans a layout read from the database or sent by a form.
 * Unknown blocks, tabs and fields are dropped, labels trimmed, duplicates
 * removed. Never throws: a broken layout becomes the default one.
 */
export function sanitizeLayout(entity: LayoutEntity, raw: unknown): StoredLayout {
  const specs = layoutBlocks[entity];
  const fixedKeys = new Set(specs.map((s) => s.key));
  const tabKeys = new Set(layoutTabs[entity].map((t) => t.key));
  const fieldKeys = new Set(specs.flatMap((s) => (s.fields ?? []).map((f) => f.key)));
  const out: StoredLayout = {};
  if (!isRecord(raw)) return out;

  if (Array.isArray(raw.blocks)) {
    const seen = new Set<string>();
    const blocks: StoredBlock[] = [];
    let added = 0;
    for (const item of raw.blocks) {
      if (!isRecord(item) || typeof item.key !== "string") continue;
      const key = item.key;
      if (seen.has(key)) continue;
      const isFixed = fixedKeys.has(key);
      const isAdded = !isFixed && item.custom === true && KEY_PATTERN.test(key);
      if (!isFixed && !isAdded) continue;
      if (isAdded && ++added > MAX_CUSTOM_BLOCKS) continue;
      seen.add(key);
      const block: StoredBlock = { key };
      const label = cleanLabel(item.label);
      if (isAdded) {
        block.custom = true;
        block.label = label ?? "New block";
      } else if (label) {
        block.label = label;
      }
      if (item.hidden === true) block.hidden = true;
      if (typeof item.tab === "string" && tabKeys.has(item.tab)) block.tab = item.tab;
      if (item.column === "main" || item.column === "side") block.column = item.column;
      if (isFixed && Array.isArray(item.fieldOrder)) {
        const own = new Set((specs.find((s) => s.key === key)?.fields ?? []).map((f) => f.key));
        const order = [...new Set(item.fieldOrder.filter((k): k is string => typeof k === "string" && own.has(k)))];
        if (order.length > 0) block.fieldOrder = order;
      }
      blocks.push(block);
    }
    if (blocks.length > 0) out.blocks = blocks;
  }

  if (isRecord(raw.fields)) {
    const fields: Record<string, StoredField> = {};
    for (const [key, value] of Object.entries(raw.fields)) {
      if (!fieldKeys.has(key) || !isRecord(value)) continue;
      const field: StoredField = {};
      const label = cleanLabel(value.label);
      if (label) field.label = label;
      if (value.hidden === true) field.hidden = true;
      if (field.label || field.hidden) fields[key] = field;
    }
    if (Object.keys(fields).length > 0) out.fields = fields;
  }
  return out;
}

/**
 * The full layout of a page: stored choices on top of the defaults, with the
 * custom fields placed in their blocks. Fixed blocks missing from the stored
 * order (new in the code) are put after the block they follow by default.
 * Custom fields of a block that does not exist (any more) go to "Custom fields".
 */
export function resolveLayout(entity: LayoutEntity, stored: StoredLayout | null | undefined, definitions: CustomFieldDefinition[] = []): ResolvedLayout {
  const specs = layoutBlocks[entity];
  const tabs = layoutTabs[entity];
  const clean = sanitizeLayout(entity, stored ?? {});
  const storedBlocks = clean.blocks ?? [];
  const byKey = new Map(storedBlocks.map((b) => [b.key, b]));

  // Order: stored order, then the missing fixed blocks after their default predecessor.
  const order = storedBlocks.map((b) => b.key);
  specs.forEach((spec, i) => {
    if (order.includes(spec.key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = order.indexOf(specs[j].key);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    order.splice(at, 0, spec.key);
  });

  const blockKeys = new Set(order.filter((k) => k === DEFAULT_BLOCK || byKey.get(k)?.custom));
  const fieldsByBlock = new Map<string, CustomFieldDefinition[]>();
  for (const def of [...definitions].sort((a, b) => a.position - b.position)) {
    if (def.archivedAt) continue;
    const key = blockKeys.has(def.blockKey) ? def.blockKey : DEFAULT_BLOCK;
    fieldsByBlock.set(key, [...(fieldsByBlock.get(key) ?? []), def]);
  }

  const firstTab = tabs[0]?.key ?? null;
  const blocks = order.map((key): ResolvedBlock => {
    const spec = specs.find((s) => s.key === key);
    const own = byKey.get(key);
    const added = !spec;
    const defaultLabel = spec?.label ?? own?.label ?? "New block";
    const coreSpecs = spec?.fields ?? [];
    const fieldOrder = own?.fieldOrder ?? [];
    const orderedCore = [
      ...fieldOrder.map((k) => coreSpecs.find((f) => f.key === k)).filter((f): f is CoreFieldSpec => Boolean(f)),
      ...coreSpecs.filter((f) => !fieldOrder.includes(f.key)),
    ];
    return {
      key,
      label: own?.label ?? defaultLabel,
      defaultLabel,
      hidden: own?.hidden === true,
      tab: tabs.length === 0 ? null : (own?.tab ?? spec?.tab ?? firstTab),
      column: own?.column ?? spec?.column ?? "main",
      added,
      holdsFields: added || key === DEFAULT_BLOCK,
      renamable: added || spec?.renamable === true,
      note: spec?.note,
      coreFields: orderedCore.map((f) => ({
        key: f.key,
        label: clean.fields?.[f.key]?.label ?? f.label,
        defaultLabel: f.label,
        hidden: clean.fields?.[f.key]?.hidden === true,
      })),
      customFields: fieldsByBlock.get(key) ?? [],
    };
  });

  return { entity, blocks, tabs };
}

/** Back to the stored shape: only what differs from the default. */
export function toStored(layout: ResolvedLayout): StoredLayout {
  const specs = layoutBlocks[layout.entity];
  const blocks: StoredBlock[] = layout.blocks.map((b) => {
    const spec = specs.find((s) => s.key === b.key);
    const out: StoredBlock = { key: b.key };
    if (b.added) {
      out.custom = true;
      out.label = b.label;
    } else if (b.label !== b.defaultLabel) {
      out.label = b.label;
    }
    if (b.hidden) out.hidden = true;
    if (b.tab && b.tab !== (spec?.tab ?? layout.tabs[0]?.key)) out.tab = b.tab;
    if (b.column !== (spec?.column ?? "main")) out.column = b.column;
    const defaultOrder = (spec?.fields ?? []).map((f) => f.key);
    const order = b.coreFields.map((f) => f.key);
    if (order.join() !== defaultOrder.join()) out.fieldOrder = order;
    return out;
  });
  const fields: Record<string, StoredField> = {};
  for (const block of layout.blocks) {
    for (const f of block.coreFields) {
      const field: StoredField = {};
      if (f.label !== f.defaultLabel) field.label = f.label;
      if (f.hidden) field.hidden = true;
      if (field.label || field.hidden) fields[f.key] = field;
    }
  }
  const out: StoredLayout = { blocks };
  if (Object.keys(fields).length > 0) out.fields = fields;
  return out;
}

// ---------------------------------------------------------------------------
// Using a layout on a page
// ---------------------------------------------------------------------------

export function findBlock(layout: ResolvedLayout, key: string): ResolvedBlock | undefined {
  return layout.blocks.find((b) => b.key === key);
}

/** Title of a block: the name the team gave it, or the default. */
export function blockLabel(layout: ResolvedLayout, key: string, fallback?: string): string {
  return findBlock(layout, key)?.label ?? fallback ?? key;
}

/** Whether a block is shown. Unknown blocks are shown, so a page never loses content by a typo. */
export function blockVisible(layout: ResolvedLayout, key: string): boolean {
  return !findBlock(layout, key)?.hidden;
}

/** Visible blocks of a tab (or of the whole page without tabs), in order, optionally of one column. */
export function blocksForTab(layout: ResolvedLayout, tab: string | null, column?: LayoutColumn): ResolvedBlock[] {
  return layout.blocks.filter(
    (b) => !b.hidden && (tab === null || layout.tabs.length === 0 || b.tab === tab) && (!column || b.column === column),
  );
}

/**
 * Fixed fields of a block as the team set them up: renamed, hidden ones
 * left out, in their order. Items with a key the block does not know keep
 * their place at the end, unchanged.
 */
export function applyFieldLayout<T extends { key: string; label: string }>(block: ResolvedBlock | undefined, items: T[]): T[] {
  if (!block) return items;
  const known = new Map(block.coreFields.map((f, i) => [f.key, { f, i }]));
  const ordered = items
    .map((item, i) => ({ item, i, k: known.get(item.key) }))
    .sort((a, b) => (a.k ? a.k.i : 1000 + a.i) - (b.k ? b.k.i : 1000 + b.i));
  return ordered
    .filter(({ k }) => !k?.f.hidden)
    // Only a name the team gave replaces the page's own label (which can depend on the record, like "Prospect").
    .map(({ item, k }) => (k && k.f.label !== k.f.defaultLabel ? { ...item, label: k.f.label } : item));
}

/** One fixed field: its label (the team's name or `fallback`) and whether it is shown. */
export function coreField(block: ResolvedBlock | undefined, key: string, fallback: string): { label: string; hidden: boolean } {
  const f = block?.coreFields.find((c) => c.key === key);
  return { label: f && f.label !== f.defaultLabel ? f.label : fallback, hidden: f?.hidden ?? false };
}

// ---------------------------------------------------------------------------
// Changes (Settings), pure so they can be tested
// ---------------------------------------------------------------------------

function swap<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Move a block one place up or down in the page order. */
export function moveBlock(layout: ResolvedLayout, key: string, direction: "up" | "down"): ResolvedLayout {
  const i = layout.blocks.findIndex((b) => b.key === key);
  return { ...layout, blocks: swap(layout.blocks, i, direction === "up" ? i - 1 : i + 1) };
}

export function updateBlock(
  layout: ResolvedLayout,
  key: string,
  change: Partial<Pick<ResolvedBlock, "label" | "hidden" | "tab" | "column">>,
): ResolvedLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((b) => {
      if (b.key !== key) return b;
      const next = { ...b, ...change };
      if (change.label !== undefined) next.label = cleanLabel(change.label) ?? b.defaultLabel;
      if (!next.renamable) next.label = b.label;
      return next;
    }),
  };
}

/** Add a block of the team's own, right after `after` (or at the end). */
export function addBlock(layout: ResolvedLayout, label: string, options: { tab?: string | null; column?: LayoutColumn; after?: string } = {}): {
  layout: ResolvedLayout;
  key: string;
} {
  const name = cleanLabel(label) ?? "New block";
  const taken = new Set([...layout.blocks.map((b) => b.key), ...layoutBlocks[layout.entity].map((s) => s.key)]);
  const key = keyFromLabel(`b ${name}`, taken);
  const block: ResolvedBlock = {
    key,
    label: name,
    defaultLabel: name,
    hidden: false,
    tab: layout.tabs.length === 0 ? null : (options.tab ?? layout.tabs[0].key),
    column: options.column ?? "main",
    added: true,
    holdsFields: true,
    renamable: true,
    coreFields: [],
    customFields: [],
  };
  const at = options.after ? layout.blocks.findIndex((b) => b.key === options.after) + 1 : layout.blocks.length;
  const blocks = [...layout.blocks];
  blocks.splice(at > 0 ? at : blocks.length, 0, block);
  return { layout: { ...layout, blocks }, key };
}

/** Remove a block the team added. Its fields go back to "Custom fields" (the page does that by itself). */
export function removeBlock(layout: ResolvedLayout, key: string): ResolvedLayout {
  return { ...layout, blocks: layout.blocks.filter((b) => !(b.key === key && b.added)) };
}

export function moveCoreField(layout: ResolvedLayout, blockKey: string, fieldKey: string, direction: "up" | "down"): ResolvedLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((b) => {
      if (b.key !== blockKey) return b;
      const i = b.coreFields.findIndex((f) => f.key === fieldKey);
      return { ...b, coreFields: swap(b.coreFields, i, direction === "up" ? i - 1 : i + 1) };
    }),
  };
}

export function updateCoreField(
  layout: ResolvedLayout,
  blockKey: string,
  fieldKey: string,
  change: { label?: string; hidden?: boolean },
): ResolvedLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((b) =>
      b.key !== blockKey
        ? b
        : {
            ...b,
            coreFields: b.coreFields.map((f) =>
              f.key !== fieldKey
                ? f
                : {
                    ...f,
                    label: change.label !== undefined ? (cleanLabel(change.label) ?? f.defaultLabel) : f.label,
                    hidden: change.hidden ?? f.hidden,
                  },
            ),
          },
    ),
  };
}

/** Blocks a custom field can go in, for the field form. */
export function fieldBlocks(layout: ResolvedLayout): { key: string; label: string }[] {
  return layout.blocks.filter((b) => b.holdsFields).map((b) => ({ key: b.key, label: b.label }));
}
