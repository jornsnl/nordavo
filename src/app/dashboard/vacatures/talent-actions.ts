"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrorsFrom, formValues, GENERIC_ERROR, parseList } from "@/lib/action-state";
import { askJson, ClaudeRefusalError, hasClaude } from "@/lib/ai/claude";
import { VACANCY_SYSTEM, vacancyExtractionSchema, vacancyInput } from "@/lib/ai/prompts/vacancy";
import { requireStaff } from "@/lib/auth";
import type { MatchStatus, TablesUpdate } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { advanceStage, generateSearchBrief, runMatching } from "@/lib/talent/match";
import { approveProfile, confirmConsentByStaff, generateAnonymousProfile, markProfileSent } from "@/lib/talent/profile";
import type { IntakeState, TalentActionState } from "@/lib/talent/types";

/**
 * Talent workflows on a vacancy (T1 to T6). Every action re-checks staff and
 * uses the user's Supabase client (staff RLS). Candidate details from Airtable
 * are never written to Supabase here (hard rule 11).
 */

const idSchema = z.guid();

function revalidateVacancy(vacancyId: string) {
  revalidatePath(`/dashboard/vacatures/${vacancyId}`);
  revalidatePath("/dashboard/vacatures");
}

function failure(error: unknown, fallback = GENERIC_ERROR): TalentActionState {
  if (error instanceof ClaudeRefusalError) return { error: "Claude kon dit verzoek niet verwerken. Pas de tekst aan of vul de velden zelf in." };
  if (error instanceof Error && error.message) return { error: error.message };
  return { error: fallback };
}

// ---------------------------------------------------------------------------
// T1 Vacature uitlezen
// ---------------------------------------------------------------------------

export async function extractVacancyAction(vacancyId: string, _prev: IntakeState, formData: FormData): Promise<IntakeState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const rawText = String(formData.get("raw_text") ?? "").trim();
  if (rawText.length < 40) {
    return { error: "Plak de volledige vacaturetekst. Dit is te kort om eisen uit te halen.", rawText, fieldErrors: { raw_text: "Te kort" } };
  }
  if (rawText.length > 30000) return { error: "Deze tekst is te lang. Plak alleen de vacature zelf.", rawText };
  if (!hasClaude()) return { error: "Claude is niet gekoppeld (ANTHROPIC_API_KEY ontbreekt). Vul de vaste eisen zelf in.", rawText };

  const supabase = await createClient();
  const { data: vacancy } = await supabase.from("vacancies").select("title").eq("id", vacancyId).maybeSingle();
  if (!vacancy) return { error: "Deze vacature bestaat niet meer." };

  try {
    const extraction = await askJson({
      system: VACANCY_SYSTEM,
      input: vacancyInput({ title: vacancy.title, text: rawText }),
      schema: vacancyExtractionSchema,
      effort: "low",
    });
    return { ok: true, extraction, rawText, message: "Uitgelezen. Controleer de vaste eisen en sla ze op." };
  } catch (error) {
    return { ...failure(error), rawText };
  }
}

const amount = z
  .string()
  .regex(/^\d{1,8}([.,]\d{1,2})?$/, "Vul een bedrag in euro in, bijvoorbeeld 3200.")
  .transform((value) => Number(value.replace(",", ".")));

const requirementsSchema = z
  .object({
    raw_text: z.string().max(30000, "Deze tekst is te lang.").optional(),
    stack: z.string().max(1000, "Gebruik maximaal 1000 tekens.").optional(),
    seniority: z.enum(["medior", "senior", "lead"], { error: "Kies een senioriteit." }),
    hours: z.coerce.number({ error: "Vul een aantal uren in." }).int("Gebruik hele uren.").min(1, "Minimaal 1 uur.").max(60, "Maximaal 60 uur.").optional(),
    timezone_overlap: z.string().max(300, "Gebruik maximaal 300 tekens.").optional(),
    budget_min: amount.optional(),
    budget_max: amount.optional(),
    client_contact_required: z.enum(["ja", "nee"]).optional(),
    must_haves: z.string().max(4000, "Dit is te lang.").optional(),
    nice_to_haves: z.string().max(4000, "Dit is te lang.").optional(),
    unclear: z.string().max(4000, "Dit is te lang.").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.budget_min !== undefined && data.budget_max !== undefined && data.budget_min > data.budget_max) {
      ctx.addIssue({ code: "custom", path: ["budget_max"], message: "Het maximum is lager dan het minimum." });
    }
  });

function lines(value: string | undefined) {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.replace(/^[\s*\-•]+/, "").trim())
    .filter(Boolean);
}

export async function saveRequirementsAction(vacancyId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const parsed = requirementsSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: current } = await supabase.from("vacancies").select("intake_at, raw_text").eq("id", vacancyId).maybeSingle();
  if (!current) return { error: "Deze vacature bestaat niet meer." };

  const update: TablesUpdate<"vacancies"> = {
    stack: parseList(d.stack),
    seniority: d.seniority,
    hours: d.hours ?? null,
    timezone_overlap: d.timezone_overlap ?? null,
    budget_min: d.budget_min ?? null,
    budget_max: d.budget_max ?? null,
    client_contact_required: d.client_contact_required ? d.client_contact_required === "ja" : null,
    must_haves: lines(d.must_haves),
    nice_to_haves: lines(d.nice_to_haves),
    unclear: lines(d.unclear),
    raw_text: d.raw_text ?? current.raw_text,
    intake_at: current.intake_at ?? new Date().toISOString(),
  };
  const { error } = await supabase.from("vacancies").update(update).eq("id", vacancyId);
  if (error) return { error: GENERIC_ERROR };

  revalidateVacancy(vacancyId);
  return {
    ok: true,
    message: "Vaste eisen opgeslagen.",
    warning: update.client_contact_required ? "Let op: de developer moet direct contact hebben met de klanten van de klant. Dat is voor Nordavo een no go." : undefined,
  };
}

/** Tick off an item on the "nog navragen" list. */
export async function resolveUnclearAction(vacancyId: string, item: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data } = await supabase.from("vacancies").select("unclear").eq("id", vacancyId).maybeSingle();
  if (!data) return { error: "Deze vacature bestaat niet meer." };
  const { error } = await supabase
    .from("vacancies")
    .update({ unclear: data.unclear.filter((u) => u !== item) })
    .eq("id", vacancyId);
  if (error) return { error: GENERIC_ERROR };
  revalidateVacancy(vacancyId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// T2 matching and T3 search brief
// ---------------------------------------------------------------------------

export async function runMatchingAction(vacancyId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    const s = await runMatching(supabase, vacancyId);
    revalidateVacancy(vacancyId);
    if (s.scored === 0) {
      return {
        ok: true,
        message: `Geen passende kandidaten in de pool (${s.poolSize} bekeken).`,
        warning: s.searchBrief ? "Er staat een zoekopdracht voor LinkedIn en Naukri klaar." : undefined,
      };
    }
    return {
      ok: true,
      message: `${s.scored} kandidaten gescoord uit een pool van ${s.poolSize}. ${s.stored} matches opgeslagen, ${s.strong} met score 70 of hoger.`,
      warning: s.searchBrief ? "Minder dan 3 sterke matches: er staat een zoekopdracht voor LinkedIn en Naukri klaar." : undefined,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function generateSearchBriefAction(vacancyId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    const { data: matches } = await supabase.from("matches").select("score").eq("vacancy_id", vacancyId);
    const scores = (matches ?? []).map((m) => m.score ?? 0);
    await generateSearchBrief(supabase, vacancyId, { scored: scores.length, strong: scores.filter((s) => s >= 70).length });
    revalidateVacancy(vacancyId);
    return { ok: true, message: "Zoekopdracht gemaakt." };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// Match status (approve, reject, gesprek, aangenomen)
// ---------------------------------------------------------------------------

const matchStatusSchema = z.enum(["voorgesteld", "goedgekeurd", "gesprek", "aangenomen", "afgewezen"]);

export async function setMatchStatusAction(matchId: string, status: MatchStatus, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  const user = await requireStaff();
  if (!idSchema.safeParse(matchId).success || !matchStatusSchema.safeParse(status).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, vacancy_id, status, vacancy:vacancies(talent_stage)")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) return { error: "Deze match bestaat niet meer." };

  const update: TablesUpdate<"matches"> = { status };
  if (status === "goedgekeurd") {
    update.approved_by = user.id;
    update.approved_at = new Date().toISOString();
  }
  if (status === "voorgesteld") {
    update.approved_by = null;
    update.approved_at = null;
  }
  const { error } = await supabase.from("matches").update(update).eq("id", matchId);
  if (error) return { error: GENERIC_ERROR };

  const current = match.vacancy?.talent_stage;
  if (current && (status === "gesprek" || status === "aangenomen")) {
    const next = advanceStage(current, status === "gesprek" ? "gesprekken" : "geplaatst");
    if (next !== current) await supabase.from("vacancies").update({ talent_stage: next }).eq("id", match.vacancy_id);
  }

  revalidateVacancy(match.vacancy_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// T4 anonymous profile and T5 approval and sending
// ---------------------------------------------------------------------------

export async function generateProfileAction(vacancyId: string, matchId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(matchId).success || !idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    const { code } = await generateAnonymousProfile(supabase, matchId);
    revalidateVacancy(vacancyId);
    return { ok: true, message: `Profiel ${code} gemaakt en door de anonimiteitscheck gekomen. Lees het na en keur het goed.` };
  } catch (error) {
    return failure(error);
  }
}

export async function approveProfileAction(profileId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  const user = await requireStaff();
  if (!idSchema.safeParse(profileId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    const vacancyId = await approveProfile(supabase, profileId, user.id);
    revalidateVacancy(vacancyId);
    return { ok: true, message: "Profiel goedgekeurd." };
  } catch (error) {
    return failure(error);
  }
}

export async function confirmConsentAction(profileId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  const user = await requireStaff();
  if (!idSchema.safeParse(profileId).success) return { error: GENERIC_ERROR };
  if (formData.get("consent") !== "on") return { error: "Vink aan dat de kandidaat toestemming gaf." };
  const supabase = await createClient();
  try {
    const vacancyId = await confirmConsentByStaff(supabase, profileId, user.id);
    revalidateVacancy(vacancyId);
    return { ok: true, message: "Toestemming vastgelegd." };
  } catch (error) {
    return failure(error);
  }
}

export async function markProfileSentAction(profileId: string, _prev: TalentActionState, _formData: FormData): Promise<TalentActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(profileId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    const { vacancyId, warning } = await markProfileSent(supabase, profileId);
    revalidateVacancy(vacancyId);
    return { ok: true, message: "Gemarkeerd als verstuurd.", warning };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// T6 doorlooptijd
// ---------------------------------------------------------------------------

const optionalDate = z.iso.date({ error: "Kies een geldige datum." }).optional();
const timelineSchema = z.object({
  intake_at: optionalDate,
  profiles_sent_at: optionalDate,
  first_interview_at: optionalDate,
  start_at: optionalDate,
});

/** A date input (YYYY-MM-DD) as a timestamp at noon UTC, so it shows as the same day in Amsterdam. */
function dateToTimestamp(value: string | undefined) {
  return value ? `${value}T12:00:00Z` : null;
}

export async function updateTimelineAction(vacancyId: string, _prev: TalentActionState, formData: FormData): Promise<TalentActionState> {
  await requireStaff();
  if (!idSchema.safeParse(vacancyId).success) return { error: GENERIC_ERROR };
  const parsed = timelineSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Controleer de datums.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  if (d.intake_at && d.profiles_sent_at && d.profiles_sent_at < d.intake_at) {
    return { error: "Profielen kunnen niet voor de intake zijn verstuurd.", fieldErrors: { profiles_sent_at: "Ligt voor de intake" } };
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("vacancies")
    .select("intake_at, profiles_sent_at, first_interview_at, talent_stage")
    .eq("id", vacancyId)
    .maybeSingle();
  if (!current) return { error: "Deze vacature bestaat niet meer." };

  // Keep the exact time when the day did not change.
  const keep = (value: string | undefined, existing: string | null) =>
    value && existing && existing.slice(0, 10) === value ? existing : dateToTimestamp(value);

  const update: TablesUpdate<"vacancies"> = {
    intake_at: keep(d.intake_at, current.intake_at),
    profiles_sent_at: keep(d.profiles_sent_at, current.profiles_sent_at),
    first_interview_at: keep(d.first_interview_at, current.first_interview_at),
    start_at: d.start_at ?? null,
  };
  let stage = current.talent_stage;
  if (update.profiles_sent_at && !current.profiles_sent_at) stage = advanceStage(stage, "profielen_verstuurd");
  if (update.first_interview_at && !current.first_interview_at) stage = advanceStage(stage, "gesprekken");
  if (stage !== current.talent_stage) update.talent_stage = stage;

  const { error } = await supabase.from("vacancies").update(update).eq("id", vacancyId);
  if (error) return { error: GENERIC_ERROR };
  revalidateVacancy(vacancyId);
  return { ok: true, message: "Tijdlijn opgeslagen." };
}
