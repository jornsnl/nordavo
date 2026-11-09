import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeDbToModules } from "@/lib/mcp/module-scope";
import { canSeePath, effectiveModules, entityTypesFor, jobModule, moduleForPath } from "@/lib/modules";
import {
  buildInviteUrl,
  hasStarted,
  inviteMail,
  isBookingUrl,
  isDueForReminder,
  parseInterviewBooking,
  reminderMail,
  stageForInterview,
} from "@/lib/recruitment/interviews";

const escape = (v: string) => v.replace(/</g, "&lt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------

test("effectiveModules: admins all, members what is stored, others none", () => {
  assert.deepEqual(effectiveModules("admin", []), ["sales", "recruitment", "clients", "report"]);
  assert.deepEqual(effectiveModules("member", ["report", "recruitment", "bogus"]), ["recruitment", "report"]);
  assert.deepEqual(effectiveModules("member", null), ["sales", "recruitment", "clients", "report"]);
  assert.deepEqual(effectiveModules("client", ["sales"]), []);
  assert.deepEqual(effectiveModules("external", ["sales"]), []);
});

test("routes and menu items follow modules", () => {
  assert.equal(moduleForPath("/dashboard/leads/123"), "sales");
  assert.equal(moduleForPath("/dashboard/vacancies/1/pipeline"), "recruitment");
  assert.equal(moduleForPath("/dashboard/tasks"), null);
  assert.equal(canSeePath("/dashboard/contacts", ["recruitment"]), false);
  assert.equal(canSeePath("/dashboard/candidates", ["recruitment"]), true);
  assert.equal(canSeePath("/dashboard/settings", []), true);
  assert.equal(canSeePath("/dashboard/leads", null), true);
});

test("jobs and record types per module mirror the database", () => {
  assert.equal(jobModule("s2-qualify"), "sales");
  assert.equal(jobModule("s10-weekly-report"), "sales");
  assert.equal(jobModule("t2-match"), "recruitment");
  assert.equal(jobModule("interview-reminders"), "recruitment");
  assert.equal(jobModule("work-notify"), null);
  assert.deepEqual(entityTypesFor(["recruitment"]), ["vacancy", "candidate", "application", "placement"]);
});

// ---------------------------------------------------------------------------
// MCP: the secret key client scoped to modules
// ---------------------------------------------------------------------------

type Call = { table: string; ops: [string, unknown[]][] };

function fakeDb() {
  const calls: Call[] = [];
  const db = {
    rpc: () => "rpc",
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "insert", "update", "delete", "eq", "or", "in", "limit"]) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: 1 }], error: null });
      return builder;
    },
  };
  return { db, calls };
}

test("scopeDbToModules refuses tables of missing modules with a clear error", async () => {
  const { db, calls } = fakeDb();
  const scoped = scopeDbToModules(db, ["recruitment"]);
  const denied = await (scoped.from("companies") as unknown as { select: (s: string) => { eq: (a: string, b: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> } })
    .select("id")
    .eq("id", "x");
  assert.equal(denied.data, null);
  assert.match(denied.error?.message ?? "", /Sales module/);
  assert.equal(calls.length, 0, "never reaches the database");

  const allowed = await (scoped.from("candidates") as unknown as { select: (s: string) => PromiseLike<{ data: unknown }> }).select("id");
  assert.deepEqual(allowed.data, [{ id: 1 }]);
  // Clients are readable from recruitment.
  scoped.from("clients");
  assert.deepEqual(
    calls.map((c) => c.table),
    ["candidates", "clients"],
  );
  assert.equal(scoped.rpc(), "rpc");
});

test("scopeDbToModules filters notes and tasks to visible record types", async () => {
  const { db, calls } = fakeDb();
  const scoped = scopeDbToModules(db, ["recruitment"]);
  const notes = scoped.from("notes") as unknown as {
    select: (s: string) => { eq: (a: string, b: string) => unknown };
    insert: (v: unknown) => PromiseLike<{ error: { message: string } | null }>;
  };
  notes.select("id").eq("entity_id", "x");
  assert.deepEqual(calls[0].ops[1], ["or", ["entity_type.is.null,entity_type.not.in.(client,company)"]]);

  const blocked = await notes.insert({ entity_type: "company", entity_id: "x", body: "hi" });
  assert.match(blocked.error?.message ?? "", /Sales module/);
  await notes.insert({ entity_type: "candidate", entity_id: "x", body: "hi" });
  assert.equal(calls[0].ops.at(-1)?.[0], "insert");

  // All modules: no extra filter at all.
  const all = fakeDb();
  (scopeDbToModules(all.db, ["sales", "recruitment", "clients", "report"]).from("work_task_links") as unknown as { select: (s: string) => unknown }).select("id");
  assert.deepEqual(all.calls[0].ops, [["select", ["id"]]]);
});

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

const IID = "6f1c2c1e-6c43-4d0c-9a51-3d1f0b7f2a10";
const AID = "0b8a3a52-1f1e-4b8e-8a8e-5b7b1f9d2c33";

test("buildInviteUrl prefills name, email and the ids Cal.com sends back", () => {
  const url = new URL(
    buildInviteUrl("https://cal.com/judith/interview?duration=30", {
      name: "Asha Rao",
      email: "asha@example.in",
      interviewId: IID,
      applicationId: AID,
    }),
  );
  assert.equal(url.origin + url.pathname, "https://cal.com/judith/interview");
  assert.equal(url.searchParams.get("duration"), "30");
  assert.equal(url.searchParams.get("name"), "Asha Rao");
  assert.equal(url.searchParams.get("email"), "asha@example.in");
  assert.equal(url.searchParams.get("metadata[interview_id]"), IID);
  assert.equal(url.searchParams.get("metadata[application_id]"), AID);
  assert.equal(url.searchParams.get("utm_content"), IID);
});

test("isBookingUrl only accepts https links", () => {
  assert.equal(isBookingUrl("https://cal.com/floris"), true);
  assert.equal(isBookingUrl("http://cal.com/floris"), false);
  assert.equal(isBookingUrl("javascript:alert(1)"), false);
  assert.equal(isBookingUrl(""), false);
  assert.equal(isBookingUrl(null), false);
});

test("parseInterviewBooking reads metadata, utm fallback, reschedule and cancel", () => {
  const created = parseInterviewBooking({
    triggerEvent: "BOOKING_CREATED",
    payload: {
      uid: "bk_1",
      startTime: "2026-11-12T09:00:00Z",
      endTime: "2026-11-12T09:30:00Z",
      organizer: { email: "Judith@nordavo.nl" },
      attendees: [{ email: "judith@nordavo.nl" }, { email: " Asha@Example.in " }],
      metadata: { interview_id: IID, application_id: AID },
    },
  });
  assert.deepEqual(created, {
    trigger: "BOOKING_CREATED",
    uid: "bk_1",
    previousUid: null,
    interviewId: IID,
    attendeeEmail: "asha@example.in",
    startTime: "2026-11-12T09:00:00Z",
    endTime: "2026-11-12T09:30:00Z",
    reason: null,
  });

  const viaUtm = parseInterviewBooking({
    triggerEvent: "BOOKING_RESCHEDULED",
    payload: { uid: "bk_2", rescheduleUid: "bk_1", tracking: { utm_content: IID }, metadata: { interview_id: "not-a-uuid" } },
  });
  assert.equal(viaUtm?.interviewId, IID);
  assert.equal(viaUtm?.previousUid, "bk_1");

  const cancelled = parseInterviewBooking({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "bk_2", cancellationReason: "Sick" } });
  assert.equal(cancelled?.reason, "Sick");
  assert.equal(cancelled?.interviewId, null);

  assert.equal(parseInterviewBooking({ triggerEvent: "PING", payload: { uid: "x" } }), null);
  assert.equal(parseInterviewBooking({ triggerEvent: "BOOKING_CREATED", payload: {} }), null);
  assert.equal(parseInterviewBooking("nope"), null);
});

test("stages, reminders and started interviews", () => {
  assert.equal(stageForInterview("english_interview"), "interview");
  assert.equal(stageForInterview("client_interview"), "client_interview");

  const now = new Date("2026-11-11T10:00:00Z");
  const base = { status: "scheduled" as const, reminder_sent_at: null };
  assert.equal(isDueForReminder({ ...base, starts_at: "2026-11-12T09:00:00Z" }, now), true);
  assert.equal(isDueForReminder({ ...base, starts_at: "2026-11-12T11:00:00Z" }, now), false, "more than 24 hours away");
  assert.equal(isDueForReminder({ ...base, starts_at: "2026-11-11T09:00:00Z" }, now), false, "already started");
  assert.equal(isDueForReminder({ ...base, starts_at: "2026-11-12T09:00:00Z", reminder_sent_at: "2026-11-11T09:00:00Z" }, now), false);
  assert.equal(isDueForReminder({ ...base, status: "invited", starts_at: "2026-11-12T09:00:00Z" }, now), false);
  assert.equal(hasStarted("2026-11-11T09:00:00Z", now), true);
  assert.equal(hasStarted(null, now), false);
});

test("mails are escaped and carry the link and the time", () => {
  const invite = inviteMail(escape, {
    candidateName: "Asha Rao",
    vacancyTitle: "Laravel <developer>",
    interviewerName: "Judith",
    kind: "english_interview",
    url: 'https://cal.com/judith?x="1"',
  });
  assert.match(invite.subject, /English interview: Laravel <developer>/);
  assert.match(invite.text, /^Hi Asha,/);
  assert.match(invite.text, /invite you to an English interview with Judith/);
  assert.match(invite.html, /Laravel &lt;developer>/);
  assert.match(invite.html, /x=&quot;1&quot;/);
  assert.match(invite.text, /https:\/\/cal\.com\/judith/);

  const reminder = reminderMail(escape, {
    to: "interviewer",
    candidateName: "Asha",
    vacancyTitle: "Laravel developer",
    interviewerName: "Judith",
    kind: "interview",
    startsAt: "2026-11-12T09:00:00Z",
    timeZone: "Europe/Amsterdam",
    portalUrl: "https://portal.nordavo.nl/dashboard/candidates/1",
  });
  assert.match(reminder.text, /10:00/);
  assert.match(reminder.html, /dashboard\/candidates\/1/);
});
