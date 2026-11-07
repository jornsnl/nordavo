export const portalNavItems = [
  { label: "Overzicht", href: "/portal" },
  { label: "Plaatsingen", href: "/portal/placements" },
] as const;

export function isActivePortalPath(pathname: string, href: string) {
  if (href === "/portal") return pathname === "/portal" || pathname.startsWith("/portal/vacancies");
  return pathname === href || pathname.startsWith(`${href}/`);
}
