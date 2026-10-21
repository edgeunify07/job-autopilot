import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const MODELS = {
  /** Judgement work: resume tailoring, free-text answers, cover letters. */
  main: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  /** High-volume, low-judgement work: scoring hundreds of job cards. */
  bulk: process.env.ANTHROPIC_BULK_MODEL || "claude-haiku-5-5",
} as const;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

let _client: Anthropic | null = null;

/**
 * Empty when talking to Anthropic directly. Set ANTHROPIC_BASE_URL to use a
 * gateway or compatible provider instead — note that everything this app sends
 * (your resume, contact details, salary) then passes through that operator.
 */
export const baseURL = () => process.env.ANTHROPIC_BASE_URL || "";

export function ai(): Anthropic {
  if (!_client) {
    const url = baseURL();
    _client = new Anthropic(url ? { baseURL: url } : {});
  }
  return _client;
}

const PLACEHOLDER = "sk-ant-...";

export function aiConfigured(): boolean {
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  // Any non-placeholder key counts: gateways issue their own key formats.
  return (key.length > 16 && key !== PLACEHOLDER) || Boolean(process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Not every endpoint implements structured outputs (`output_config.format`).
 * The first time one rejects it we stop sending it and fall back to asking for
 * JSON in the prompt, so a basic Messages-API endpoint still works.
 */
let structuredOutputsSupported = true;

function looksUnsupported(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status !== 400 && err.status !== 404 && err.status !== 422) return false;
  return /output_config|output_format|json_schema|unsupported|unknown (field|parameter)|unexpected/i.test(
    err.message ?? "",
  );
}

/** Retry only what is worth retrying: rate limits, 5xx, and connection drops. */
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.APIConnectionError ||
        (err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500);
      if (!retryable || i === attempts - 1) break;
      const waitMs = Math.min(30_000, 2000 * 2 ** i) + Math.floor(Math.random() * 500);
      // eslint-disable-next-line no-console
      console.warn(`[ai] ${label} retry ${i + 1}/${attempts - 1} in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

export interface StructuredOpts<S extends z.ZodType> {
  schema: S;
  system: string;
  user: Anthropic.MessageParam["content"];
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  label?: string;
}

/**
 * One model call that must come back as a validated object.
 * Returns null rather than throwing on a parse failure, so a single bad job
 * never stops the autopilot loop.
 */
export async function structured<S extends z.ZodType>(opts: StructuredOpts<S>): Promise<z.infer<S> | null> {
  const {
    schema,
    system,
    user,
    model = MODELS.main,
    effort = "medium",
    maxTokens = 16000,
    label = "structured",
  } = opts;

  if (structuredOutputsSupported) {
    try {
      const res = await withRetry(
        () =>
          ai().messages.parse({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: user }],
            output_config: { format: zodOutputFormat(schema), effort },
          }),
        label,
      );
      if (res.stop_reason === "refusal") {
        throw new Error(`Model declined (${res.stop_details?.category ?? "unknown"}): ${label}`);
      }
      return (res.parsed_output as z.infer<S> | null) ?? null;
    } catch (err) {
      if (!looksUnsupported(err)) throw err;
      structuredOutputsSupported = false;
      // eslint-disable-next-line no-console
      console.warn("[ai] Endpoint rejected structured outputs; using JSON-in-prompt for the rest of this run.");
    }
  }
  return structuredFallback({ schema, system, user, model, maxTokens, label });
}

/** JSON asked for in the prompt, then extracted and validated against the schema here. */
async function structuredFallback<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: Anthropic.MessageParam["content"];
  model: string;
  maxTokens: number;
  label: string;
}): Promise<z.infer<S> | null> {
  const { schema, system, user, model, maxTokens, label } = opts;
  const jsonSchema = zodOutputFormat(schema).schema;

  const res = await withRetry(
    () =>
      ai().messages.create({
        model,
        max_tokens: maxTokens,
        system:
          `${system}\n\nRespond with a single JSON object and nothing else — no prose, no markdown fence. ` +
          `It must validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
        messages: [{ role: "user", content: user }],
      }),
    `${label}-fallback`,
  );

  if (res.stop_reason === "refusal") {
    throw new Error(`Model declined (${res.stop_details?.category ?? "unknown"}): ${label}`);
  }

  const raw = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Models sometimes wrap JSON in a fence or add a sentence; take the outermost object.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = schema.safeParse(JSON.parse(body.slice(start, end + 1)));
    return parsed.success ? (parsed.data as z.infer<S>) : null;
  } catch {
    return null;
  }
}

/** Plain prose out: cover letters, one-line answers to portal questions. */
export async function text(opts: {
  system: string;
  user: string;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  label?: string;
}): Promise<string> {
  const { system, user, model = MODELS.main, effort = "medium", maxTokens = 4000, label = "text" } = opts;

  const res = await withRetry(
    () =>
      ai().messages.create({
        model,
        max_tokens: maxTokens,
        system,
        output_config: { effort },
        messages: [{ role: "user", content: user }],
      }),
    label,
  );

  if (res.stop_reason === "refusal") {
    throw new Error(`Model declined (${res.stop_details?.category ?? "unknown"}): ${label}`);
  }
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * The honesty rule, injected into every prompt that writes application content.
 * Inventing experience is the single worst failure mode for a tool like this:
 * it gets offers rescinded and people fired. Keep this text in one place.
 */
export const TRUTHFULNESS_RULE = `
HARD CONSTRAINT — NEVER FABRICATE.
You may only use facts present in the candidate's source material. Specifically you MAY:
  - reorder, reword, and re-emphasise existing bullets
  - drop content that is irrelevant to this job
  - surface a genuinely-held skill that the base resume buried
  - use the job's vocabulary for a thing the candidate demonstrably did
You MUST NOT:
  - invent employers, titles, dates, degrees, certifications, clearances or metrics
  - inflate seniority, scope, team size, or years of experience
  - claim a tool, language or framework not evidenced in the source material
  - change any number that appears in the source material
If the job wants something the candidate does not have, leave it out. A weaker honest
application is the correct output. Record anything you were tempted to add, but did not,
in the "unsupported" field.
`.trim();
