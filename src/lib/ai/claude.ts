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
    throw new Error("ANTHROPIC_API_KEY is missing. Set it in the environment variables.");
  }
  client ??= new Anthropic();
  return client;
}

export class ClaudeRefusalError extends Error {
  constructor(public category: string | null) {
    super(`Claude declined the request${category ? ` (${category})` : ""}.`);
  }
}

/** A part of the user message: text (optionally a cache breakpoint after it) or a PDF file. */
export type ClaudeContentPart =
  | { type: "text"; text: string; cache?: boolean }
  | { type: "pdf"; base64: string; title?: string };

type AskJsonOptions<T extends z.ZodType> = {
  /** Stable instructions; cached across calls. Keep volatile data out of it. */
  system: string;
  /** The per-record input: plain text, or parts (stable parts first, marked cache: true). */
  input: string | ClaudeContentPart[];
  schema: T;
  /** low for simple extraction, medium (default) for judgement. */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** Model id; defaults to CLAUDE_MODEL. Cheaper models suit bulk work. */
  model?: string;
};

/** Token usage of one call, for cost tracking. */
export type ClaudeUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Haiku has no server-side refusal fallback. */
function supportsFallback(model: string) {
  return !model.startsWith("claude-haiku");
}

function toContent(input: string | ClaudeContentPart[]) {
  if (typeof input === "string") return input;
  return input.map((part) =>
    part.type === "pdf"
      ? {
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: part.base64 },
          ...(part.title ? { title: part.title } : {}),
        }
      : {
          type: "text" as const,
          text: part.text,
          ...(part.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
        },
  );
}

/**
 * One structured call: returns data validated against `schema` and the token usage.
 * Throws ClaudeRefusalError on a refusal and Error when the output does not parse.
 */
export async function askJsonWithUsage<T extends z.ZodType>({
  system,
  input,
  schema,
  effort = "medium",
  maxTokens = 16000,
  model = CLAUDE_MODEL,
}: AskJsonOptions<T>): Promise<{ data: z.infer<T>; usage: ClaudeUsage }> {
  const response = await getClient().beta.messages.parse({
    model,
    max_tokens: maxTokens,
    // Server-side fallback: a declined request is re-run on Anthropic's
    // recommended fallback model instead of failing the job.
    ...(supportsFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort, format: zodOutputFormat(schema) },
    messages: [{ role: "user", content: toContent(input) }],
  });

  if (response.stop_reason === "refusal") {
    throw new ClaudeRefusalError(response.stop_details?.category ?? null);
  }
  if (response.parsed_output == null) {
    throw new Error(`Claude did not return valid JSON (stop_reason: ${response.stop_reason}).`);
  }
  const usage = response.usage;
  return {
    data: response.parsed_output as z.infer<T>,
    usage: {
      model: response.model || model,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * One structured call: returns data validated against `schema`.
 * Throws ClaudeRefusalError on a refusal and Error when the output does not parse.
 */
export async function askJson<T extends z.ZodType>(options: AskJsonOptions<T>): Promise<z.infer<T>> {
  return (await askJsonWithUsage(options)).data;
}
