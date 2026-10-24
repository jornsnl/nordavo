// Shared by the server page and the client filter component.
// `short` is the chip label on phones.
export const STATUS_FILTERS = [
  { value: "lopend", label: "Lopend (actief en opgezegd)", short: "Lopend" },
  { value: "active", label: "Actief", short: "Actief" },
  { value: "notice", label: "Opgezegd", short: "Opgezegd" },
  { value: "ended", label: "Beëindigd", short: "Beëindigd" },
  { value: "alle", label: "Alle statussen", short: "Alle" },
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];
