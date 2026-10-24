import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chains, jobs } from "@/jobs/registry";
import { runByName } from "@/jobs/run";

/**
 * Trigger a job or chain: POST /api/jobs/<name> with
 *   Authorization: Bearer <CRON_SECRET>   (scheduler), or
 *   a signed-in staff session              (button in Beheer, Jobs).
 * Body (optional JSON): { "params": { "vacancy": "<uuid>" } }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!jobs[name] && !chains[name]) {
    return NextResponse.json({ error: "Onbekende job" }, { status: 404 });
  }

  const triggeredBy = await authorize(request);
  if (!triggeredBy) {
    return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { params?: Record<string, string> };
  const result = await runByName(name, { params: body.params ?? {}, triggeredBy });
  const failed = result.results.some(({ result }) => result.status === "failed");
  return NextResponse.json(
    {
      name,
      results: result.results.map(({ job, result }) => ({
        job,
        status: result.status,
        recordsIn: result.recordsIn,
        recordsOut: result.recordsOut,
        error: result.error?.split("\n")[0],
      })),
    },
    { status: failed ? 500 : 200 },
  );
}

async function authorize(request: NextRequest): Promise<string | null> {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return "cron";

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  const { data: isStaff } = await supabase.rpc("is_staff");
  return isStaff ? `user:${data.claims.sub}` : null;
}
