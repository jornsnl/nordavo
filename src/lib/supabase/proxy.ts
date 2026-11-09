import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ACADEMY_HOME, isAcademyOnlyRole, routeForRole } from "@/lib/academy/routing";
import { env } from "@/lib/env";
import {
  MFA_CHECK_COOKIE,
  MFA_VERIFY_PATH,
  checkSecondStep,
  mfaCheckCookieOptions,
} from "@/lib/security/mfa";

// /api/webhooks, /api/mcp and /api/work authenticate themselves (signatures,
// bearer tokens) and never use the session cookie.
const TOKEN_API_PATHS = ["/api/webhooks", "/api/mcp", "/api/work"];
// /api/jobs takes CRON_SECRET or a staff session, so a session there still
// needs its second step.
// The task tool has its own sign-in page, and invite links must open signed out.
const WORK_SIGN_IN = "/work/sign-in";
// /apply/<token> is the public application form for candidates (no account).
const PUBLIC_PATHS = ["/login", "/auth", "/api/jobs", WORK_SIGN_IN, "/work/invite", "/apply", ...TOKEN_API_PATHS];

// External callers (portal role "caller") only have /caller, plus signing in
// and out (feedback Julius, section 2.10): no portal, no Work, no API and so
// no export. The role is in app_metadata, which the database keeps in sync
// with profiles.role (migration 20261110030000), so this needs no query. The
// pages check the role again (requireStaff, requireCaller) for sessions whose
// token is older than a role change.
const CALLER_PATHS = ["/caller", "/auth", "/login", "/api/webhooks"];

function portalRoleOf(claims: Record<string, unknown> | undefined): string | null {
  const meta = claims?.app_metadata;
  if (!meta || typeof meta !== "object") return null;
  const role = (meta as Record<string, unknown>).portal_role;
  return typeof role === "string" ? role : null;
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
    const signIn = matches(["/work"], pathname) ? WORK_SIGN_IN : "/login";
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
  // /academy (src/lib/academy/routing.ts). Same app_metadata role as callers;
  // the pages check the role again (requireAcademyUser, requireClient).
  if (claims && !isPublicPath(pathname)) {
    const decision = routeForRole(portalRoleOf(claims), pathname);
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
    const home = role === "caller" ? "/caller" : isAcademyOnlyRole(role) ? ACADEMY_HOME : "/dashboard";
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
