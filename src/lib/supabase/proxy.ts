import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ACADEMY_HOME, isAcademyOnlyClient, isAcademyOnlyRole, routeForRole } from "@/lib/academy/routing";
import { env } from "@/lib/env";
import {
  MFA_CHECK_COOKIE,
  MFA_VERIFY_PATH,
  checkSecondStep,
  mfaCheckCookieOptions,
} from "@/lib/security/mfa";

// /api/webhooks, /api/mcp and /api/work authenticate themselves (signatures,
// bearer tokens) and never use the session cookie. /api/academy/calendar is
// the calendar subscription of a placement (token in the path, for calendar
// apps that cannot sign in).
const TOKEN_API_PATHS = ["/api/webhooks", "/api/mcp", "/api/work", "/api/academy/calendar"];
// /api/jobs takes CRON_SECRET or a staff session, so a session there still
// needs its second step.
// The task tool has its own sign-in page, and invite links must open signed out.
const WORK_SIGN_IN = "/work/sign-in";
// /apply/<token> is the public application form for candidates (no account).
// /working-style/<token> is the personal link of the Working Style Profile
// (docs/working-style-profile.md): no account needed, the token is checked
// by the database.
const PUBLIC_PATHS = ["/login", "/auth", "/api/jobs", WORK_SIGN_IN, "/work/invite", "/apply", "/working-style", ...TOKEN_API_PATHS];

// External callers (portal role "caller") only have /caller, plus signing in
// and out (feedback Julius, section 2.10): no portal, no Work, no API and so
// no export. The role is in app_metadata, which the database keeps in sync
// with profiles.role (migration 20261110030000), so this needs no query. The
// pages check the role again (requireStaff, requireCaller) for sessions whose
// token is older than a role change.
const CALLER_PATHS = ["/caller", "/auth", "/login", "/api/webhooks"];

function appMetaOf(claims: Record<string, unknown> | undefined, key: "portal_role" | "academy_role"): string | null {
  const meta = claims?.app_metadata;
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function portalRoleOf(claims: Record<string, unknown> | undefined): string | null {
  return appMetaOf(claims, "portal_role");
}

/** academy_members.academy_role, mirrored by the database (migration 20261115000000). */
function academyRoleOf(claims: Record<string, unknown> | undefined): string | null {
  return appMetaOf(claims, "academy_role");
}

function isCallerSession(claims: Record<string, unknown> | undefined) {
  return portalRoleOf(claims) === "caller";
}

// All a session may reach before its second step: the code form, signing out
// and the e-mail link landing point (it only swaps tokens and redirects).
const SECOND_STEP_PATHS = [MFA_VERIFY_PATH, "/auth/signout", "/auth/confirm"];

function matches(paths: string[], pathname: string) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isPublicPath(pathname: string) {
  return matches(PUBLIC_PATHS, pathname);
}

/**
 * Refreshes the Supabase session on every request and sends visitors
 * to the right place: signed out to /login, halfway through two-step
 * verification to /login/verify, signed in away from /login.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.supabaseUrl(),
    env.supabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims():
  // it refreshes the session and keeps the auth cookies in sync.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const isSignedIn = Boolean(claims);
  const { pathname } = request.nextUrl;

  if (!isSignedIn && !isPublicPath(pathname)) {
    const signIn = matches(["/work", "/content"], pathname) ? WORK_SIGN_IN : "/login";
    return redirectWithCookies(request, response, signIn, pathname);
  }

  // Password done but authenticator app code not yet: only the code form is open.
  // Returning here also keeps /login/verify out of the /login redirect below.
  if (claims && !matches(TOKEN_API_PATHS, pathname)) {
    const step = await checkSecondStep(supabase, claims, (name) => request.cookies.get(name)?.value);
    if (step.required) {
      if (matches(SECOND_STEP_PATHS, pathname)) return response;
      const next = pathname === "/" || pathname === "/login" ? undefined : pathname;
      return redirectWithCookies(request, response, MFA_VERIFY_PATH, next);
    }
    if (step.checkCookie) {
      response.cookies.set(MFA_CHECK_COOKIE, step.checkCookie, mfaCheckCookieOptions);
    }
  }

  if (claims && isCallerSession(claims) && !matches(CALLER_PATHS, pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    return redirectWithCookies(request, response, "/caller");
  }

  // Developers and candidates only reach /academy; clients /portal and
  // /academy, Academy-only clients (client_member, client_reader) /academy
  // (src/lib/academy/routing.ts). Same app_metadata role as callers; the
  // pages check the role again (requireAcademyUser, requireClient). Also for
  // the public API paths (/api/work, /api/mcp, /api/jobs): a session of an
  // Academy-only role gets 403 there, whatever token it carries.
  if (claims && (!isPublicPath(pathname) || pathname.startsWith("/api/"))) {
    const decision = routeForRole(portalRoleOf(claims), pathname, academyRoleOf(claims));
    if (decision.kind === "forbidden") {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    if (decision.kind === "redirect") {
      return redirectWithCookies(request, response, decision.to);
    }
  }

  // Signed-in users skip the login screen, unless it is showing an error
  // (for example a client account that is not linked to a company yet).
  const showsLoginError =
    pathname === "/login" && request.nextUrl.searchParams.has("error");
  if (isSignedIn && !showsLoginError && (pathname === "/login" || pathname === "/")) {
    const role = portalRoleOf(claims);
    const home =
      role === "caller"
        ? "/caller"
        : isAcademyOnlyRole(role) || isAcademyOnlyClient(role, academyRoleOf(claims))
          ? ACADEMY_HOME
          : "/dashboard";
    return redirectWithCookies(request, response, home);
  }
  if (isSignedIn && pathname === WORK_SIGN_IN && !request.nextUrl.searchParams.has("error")) {
    const next = request.nextUrl.searchParams.get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/work";
    return redirectWithCookies(request, response, target.split("?")[0]);
  }

  return response;
}

function redirectWithCookies(
  request: NextRequest,
  source: NextResponse,
  to: string,
  next?: string,
) {
  const url = request.nextUrl.clone();
  url.pathname = to;
  url.search = "";
  if (next && next !== "/") {
    url.searchParams.set("next", next);
  }
  const redirect = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  const cacheControl = source.headers.get("Cache-Control");
  if (cacheControl) redirect.headers.set("Cache-Control", cacheControl);
  return redirect;
}
