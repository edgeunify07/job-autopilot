import { z } from "zod";
import type { Profile } from "@prisma/client";
import { structured, MODELS } from "./ai";
import { j } from "./db";
import { resumeToText, resumeSkillSet, type Resume } from "./resume/schema";
import type { JobPosting } from "../connectors/types";

export interface MatchPrefs {
  mustHaveKeywords: string[];
  excludeKeywords: string[];
  minExperienceYears: number;
  maxExperienceYears: number;
  minSalaryLpa: number | null;
}

/**
 * Free, instant rejection pass. Runs before any model call so we are not paying
 * to score jobs that are obviously wrong.
 */
export function prefilter(posting: JobPosting, prefs: MatchPrefs): string | null {
  const hay = `${posting.title} ${posting.company} ${posting.description}`.toLowerCase();

  for (const bad of prefs.excludeKeywords) {
    if (bad && hay.includes(bad.toLowerCase())) return `Excluded keyword: "${bad}"`;
  }
  if (prefs.mustHaveKeywords.length && !prefs.mustHaveKeywords.some((k) => k && hay.includes(k.toLowerCase()))) {
    return "None of your must-have keywords appear";
  }

  // "5-8 Yrs", "3 - 5 years", "Minimum 7 years"
  const range = posting.experienceText.match(/(\d+)\s*(?:-|to|–)\s*(\d+)/);
  if (range) {
    const [lo, hi] = [Number(range[1]), Number(range[2])];
    if (lo > prefs.maxExperienceYears) return `Wants ${lo}+ yrs, you have up to ${prefs.maxExperienceYears}`;
    if (hi < prefs.minExperienceYears) return `Caps at ${hi} yrs, below your floor of ${prefs.minExperienceYears}`;
  } else {
    const min = posting.experienceText.match(/(?:min(?:imum)?\s*)?(\d+)\s*\+?\s*(?:yrs|years)/i);
    if (min && Number(min[1]) > prefs.maxExperienceYears) {
      return `Wants ${min[1]}+ yrs, above your ceiling`;
    }
  }

  if (/\b(intern|internship)\b/.test(hay) && prefs.minExperienceYears >= 2) return "Internship";
  return null;
}

export const MatchSchema = z.object({
  score: z.number().describe("0-100. How likely is this candidate to get an interview here?"),
  reason: z.string().describe("One or two sentences. Concrete, not generic."),
  missingRequirements: z.array(z.string()).describe("Hard requirements the candidate clearly does not meet."),
  strongPoints: z.array(z.string()).describe("The candidate's genuine edges for this role."),
});

export type MatchResult = z.infer<typeof MatchSchema>;

const SYSTEM = `
You score how well a candidate fits one job, from the employer's point of view.

Calibration — be honest, not encouraging. A low score saves this person a wasted application.
  85-100  Strong fit. Meets the stated requirements and the seniority band.
  70-84   Good fit. Meets most requirements; a gap or two that experience covers.
  55-69   Plausible but a stretch. Missing something the posting calls required.
  30-54   Weak. Wrong seniority, wrong stack, or wrong domain.
  0-29    Not a fit.

Weigh, in order: hard requirements, years and seniority band, core stack overlap,
domain relevance, location/work-mode compatibility. Do not reward enthusiasm, and
do not inflate for a candidate who is simply adjacent.
`.trim();

/** Score one job against the candidate. Uses the cheap model; this runs a lot. */
export async function scoreJob(
  posting: JobPosting,
  profile: Profile,
  resume: Resume,
): Promise<MatchResult | null> {
  const user = JSON.stringify(
    {
      candidate: {
        headline: resume.headline || profile.currentTitle,
        totalExperienceYears: Number((profile.totalExperienceMonths / 12).toFixed(1)),
        location: profile.currentCity,
        willingToRelocate: profile.willingToRelocate,
        preferredLocations: j<string[]>(profile.preferredLocations, []),
        expectedCtcLpa: profile.expectedCtcLpa,
        skills: [...resumeSkillSet(resume)].slice(0, 120),
        resume: resumeToText(resume).slice(0, 9000),
      },
      job: {
        title: posting.title,
        company: posting.company,
        location: posting.location,
        salary: posting.salaryText,
        experience: posting.experienceText,
        description: posting.description.slice(0, 9000),
      },
    },
    null,
    2,
  );

  return structured({
    schema: MatchSchema,
    system: SYSTEM,
    user,
    model: MODELS.bulk,
    effort: "low",
    maxTokens: 2000,
    label: "job-score",
  });
}
