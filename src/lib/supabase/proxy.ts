import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Refreshes the Supabase session on every request and sends visitors
 * to the right place: signed out to /login, signed in away from /login.
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
  const isSignedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!isSignedIn && !isPublicPath(pathname)) {
    return redirectWithCookies(request, response, "/login", pathname);
  }

  if (isSignedIn && (pathname === "/login" || pathname === "/")) {
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
