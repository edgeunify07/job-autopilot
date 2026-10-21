import mammoth from "mammoth";
import { structured, MODELS, TRUTHFULNESS_RULE } from "../ai";
import { ResumeSchema, resumeToText, type Resume } from "./schema";

const EXTRACT_SYSTEM = `
You extract a resume into structured JSON. You are a transcriber, not an editor.

Rules:
- Copy bullets VERBATIM. Do not improve grammar, shorten, or rewrite them.
- Never invent a field. If something is absent, use "" or [].
- Preserve numbers, dates and proper nouns exactly as written.
- "tech" on a role lists only technologies actually named in that role's text.
- If the resume has no explicit summary, write "" — do not compose one.
${TRUTHFULNESS_RULE}
`.trim();

export interface ParsedResume {
  resume: Resume;
  text: string;
}

/** Extract raw text from a .docx. PDFs go straight to the model as a document block. */
async function docxToText(buf: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value.trim();
}

/**
 * Turn an uploaded resume into structured JSON.
 * Supports PDF (native model document input), DOCX, TXT and Markdown.
 */
export async function parseResume(file: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}): Promise<ParsedResume> {
  const name = file.fileName.toLowerCase();
  const isPdf = name.endsWith(".pdf") || file.mimeType === "application/pdf";
  const isDocx = name.endsWith(".docx") || name.endsWith(".doc");

  let content: Parameters<typeof structured>[0]["user"];

  if (isPdf) {
    content = [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") },
      },
      { type: "text", text: "Extract this resume into the required JSON structure." },
    ];
  } else {
    const raw = isDocx ? await docxToText(file.buffer) : file.buffer.toString("utf8");
    if (!raw.trim()) throw new Error("That file appears to be empty or unreadable.");
    content = `Extract this resume into the required JSON structure.\n\n<resume>\n${raw}\n</resume>`;
  }

  const resume = await structured({
    schema: ResumeSchema,
    system: EXTRACT_SYSTEM,
    user: content,
    model: MODELS.main,
    effort: "medium",
    maxTokens: 16000,
    label: "resume-parse",
  });

  if (!resume) throw new Error("Could not read that resume. Try exporting it as a text-based PDF or DOCX.");
  if (!resume.experience.length && !resume.education.length && !resume.projects.length) {
    throw new Error("No experience, education or projects found — is this definitely a resume?");
  }

  return { resume, text: resumeToText(resume) };
}
