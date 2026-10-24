import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import {
  MFA_CHECK_COOKIE,
  MFA_VERIFY_PATH,
  checkSecondStep,
  mfaCheckCookieOptions,
} from "@/lib/security/mfa";

// /api/webhooks and /api/mcp authenticate themselves (signatures, bearer tokens)
// and never use the session cookie.
const TOKEN_API_PATHS = ["/api/webhooks", "/api/mcp"];
// /api/jobs takes CRON_SECRET or a staff session, so a session there still
// needs its second step.
const PUBLIC_PATHS = ["/login", "/auth", "/api/jobs", ...TOKEN_API_PATHS];

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
 * verification to /login/verificatie, signed in away from /login.
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
    return redirectWithCookies(request, response, "/login", pathname);
  }

  // Password done but authenticator app code not yet: only the code form is open.
  // Returning here also keeps /login/verificatie out of the /login redirect below.
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

  // Signed-in users skip the login screen, unless it is showing an error
  // (for example a client account that is not linked to a company yet).
  const showsLoginError =
    pathname === "/login" && request.nextUrl.searchParams.has("error");
  if (isSignedIn && !showsLoginError && (pathname === "/login" || pathname === "/")) {
    return redirectWithCookies(request, response, "/dashboard");
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
