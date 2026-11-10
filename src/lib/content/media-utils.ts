// Pure helpers of the media library, safe for client components and tests.

export type MediaKind = "image" | "video" | "pdf" | "other";

export function mediaKind(mime: string | null | undefined): MediaKind {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "other";
}

export type MediaSuggestion = {
  description?: string;
  tags?: string[];
  people?: string[];
  setting?: string;
  mood?: string;
  clothing?: string;
  orientation?: "portrait" | "landscape" | "square";
  author_in_photo?: boolean;
};

export function parseMediaSuggestion(value: unknown): MediaSuggestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()) : undefined);
  const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  const suggestion: MediaSuggestion = {
    description: text(v.description),
    tags: strings(v.tags),
    people: strings(v.people),
    setting: text(v.setting),
    mood: text(v.mood),
    clothing: text(v.clothing),
    orientation: v.orientation === "portrait" || v.orientation === "landscape" || v.orientation === "square" ? v.orientation : undefined,
    author_in_photo: typeof v.author_in_photo === "boolean" ? v.author_in_photo : undefined,
  };
  const clean = Object.fromEntries(Object.entries(suggestion).filter(([, x]) => x !== undefined && !(Array.isArray(x) && x.length === 0)));
  return Object.keys(clean).length ? (clean as MediaSuggestion) : null;
}

export type MediaFilters = {
  undescribed?: boolean;
  unused?: boolean;
  person?: string;
  setting?: string;
  tag?: string;
  folder?: string;
  q?: string;
};

export type MediaFacets = { people: string[]; settings: string[]; tags: string[]; folders: string[] };

export function parseMediaFilters(params: Record<string, string | string[] | undefined>): MediaFilters {
  const one = (key: string) => {
    const v = params[key];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim().slice(0, 120) : undefined;
  };
  return {
    undescribed: one("undescribed") === "1",
    unused: one("unused") === "1",
    person: one("person"),
    setting: one("setting"),
    tag: one("tag"),
    folder: one("folder"),
    q: one("q"),
  };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
