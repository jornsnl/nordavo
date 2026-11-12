import { NextResponse } from "next/server";
import { requireJobDb } from "@/lib/gtm/jobs";
import { parseInboundMail, verifyInboundSecret, verifySvixSignature } from "@/lib/mail/bcc";
import { bccDomain, handleInboundMail, logInvalidInbound } from "@/lib/mail/bcc-inbound";

/**
 * Inbound mail webhook for BCC logging (docs/mail.md). A mail with someone's
 * BCC address (<token>@MAIL_BCC_DOMAIN) becomes an outbound mail activity on
 * the matched contacts and companies. Reads Resend inbound (email.received),
 * Postmark inbound and a generic JSON (for example from a Cloudflare Email Worker).
 *
 * Public in the proxy. Authenticated with INBOUND_MAIL_SECRET (header
 * X-Inbound-Secret, Bearer, Basic auth or ?secret=) or, for Resend, the Svix
 * signature with RESEND_INBOUND_WEBHOOK_SECRET.
 *
 * 200 for handled and ignored mail (so the provider does not retry), 401 for a
 * missing secret or a bad one, 503 when MAIL_BCC_DOMAIN is not set, 500 when
 * writing fails (the provider retries; Message-ID prevents doubles).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const sharedSecret = process.env.INBOUND_MAIL_SECRET;
  const svixSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;

  if (!sharedSecret && !svixSecret) {
    console.error("[inbound-mail] INBOUND_MAIL_SECRET is missing: webhook refused.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 401 });
  }
  const url = new URL(request.url);
  const headers = request.headers;
  const authorized =
    verifyInboundSecret(sharedSecret, {
      header: headers.get("x-inbound-secret"),
      authorization: headers.get("authorization"),
      query: url.searchParams.get("secret"),
    }) ||
    verifySvixSignature(rawBody, svixSecret, {
      id: headers.get("svix-id") ?? headers.get("webhook-id"),
      timestamp: headers.get("svix-timestamp") ?? headers.get("webhook-timestamp"),
      signature: headers.get("svix-signature") ?? headers.get("webhook-signature"),
    });
  if (!authorized) return NextResponse.json({ error: "Invalid secret" }, { status: 401 });

  const domain = bccDomain();
  if (!domain) {
    console.error("[inbound-mail] MAIL_BCC_DOMAIN is missing.");
    return NextResponse.json({ error: "BCC logging not configured" }, { status: 503 });
  }

  const db = requireJobDb();
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(await logInvalidInbound(db, "The body is not JSON."));
  }
  const mail = parseInboundMail(json);
  if (!mail) return NextResponse.json(await logInvalidInbound(db, "The JSON is not a mail in a known format."));

  try {
    return NextResponse.json(await handleInboundMail(db, mail, domain));
  } catch (error) {
    console.error("[inbound-mail] processing failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
