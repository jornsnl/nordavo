// Shared by the server page and the client filter component.
// `short` is the chip label on phones.
export const STATUS_FILTERS = [
  { value: "lopend", label: "Running (active and notice given)", short: "Running" },
  { value: "active", label: "Active", short: "Active" },
  { value: "notice", label: "Notice given", short: "Notice given" },
  { value: "ended", label: "Ended", short: "Ended" },
  { value: "alle", label: "All statuses", short: "All" },
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];
