import { z } from "zod";
import { structured, MODELS, TRUTHFULNESS_RULE } from "../ai";
import { ResumeSchema, type Resume } from "./schema";
import { verifyTailoring, type VerificationResult } from "./verify";

export const TailorOutputSchema = z.object({
  resume: ResumeSchema,
  changeLog: z
    .array(z.string())
    .describe("Plain-English list of what you changed and why, one line per change."),
  unsupported: z
    .array(z.string())
    .describe(
      "Things this job asks for that the candidate's material does NOT support, and which you therefore left out.",
    ),
});

export type TailorOutput = z.infer<typeof TailorOutputSchema>;

const SYSTEM = `
You re-position an existing resume for one specific job. You are an editor working
within fixed facts, not a writer inventing a candidate.

What good output looks like:
- The summary speaks directly to this role, using only things the candidate has done.
- Within each role, the bullets most relevant to this job come first.
- Bullets are rephrased in the job's vocabulary where the underlying work genuinely matches
  (e.g. the resume says "REST services in Flask", the job says "microservices" — that is fair).
- Skill groups are reordered so the relevant stack leads. Irrelevant skills may be dropped.
- Irrelevant projects and bullets are dropped rather than padded.
- Role order, companies, titles and dates are untouched.
- Length stays close to the original. Do not expand a one-page resume into two.

${TRUTHFULNESS_RULE}

Every number in your output must appear verbatim in the source resume. If you cannot
support a claim, omit it and list what you omitted in "unsupported".
`.trim();

export interface TailorInput {
  base: Resume;
  job: { title: string; company: string; location: string; description: string };
}

export interface TailorResult extends TailorOutput {
  verification: VerificationResult;
}

/**
 * Produce a job-specific version of the candidate's resume.
 * The result is always verified against the base resume before it is returned;
 * callers must check `verification.ok` before attaching it to an application.
 */
export async function tailorResume({ base, job }: TailorInput): Promise<TailorResult> {
  const user = [
    "<base_resume>",
    JSON.stringify(base, null, 2),
    "</base_resume>",
    "",
    "<target_job>",
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location}`,
    "Description:",
    job.description.slice(0, 20000),
    "</target_job>",
    "",
    "Return the re-positioned resume, a changeLog, and anything you had to leave out.",
  ].join("\n");

  const out = await structured({
    schema: TailorOutputSchema,
    system: SYSTEM,
    user,
    model: MODELS.main,
    effort: "high",
    maxTokens: 20000,
    label: "resume-tailor",
  });

  if (!out) throw new Error("Tailoring returned nothing.");

  const verification = verifyTailoring(base, out.resume);
  return { ...out, verification };
}
