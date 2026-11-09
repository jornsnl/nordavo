// Reading the JSON of wsp_report() and wsp_questionnaire() into typed
// objects. Pure.

import type { Json } from "@/lib/database.types";
import type { ShareStatus } from "./text";
import type { PersonType, ResultRow } from "./view";

export type ClientShare = {
  clientId: string;
  name: string;
  status: ShareStatus;
  consentedAt: string | null;
  revokedAt: string | null;
  requestedAt: string | null;
};

export type ReportData = {
  id: string;
  audience: "person" | "staff" | "client";
  fullName: string;
  roleLabel: string | null;
  personType: PersonType;
  completedAt: string;
  results: ResultRow[];
  canShare: boolean;
  clients: ClientShare[];
  share: { clientName: string; consentedAt: string } | null;
};

export type QuestionnaireData = {
  id: string;
  status: "invited" | "started" | "completed" | "expired";
  personType: PersonType;
  fullName: string;
  introAccepted: boolean;
  expiresAt: string;
  completedAt: string | null;
  signedInAsPerson: boolean;
  page: number;
  answers: Record<string, number>;
  items: { id: string; position: number; statement: string }[];
};

type Obj = Record<string, Json | undefined>;

function obj(value: Json | null | undefined): Obj | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
}
const str = (v: Json | undefined): string | null => (typeof v === "string" ? v : null);
const num = (v: Json | undefined): number => (typeof v === "number" ? v : Number(v ?? 0));

export function parseReport(value: Json | null | undefined): ReportData | null {
  const o = obj(value);
  if (!o || typeof o.id !== "string") return null;
  const audience = o.audience === "client" || o.audience === "staff" ? o.audience : "person";
  const results = Array.isArray(o.results)
    ? o.results.map(obj).filter((r): r is Obj => Boolean(r)).map((r) => ({
        dimension: str(r.dimension) ?? "",
        score: num(r.score),
        band: str(r.band) ?? "",
        mean: r.mean === undefined || r.mean === null ? null : num(r.mean),
      }))
    : [];
  const clients = Array.isArray(o.clients)
    ? o.clients.map(obj).filter((c): c is Obj => Boolean(c)).map((c) => ({
        clientId: str(c.client_id) ?? "",
        name: str(c.name) ?? "",
        status: (c.status === "shared" || c.status === "withdrawn" ? c.status : "not_shared") as ShareStatus,
        consentedAt: str(c.consented_at),
        revokedAt: str(c.revoked_at),
        requestedAt: str(c.requested_at),
      }))
    : [];
  const share = obj(o.share ?? null);
  return {
    id: o.id,
    audience,
    fullName: str(o.full_name) ?? "",
    roleLabel: str(o.role_label),
    personType: o.person_type === "developer" ? "developer" : "candidate",
    completedAt: str(o.completed_at) ?? "",
    results,
    canShare: o.can_share === true,
    clients,
    share: share ? { clientName: str(share.client_name) ?? "", consentedAt: str(share.consented_at) ?? "" } : null,
  };
}

export function parseQuestionnaire(value: Json | null | undefined): QuestionnaireData | null {
  const o = obj(value);
  if (!o || typeof o.id !== "string") return null;
  const status = o.status === "started" || o.status === "completed" || o.status === "expired" ? o.status : "invited";
  const answers: Record<string, number> = {};
  const rawAnswers = obj(o.answers ?? null);
  if (rawAnswers) for (const [k, v] of Object.entries(rawAnswers)) if (typeof v === "number") answers[k] = v;
  const items = Array.isArray(o.items)
    ? o.items.map(obj).filter((i): i is Obj => Boolean(i)).map((i) => ({ id: str(i.id) ?? "", position: num(i.position), statement: str(i.statement) ?? "" }))
    : [];
  return {
    id: o.id,
    status,
    personType: o.person_type === "developer" ? "developer" : "candidate",
    fullName: str(o.full_name) ?? "",
    introAccepted: o.intro_accepted === true,
    expiresAt: str(o.expires_at) ?? "",
    completedAt: str(o.completed_at),
    signedInAsPerson: o.signed_in_as_person === true,
    page: Math.max(1, num(o.page) || 1),
    answers,
    items,
  };
}
