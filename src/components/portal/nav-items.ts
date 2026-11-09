export const portalNavItems = [
  { label: "Overview", href: "/portal" },
  { label: "Placements", href: "/portal/placements" },
  // The Academy has its own shell; clients return through "Client portal".
  { label: "Academy", href: "/academy" },
] as const;

export function isActivePortalPath(pathname: string, href: string) {
  if (href === "/portal") return pathname === "/portal" || pathname.startsWith("/portal/vacancies");
  return pathname === href || pathname.startsWith(`${href}/`);
}
