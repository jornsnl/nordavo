// Where each role may go (Academy: rollen en zichtbaarheid). Pure, used by
// the proxy (src/lib/supabase/proxy.ts) and the sign-in redirects, tested in
// tests/academy-routing.test.ts. Pages check the role again on the server.
//
//   developer, candidate  only /academy, plus signing in and out and the
//                         e-mail link landing point (/auth, /login) and the
//                         Academy API (/api/academy); every other API is 403
//   client                /portal and /academy (and Work, where a client
//                         may be a guest), plus /auth, /login and /api
//                         (API routes check their own access)
//   client with Academy   Academy-only clients: /academy, Work, /auth,
//   role client_member    /login, /api/academy and /api/work; never /portal
//   or client_reader      or another API. The database refuses them the
//                         portal as well (current_client_id() is null)
//
// The Academy role comes from app_metadata.academy_role (kept in sync by the
// database, like portal_role).

import { safeNextPath } from "@/lib/safe-redirect";

export const ACADEMY_HOME = "/academy";

const ACADEMY_ONLY_PATHS = [ACADEMY_HOME, "/auth", "/login", "/api/academy"];
const ACADEMY_CLIENT_PATHS = [ACADEMY_HOME, "/work", "/auth", "/login", "/api/academy", "/api/work"];
const CLIENT_PATHS = ["/portal", ACADEMY_HOME, "/work", "/auth", "/login", "/api"];

function matches(paths: string[], pathname: string) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** Roles that only have the Academy. */
export function isAcademyOnlyRole(role: string | null | undefined): role is "developer" | "candidate" {
  return role === "developer" || role === "candidate";
}

/**
 * Client users whose Academy role keeps them out of the client portal: only
 * client users without an Academy role, or with client_admin, use /portal.
 */
export function isAcademyOnlyClient(role: string | null | undefined, academyRole: string | null | undefined): boolean {
  return role === "client" && (academyRole === "client_member" || academyRole === "client_reader");
}

/** May this user open the client portal (/portal and the portal_* functions)? */
export function hasClientPortal(role: string | null | undefined, academyRole: string | null | undefined): boolean {
  return role === "client" && !isAcademyOnlyClient(role, academyRole);
}

export type RouteDecision = { kind: "allow" } | { kind: "redirect"; to: string } | { kind: "forbidden" };

/**
 * What the proxy does with a signed-in session of this portal role (and
 * Academy role) on this path. Roles not covered here (staff, external,
 * caller) are handled by the existing rules.
 */
export function routeForRole(
  role: string | null | undefined,
  pathname: string,
  academyRole?: string | null,
): RouteDecision {
  if (isAcademyOnlyRole(role)) {
    if (matches(ACADEMY_ONLY_PATHS, pathname)) return { kind: "allow" };
    if (pathname.startsWith("/api/")) return { kind: "forbidden" };
    return { kind: "redirect", to: ACADEMY_HOME };
  }
  if (isAcademyOnlyClient(role, academyRole)) {
    if (matches(ACADEMY_CLIENT_PATHS, pathname)) return { kind: "allow" };
    if (pathname.startsWith("/api/")) return { kind: "forbidden" };
    return { kind: "redirect", to: ACADEMY_HOME };
  }
  if (role === "client") {
    if (matches(CLIENT_PATHS, pathname)) return { kind: "allow" };
    return { kind: "redirect", to: "/portal" };
  }
  return { kind: "allow" };
}

/** The landing page after signing in, honouring ?next= where the role may go. */
export function landingPathFor(role: string | null | undefined, next: unknown, academyRole?: string | null): string {
  if (isAcademyOnlyRole(role) || isAcademyOnlyClient(role, academyRole)) {
    const target = safeNextPath(next, ACADEMY_HOME);
    return matches([ACADEMY_HOME], target.split("?")[0]) ? target : ACADEMY_HOME;
  }
  if (role === "client") {
    const target = safeNextPath(next, "/portal");
    return matches(["/portal", ACADEMY_HOME], target.split("?")[0]) ? target : "/portal";
  }
  return safeNextPath(next);
}
