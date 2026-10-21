import { z } from "zod";

/**
 * Structured resume.
 *
 * Every field is required on purpose: strict structured outputs reject optional
 * keys, and "unknown" is better expressed as "" / [] than as a missing key.
 */
export const LinkSchema = z.object({
  label: z.string().describe('e.g. "LinkedIn", "GitHub", "Portfolio"'),
  url: z.string(),
});

export const SkillGroupSchema = z.object({
  category: z.string().describe('e.g. "Languages", "Frameworks", "Tools". Use "Skills" if ungrouped.'),
  items: z.array(z.string()),
});

export const ExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string(),
  startDate: z.string().describe('"Mon YYYY" or "YYYY". Empty string if unknown.'),
  endDate: z.string().describe('"Mon YYYY", "YYYY", or "Present".'),
  bullets: z.array(z.string()).describe("Achievement bullets, verbatim from the source resume."),
  tech: z.array(z.string()).describe("Technologies named in or clearly implied by this role."),
});

export const EducationSchema = z.object({
  institute: z.string(),
  degree: z.string(),
  field: z.string(),
  startYear: z.string(),
  endYear: z.string(),
  score: z.string().describe('CGPA or percentage as written, e.g. "8.4/10", "82%". Empty if absent.'),
});

export const ProjectSchema = z.object({
  name: z.string(),
  description: z.string(),
  bullets: z.array(z.string()),
  tech: z.array(z.string()),
  link: z.string(),
});

export const ResumeSchema = z.object({
  name: z.string(),
  headline: z.string().describe('Professional title line, e.g. "Backend Engineer".'),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  links: z.array(LinkSchema),
  summary: z.string().describe("2-4 sentence professional summary."),
  skills: z.array(SkillGroupSchema),
  experience: z.array(ExperienceSchema),
  education: z.array(EducationSchema),
  projects: z.array(ProjectSchema),
  certifications: z.array(z.string()),
  languages: z.array(z.string()),
  awards: z.array(z.string()),
});

export type Resume = z.infer<typeof ResumeSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;

export const EMPTY_RESUME: Resume = {
  name: "",
  headline: "",
  email: "",
  phone: "",
  location: "",
  links: [],
  summary: "",
  skills: [],
  experience: [],
  education: [],
  projects: [],
  certifications: [],
  languages: [],
  awards: [],
};

/** Flatten a resume to the plain text we feed to matchers and form fillers. */
export function resumeToText(r: Resume): string {
  const lines: string[] = [];
  lines.push(r.name, r.headline, [r.email, r.phone, r.location].filter(Boolean).join(" | "));
  if (r.links.length) lines.push(r.links.map((l) => `${l.label}: ${l.url}`).join(" | "));
  if (r.summary) lines.push("", "SUMMARY", r.summary);
  if (r.skills.length) {
    lines.push("", "SKILLS");
    for (const g of r.skills) lines.push(`${g.category}: ${g.items.join(", ")}`);
  }
  if (r.experience.length) {
    lines.push("", "EXPERIENCE");
    for (const e of r.experience) {
      lines.push(`${e.title} — ${e.company}${e.location ? `, ${e.location}` : ""} (${e.startDate} – ${e.endDate})`);
      for (const b of e.bullets) lines.push(`  • ${b}`);
    }
  }
  if (r.projects.length) {
    lines.push("", "PROJECTS");
    for (const p of r.projects) {
      lines.push(`${p.name}${p.link ? ` (${p.link})` : ""}: ${p.description}`);
      for (const b of p.bullets) lines.push(`  • ${b}`);
    }
  }
  if (r.education.length) {
    lines.push("", "EDUCATION");
    for (const e of r.education)
      lines.push(`${e.degree}${e.field ? ` in ${e.field}` : ""}, ${e.institute} (${e.endYear}) ${e.score}`.trim());
  }
  if (r.certifications.length) lines.push("", "CERTIFICATIONS", r.certifications.join("; "));
  if (r.awards.length) lines.push("", "AWARDS", r.awards.join("; "));
  if (r.languages.length) lines.push("", "LANGUAGES", r.languages.join(", "));
  return lines.filter((l) => l !== undefined).join("\n");
}

/** Every distinct skill/tech token the resume mentions, lowercased. */
export function resumeSkillSet(r: Resume): Set<string> {
  const out = new Set<string>();
  const add = (v: string) => v && out.add(v.trim().toLowerCase());
  r.skills.forEach((g) => g.items.forEach(add));
  r.experience.forEach((e) => e.tech.forEach(add));
  r.projects.forEach((p) => p.tech.forEach(add));
  return out;
}
