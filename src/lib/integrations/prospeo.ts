import "server-only";
import { z } from "zod";
import type { EmailStatus } from "@/lib/database.types";
import { normalizeEmail } from "@/lib/gtm/normalize";

/**
 * Prospeo: find and verify email addresses (S4).
 *
 * Endpoints used (header X-KEY: PROSPEO_API_KEY, JSON body):
 *   POST https://api.prospeo.io/enrich-person
 *        { only_verified_email: false, data: { first_name, last_name, company_website, linkedin_url } }
 *        -> { error: false, person: { email: { email, status } } }
 *   POST https://api.prospeo.io/email-verifier
 *        { email } -> { error: false, response: { email_status } }
 *
 * ASSUMPTIONS TO CHECK with a real key:
 * - Prospeo replaced the older /email-finder and /linkedin-email-finder
 *   endpoints with /enrich-person in 2025. The response parser also reads the
 *   older shape ({ response: { email, email_status } }) to be safe.
 * - Status values seen: VALID / VERIFIED, CATCH_ALL / ACCEPT_ALL, INVALID,
 *   UNKNOWN / UNVERIFIED. Anything else maps to "unknown" (see mapProspeoStatus).
 * - "No match" comes back as { error: true, error_code: "NO_MATCH" } (HTTP 400
 *   or 404); we treat it as "not found", not as a failure.
 * - Rate limits answer HTTP 429; we wait and retry once. The job also waits
 *   between calls (PROSPEO_DELAY_MS in s4-email-enrich).
 */

const PROSPEO_BASE = "https://api.prospeo.io";

export function hasProspeo() {
  return Boolean(process.env.PROSPEO_API_KEY);
}

function requireKey(): string {
  const key = process.env.PROSPEO_API_KEY;
  if (!key) throw new Error("PROSPEO_API_KEY ontbreekt. Zet deze in de omgevingsvariabelen.");
  return key;
}

/** Prospeo email status -> our email_status. */
export function mapProspeoStatus(status: string | null | undefined): EmailStatus {
  const value = (status ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (value === "VALID" || value === "VERIFIED" || value === "DELIVERABLE") return "valid";
  if (value === "CATCH_ALL" || value === "ACCEPT_ALL" || value === "CATCHALL" || value === "RISKY") return "catch_all";
  if (value === "INVALID" || value === "UNDELIVERABLE" || value === "BOUNCED") return "invalid";
  return "unknown";
}

const responseSchema = z
  .object({
    error: z.boolean().optional(),
    error_code: z.string().optional(),
    message: z.string().optional(),
    person: z.object({}).passthrough().nullish(),
    response: z.object({}).passthrough().nullish(),
  })
  .passthrough();

export type ProspeoResponse = z.infer<typeof responseSchema>;

export type FoundEmail = { email: string; status: EmailStatus; rawStatus: string | null };

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Pull the email and status out of an enrich-person (or older email-finder) response. */
export function parseFoundEmail(body: unknown): FoundEmail | null {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success || parsed.data.error) return null;
  const person = (parsed.data.person ?? {}) as Record<string, unknown>;
  const legacy = (parsed.data.response ?? {}) as Record<string, unknown>;

  const emailField = person.email;
  let email: string | null = null;
  let rawStatus: string | null = null;
  if (emailField && typeof emailField === "object") {
    const obj = emailField as Record<string, unknown>;
    email = str(obj.email) ?? str(obj.value) ?? str(obj.address);
    rawStatus = str(obj.status) ?? str(obj.email_status) ?? str(obj.verification_status);
  } else {
    email = str(emailField);
    rawStatus = str(person.email_status);
  }
  if (!email) {
    email = str(legacy.email);
    rawStatus = str(legacy.email_status) ?? str(legacy.status) ?? rawStatus;
  }
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return { email: normalized, status: mapProspeoStatus(rawStatus), rawStatus };
}

/** Status from an email-verifier response. */
export function parseVerifyStatus(body: unknown): EmailStatus {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success || parsed.data.error) return "unknown";
  const response = (parsed.data.response ?? {}) as Record<string, unknown>;
  const raw = str(response.email_status) ?? str(response.status) ?? str((parsed.data as Record<string, unknown>).email_status);
  return mapProspeoStatus(raw);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(path: string, body: unknown, attempt = 0): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${PROSPEO_BASE}${path}`, {
    method: "POST",
    headers: { "X-KEY": requireKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 429 && attempt < 1) {
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000);
    return post(path, body, attempt + 1);
  }
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, json };
}

function isNoMatch(json: unknown): boolean {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return false;
  const code = (parsed.data.error_code ?? parsed.data.message ?? "").toUpperCase();
  return Boolean(parsed.data.error) && /NO_MATCH|NOT_FOUND|NO_RESULT|INVALID_DATAPOINTS|INSUFFICIENT/.test(code);
}

function failure(path: string, status: number, json: unknown): Error {
  const parsed = responseSchema.safeParse(json);
  const detail = parsed.success ? (parsed.data.error_code ?? parsed.data.message ?? "") : "";
  return new Error(`Prospeo ${path} gaf HTTP ${status}${detail ? ` (${detail})` : ""}.`);
}

/**
 * Find an email by LinkedIn URL and/or name + company domain.
 * Returns null when Prospeo has no match; throws on other errors.
 */
export async function findEmail(input: {
  firstName?: string | null;
  lastName?: string | null;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
}): Promise<FoundEmail | null> {
  const data: Record<string, string> = {};
  if (input.firstName) data.first_name = input.firstName;
  if (input.lastName) data.last_name = input.lastName;
  if (input.companyDomain) data.company_website = input.companyDomain;
  if (input.linkedinUrl) data.linkedin_url = input.linkedinUrl.startsWith("http") ? input.linkedinUrl : `https://www.${input.linkedinUrl}`;
  if (!data.linkedin_url && !(data.first_name && data.last_name && data.company_website)) {
    throw new Error("Te weinig gegevens voor Prospeo: LinkedIn URL of voornaam, achternaam en domein nodig.");
  }

  const { status, json } = await post("/enrich-person", { only_verified_email: false, data });
  if (status >= 200 && status < 300) return parseFoundEmail(json);
  if (isNoMatch(json)) return null;
  throw failure("/enrich-person", status, json);
}

/** Verify one email address. */
export async function verifyEmail(email: string): Promise<EmailStatus> {
  const { status, json } = await post("/email-verifier", { email });
  if (status >= 200 && status < 300) return parseVerifyStatus(json);
  if (isNoMatch(json)) return "unknown";
  throw failure("/email-verifier", status, json);
}
