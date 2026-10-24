// Shared by the server page and the client filter component.
export const STATUS_FILTERS = [
  { value: "lopend", label: "Lopend (actief en opgezegd)" },
  { value: "active", label: "Actief" },
  { value: "notice", label: "Opgezegd" },
  { value: "ended", label: "Beëindigd" },
  { value: "alle", label: "Alle statussen" },
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];
