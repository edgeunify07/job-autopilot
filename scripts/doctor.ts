/**
 * Checks the configured model endpoint one capability at a time, so a failed
 * resume upload points at a cause instead of a shrug.
 *
 *   npm run doctor
 *
 * Resume parsing needs three things from the endpoint: it must answer at all,
 * it must accept a PDF document block, and ideally it must support structured
 * outputs (there is a fallback if not). A gateway can support the first and
 * not the others, which is exactly the case that is hard to read from the UI.
 */
import "dotenv/config";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const KEY = process.env.ANTHROPIC_API_KEY ?? "";
const BASE = process.env.ANTHROPIC_BASE_URL ?? "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const BULK = process.env.ANTHROPIC_BULK_MODEL || "claude-haiku-5-5";

const ok = (m: string) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const no = (m: string) => console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
const info = (m: string) => console.log(`       \x1b[90m${m}\x1b[0m`);

function describe(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const body = typeof err.error === "object" ? JSON.stringify(err.error) : String(err.error ?? "");
    return `HTTP ${err.status ?? "?"} — ${err.message}${body && body !== "undefined" ? `\n       body: ${body.slice(0, 500)}` : ""}`;
  }
  return String(err instanceof Error ? err.message : err);
}

/** Smallest thing that is still a real PDF, so we are testing the endpoint and not a renderer. */
const TINY_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 80]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 54>>stream
BT /F1 14 Tf 20 40 Td (Priya Verma - Engineer) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>`,
  "utf8",
).toString("base64");

async function main() {
  console.log("\nJob Autopilot — endpoint check\n");
  console.log(`  endpoint   ${BASE || "https://api.anthropic.com (direct)"}`);
  console.log(`  key        ${KEY ? `${KEY.slice(0, 7)}…${KEY.slice(-4)} (${KEY.length} chars)` : "\x1b[31mNOT SET\x1b[0m"}`);
  console.log(`  model      ${MODEL}`);
  console.log(`  bulk model ${BULK}\n`);

  if (!KEY) {
    no("ANTHROPIC_API_KEY is not set in .env");
    process.exit(1);
  }

  const client = new Anthropic(BASE ? { baseURL: BASE } : {});
  let fatal = false;

  // 1. Can we talk to it at all?
  console.log("1. Basic text call");
  try {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 32,
      messages: [{ role: "user", content: "Reply with exactly: PONG" }],
    });
    const text = r.content.find((b) => b.type === "text");
    ok(`endpoint answered as ${r.model}`);
    info(`reply: ${text && text.type === "text" ? text.text.trim().slice(0, 60) : "(no text block)"}`);
  } catch (err) {
    no("the endpoint rejected a basic call");
    info(describe(err));
    info("Check ANTHROPIC_BASE_URL (try with and without a trailing /v1), the key, and the model name.");
    fatal = true;
  }

  // 2. The bulk model is a separate name and may not exist on this endpoint.
  if (!fatal && BULK !== MODEL) {
    console.log("\n2. Bulk model (used for scoring every job)");
    try {
      await client.messages.create({ model: BULK, max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
      ok(`${BULK} works`);
    } catch (err) {
      no(`${BULK} failed — set ANTHROPIC_BULK_MODEL to ${MODEL} in .env`);
      info(describe(err));
    }
  }

  // 3. PDF input. This is what a resume upload actually does.
  if (!fatal) {
    console.log("\n3. PDF document input  (what resume upload uses)");
    try {
      const r = await client.messages.create({
        model: MODEL,
        max_tokens: 64,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: TINY_PDF } },
              { type: "text", text: "Reply with only the person's name in this document." },
            ],
          },
        ],
      });
      const text = r.content.find((b) => b.type === "text");
      ok("the endpoint accepted a PDF");
      info(`read back: ${text && text.type === "text" ? text.text.trim().slice(0, 80) : "(nothing)"}`);
    } catch (err) {
      no("the endpoint rejected PDF input — this is why resume upload fails");
      info(describe(err));
      info("Workaround: upload your resume as .docx or .txt instead; those are sent as plain text.");
    }
  }

  // 4. Structured outputs. There is a fallback, but it is worth knowing.
  if (!fatal) {
    console.log("\n4. Structured outputs");
    try {
      const r = await client.messages.parse({
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: "Name: Priya Verma, city Pune." }],
        output_config: { format: zodOutputFormat(z.object({ name: z.string(), city: z.string() })) },
      });
      r.parsed_output ? ok(`parsed: ${JSON.stringify(r.parsed_output)}`) : no("returned nothing parseable");
    } catch (err) {
      no("structured outputs unsupported — the app falls back to JSON-in-prompt automatically");
      info(describe(err));
    }
  }

  console.log("");
}

main().catch((e) => {
  console.error("\ndoctor crashed:", e);
  process.exit(1);
});
