import type { Profile } from "@prisma/client";
import { text, MODELS, TRUTHFULNESS_RULE } from "./ai";
import { resumeToText, type Resume } from "./resume/schema";

const SYSTEM = `
You write a short cover letter for one job application.

Shape: 3 short paragraphs, 130-180 words total.
  1. What role, and the single most relevant thing this candidate has actually done.
  2. Two concrete points of overlap with the posting, drawn from real experience.
  3. One line on availability and interest. No flattery.

Voice: plain, direct, specific. Indian professional register — neither American-casual
nor stiff. No "I am writing to express my keen interest". No adjectives about yourself
that the evidence does not earn. No em-dashes.

${TRUTHFULNESS_RULE}

Output only the letter body. No subject line, no "Dear Hiring Manager", no sign-off.
`.trim();

export async function writeCoverLetter(args: {
  profile: Profile;
  resume: Resume;
  job: { title: string; company: string; description: string };
}): Promise<string> {
  const { profile, resume, job } = args;
  try {
    return await text({
      system: SYSTEM,
      user: [
        "<candidate>",
        resumeToText(resume).slice(0, 10000),
        `Notice period: ${profile.noticePeriodDays} days`,
        `Current location: ${profile.currentCity}`,
        "</candidate>",
        "",
        "<job>",
        `${job.title} at ${job.company}`,
        job.description.slice(0, 8000),
        "</job>",
      ].join("\n"),
      model: MODELS.main,
      effort: "medium",
      maxTokens: 1200,
      label: "cover-letter",
    });
  } catch {
    return "";
  }
}
