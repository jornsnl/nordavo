import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/**
 * Claude is used only for judgement (qualification, segment, score, opening
 * lines, reading vacancies, matching, anonymous profiles). Everything that must
 * go exactly the same every time is plain code.
 */
export const CLAUDE_MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;

export function hasClaude() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY ontbreekt. Zet deze in de omgevingsvariabelen.");
  }
  client ??= new Anthropic();
  return client;
}

export class ClaudeRefusalError extends Error {
  constructor(public category: string | null) {
    super(`Claude weigerde het verzoek${category ? ` (${category})` : ""}.`);
  }
}

type AskJsonOptions<T extends z.ZodType> = {
  /** Stable instructions; cached across calls. Keep volatile data out of it. */
  system: string;
  /** The per-record input. */
  input: string;
  schema: T;
  /** low for simple extraction, medium (default) for judgement. */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

/**
 * One structured call: returns data validated against `schema`.
 * Throws ClaudeRefusalError on a refusal and Error when the output does not parse.
 */
export async function askJson<T extends z.ZodType>({
  system,
  input,
  schema,
  effort = "medium",
  maxTokens = 16000,
}: AskJsonOptions<T>): Promise<z.infer<T>> {
  const response = await getClient().beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    // Server-side fallback: a declined request is re-run on Anthropic's
    // recommended fallback model instead of failing the job.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort, format: zodOutputFormat(schema) },
    messages: [{ role: "user", content: input }],
  });

  if (response.stop_reason === "refusal") {
    throw new ClaudeRefusalError(response.stop_details?.category ?? null);
  }
  if (response.parsed_output == null) {
    throw new Error(`Claude gaf geen geldige JSON terug (stop_reason: ${response.stop_reason}).`);
  }
  return response.parsed_output as z.infer<T>;
}
