export const portalNavItems = [
  { label: "Overzicht", href: "/portaal" },
  { label: "Plaatsingen", href: "/portaal/plaatsingen" },
] as const;

export function isActivePortalPath(pathname: string, href: string) {
  if (href === "/portaal") return pathname === "/portaal" || pathname.startsWith("/portaal/vacatures");
  return pathname === href || pathname.startsWith(`${href}/`);
}
