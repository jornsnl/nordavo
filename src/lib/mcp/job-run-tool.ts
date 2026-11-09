import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { accessError } from "@/lib/mcp/module-scope";
import { check, fail, idSchema, ok, type McpToolContext } from "@/lib/mcp/shared";
import { effectiveModules, jobModule } from "@/lib/modules";

/**
 * log_job_run: Claude's scheduled tasks (docs/claude-jobs.md) log every run
 * here, shown on the Jobs page. Sales tasks (claude-replies and the others)
 * need the Sales module, claude-match and claude-screening Recruitment.
 */
export const JOB_RUN_TOOLS = ["log_job_run"] as const;

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

function rpcError(error: { message: string } | null, what: string) {
  return error ? fail(`Could not ${what}: ${error.message}`) : null;
}

export function registerJobRunTool(server: McpServer, ctx: McpToolContext) {
  const modules = effectiveModules(ctx.role, ctx.modules);
  if (ctx.access !== "write" || !(modules.includes("sales") || modules.includes("recruitment"))) return;
  const { db } = ctx;
  const actor = ctx.userId;

  server.registerTool(
    "log_job_run",
    {
      title: "Log scheduled task run",
      description:
        "Start and finish the log of one run of a scheduled task, shown on the Jobs page under Claude's scheduled tasks. Call with action start and a job_name such as claude-replies at the beginning (returns run_id), and with action finish, the run_id, status, records in and out and an error at the end.",
      inputSchema: {
        action: z.enum(["start", "finish"]),
        job_name: z
          .string()
          .regex(/^claude-[a-z0-9-]{2,60}$/, "Use a name like claude-replies (claude- and lowercase letters, digits and dashes).")
          .optional()
          .describe("claude-match and claude-screening belong to Recruitment, every other claude-* name to Sales."),
        run_id: idSchema.optional(),
        status: z.enum(["success", "failed"]).optional(),
        records_in: z.number().int().min(0).max(1_000_000).optional(),
        records_out: z.number().int().min(0).max(1_000_000).optional(),
        error: z.string().max(5000).optional(),
        meta: z.record(z.string(), z.json()).optional().describe("Small summary, e.g. {\"replies\": 4, \"to_review\": 1}."),
      },
      annotations: WRITE,
    },
    async (input) => {
      const by = { actor_id: actor, actor: ctx.name, token: ctx.tokenName };
      if (input.action === "start") {
        if (!input.job_name) return fail("Give job_name with action start.");
        if (input.run_id || input.status) return fail("run_id and status go with action finish.");
        const mod = jobModule(input.job_name);
        if (mod && !modules.includes(mod)) return fail(accessError([mod]));
        const { data, error } = await db
          .from("job_runs")
          .insert({
            job_name: input.job_name,
            triggered_by: "claude",
            status: "running",
            records_in: input.records_in ?? 0,
            meta: { ...(input.meta ?? {}), ...by } as Json,
          })
          .select("id, started_at")
          .single();
        return rpcError(error, "start the run") ?? ok({ run_id: data?.id, started_at: data?.started_at });
      }
      if (!input.run_id) return fail("Give run_id with action finish.");
      if (!input.status) return fail("Give status (success or failed) with action finish.");
      const run = check(
        await db.from("job_runs").select("id, job_name, meta, triggered_by, status, records_in").eq("id", input.run_id).maybeSingle(),
        "run",
      );
      if (!run || Array.isArray(run) || run.triggered_by !== "claude") return fail("Run not found.");
      const runModule = jobModule(run.job_name);
      if (runModule && !modules.includes(runModule)) return fail("Run not found.");
      if (run.status !== "running") return fail("This run is already finished.");
      const oldMeta = run.meta && typeof run.meta === "object" && !Array.isArray(run.meta) ? run.meta : {};
      const { error } = await db
        .from("job_runs")
        .update({
          status: input.status,
          finished_at: new Date().toISOString(),
          records_in: input.records_in ?? run.records_in,
          records_out: input.records_out ?? 0,
          error: input.status === "failed" ? (input.error ?? "Failed without a message") : (input.error ?? null),
          meta: { ...oldMeta, ...(input.meta ?? {}) } as Json,
        })
        .eq("id", input.run_id);
      return rpcError(error, "finish the run") ?? ok({ run_id: input.run_id, status: input.status });
    },
  );
}
