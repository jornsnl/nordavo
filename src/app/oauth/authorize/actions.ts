"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  AUTHORIZE_FIELDS,
  authorizationResponseUrl,
  checkAuthorizeRequest,
  createAuthorizationCode,
  oauthUrls,
} from "@/lib/mcp/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Allow or deny on the consent page. The hidden fields are checked again
 * here: the page is only a view of the request, never trusted on its own.
 */
export async function decideAuthorization(formData: FormData) {
  const user = await requireStaff();
  const db = createAdminClient();

  const input: Record<string, string | undefined> = {};
  for (const field of AUTHORIZE_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string" && value) input[field] = value;
  }
  const backToPage = `/oauth/authorize?${new URLSearchParams(input as Record<string, string>).toString()}`;
  if (!db) redirect(backToPage);

  const siteUrl = env.siteUrl();
  const check = await checkAuthorizeRequest(input, db, siteUrl);
  const iss = oauthUrls(siteUrl).issuer;

  if (check.kind === "fatal") redirect(backToPage);
  if (check.kind === "redirect") {
    redirect(
      authorizationResponseUrl(check.redirectUri, {
        error: check.error,
        error_description: check.description,
        state: check.state,
        iss,
      }),
    );
  }

  if (formData.get("decision") !== "allow") {
    redirect(
      authorizationResponseUrl(check.params.redirect_uri, {
        error: "access_denied",
        error_description: "The user did not allow access.",
        state: check.params.state,
        iss,
      }),
    );
  }

  const access = formData.get("access") === "write" ? "write" : "read";
  const code = await createAuthorizationCode(db, { params: check.params, userId: user.id, access });
  if (!code) {
    redirect(
      authorizationResponseUrl(check.params.redirect_uri, {
        error: "server_error",
        error_description: "Could not create an authorization code.",
        state: check.params.state,
        iss,
      }),
    );
  }

  redirect(authorizationResponseUrl(check.params.redirect_uri, { code, state: check.params.state, iss }));
}
