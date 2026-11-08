// The full list of IANA time zones for the Work profile picker, and the one
// check the server uses to accept a zone. Both come from the same list, so a
// zone the picker offers is always accepted and nothing else is.

/** Old names that ICU still reports first; we show and store the current one. */
const RENAMED: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Enderbury": "Pacific/Kanton",
  // Links Postgres does not always ship (no "backward" tzdata file).
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
};

/** Zones people here pick most, shown first in the picker. */
export const popularTimeZones = [
  "Europe/Amsterdam",
  "Asia/Kolkata",
  "Europe/London",
  "Asia/Dubai",
  "Asia/Singapore",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

function supported(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

let cached: string[] | null = null;

/** Every IANA zone this runtime knows, with current names, plus UTC. Sorted. */
export function allTimeZones(): string[] {
  if (cached) return cached;
  const zones = new Set<string>(["UTC"]);
  for (const zone of supported()) zones.add(RENAMED[zone] ?? zone);
  // A runtime without supportedValuesOf still offers the popular zones.
  for (const zone of popularTimeZones) zones.add(zone);
  cached = [...zones].sort((a, b) => a.localeCompare(b));
  return cached;
}

/**
 * Server side check for a submitted zone: it must be on the picker's list,
 * directly or as another name of a listed zone, so values stored before this
 * list existed keep working. Store normalizeTimeZone(zone).
 */
export function isListedTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64 || zone !== zone.trim()) return false;
  return allTimeZones().includes(normalizeTimeZone(zone));
}

/** What Intl calls a zone ("America/Argentina/Buenos_Aires" is "America/Buenos_Aires"), or null when unknown. */
function intlName(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * The listed form of a zone: the name itself when listed, else the listed
 * name of the same zone (old names and links such as "Asia/Calcutta" or
 * "US/Eastern"). Unknown zones come back unchanged, and are not listed.
 */
export function normalizeTimeZone(zone: string): string {
  const list = allTimeZones();
  if (list.includes(zone)) return zone;
  if (RENAMED[zone]) return RENAMED[zone];
  const resolved = intlName(zone);
  if (!resolved) return zone;
  const named = RENAMED[resolved] ?? resolved;
  return list.includes(named) ? named : zone;
}

/** "UTC+05:30" for a zone at a moment. */
export function utcOffsetLabel(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part || part === "GMT") return "UTC+00:00";
    return part.replace("GMT", "UTC");
  } catch {
    return "";
  }
}

export type TimeZoneOption = { value: string; label: string; offset: string; search: string };
export type TimeZoneGroup = { region: string; zones: TimeZoneOption[] };

/** "America/Argentina/Buenos_Aires" to "Argentina / Buenos Aires". */
export function cityLabel(zone: string): string {
  const parts = zone.split("/");
  const rest = parts.length > 1 ? parts.slice(1) : parts;
  return rest.join(" / ").replace(/_/g, " ");
}

/** The picker's list: popular zones first, then grouped by region (Europe, Asia, ...). */
export function groupedTimeZones(at: Date = new Date()): TimeZoneGroup[] {
  const option = (zone: string): TimeZoneOption => {
    const offset = utcOffsetLabel(zone, at);
    const label = zone === "UTC" ? "UTC" : cityLabel(zone);
    return { value: zone, label, offset, search: `${zone} ${label} ${offset}`.toLowerCase().replace(/_/g, " ") };
  };
  const groups = new Map<string, TimeZoneOption[]>();
  for (const zone of allTimeZones()) {
    const region = zone.includes("/") ? zone.split("/")[0] : "Other";
    const list = groups.get(region) ?? [];
    list.push(option(zone));
    groups.set(region, list);
  }
  const popular = popularTimeZones.filter((z) => allTimeZones().includes(z)).map(option);
  return [
    { region: "Popular", zones: popular },
    ...[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([region, zones]) => ({ region, zones })),
  ];
}
