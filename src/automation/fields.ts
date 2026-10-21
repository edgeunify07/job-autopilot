import type { Profile } from "@prisma/client";
import { j } from "../lib/db";
import type { Resume } from "../lib/resume/schema";

export interface FieldDescriptor {
  /** Stable handle injected into the DOM so we can target it again. */
  key: string;
  tag: "input" | "textarea" | "select";
  type: string;
  label: string;
  placeholder: string;
  name: string;
  required: boolean;
  options: { value: string; label: string }[];
  maxLength: number | null;
  currentValue: string;
}

const yearsOf = (p: Profile) => (p.totalExperienceMonths / 12).toFixed(1).replace(/\.0$/, "");

/**
 * Deterministic answers for the fields every Indian portal asks.
 * Matched before the model is consulted — cheaper, faster, and it cannot drift.
 * Order matters: the first matching rule wins, so specific patterns come first.
 */
export function deterministicAnswer(f: FieldDescriptor, p: Profile, resume: Resume): string | null {
  const hay = `${f.label} ${f.placeholder} ${f.name}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => hay.includes(w));
  const links = j<Record<string, string>>(p.extraAnswers, {});

  // --- identity ---
  if (has("first name", "firstname", "given name")) return p.fullName.split(/\s+/)[0] ?? "";
  if (has("last name", "lastname", "surname", "family name"))
    return p.fullName.split(/\s+/).slice(1).join(" ") || p.fullName.split(/\s+/)[0] || "";
  if (has("full name", "your name", "candidate name") || /^name$/.test(f.label.trim().toLowerCase()))
    return p.fullName;

  // --- contact ---
  if (f.type === "email" || has("email", "e-mail")) return p.email;
  if (f.type === "tel" || has("mobile", "phone", "contact number", "whatsapp")) return p.phone;

  // --- location ---
  if (has("current location", "current city", "where are you based", "present city")) return p.currentCity;
  if (has("preferred location", "desired location", "preferred city"))
    return j<string[]>(p.preferredLocations, []).join(", ") || p.currentCity;
  if (has("city", "location")) return p.currentCity;
  if (has("relocate", "relocation")) return p.willingToRelocate ? "Yes" : "No";

  // --- experience / comp (the Indian-portal staples) ---
  if (has("total experience", "years of experience", "work experience", "total exp", "yrs of exp"))
    return yearsOf(p);
  if (has("relevant experience", "relevant exp")) return yearsOf(p);
  if (has("current ctc", "present ctc", "current salary", "current compensation"))
    return p.currentCtcLpa != null ? String(p.currentCtcLpa) : "";
  if (has("expected ctc", "expected salary", "salary expectation", "desired salary", "expected compensation"))
    return p.expectedCtcLpa != null ? String(p.expectedCtcLpa) : "";
  if (has("notice period", "how soon can you join", "availability to join", "joining time"))
    return p.servingNotice ? `${p.noticePeriodDays} days (currently serving)` : `${p.noticePeriodDays} days`;
  if (has("current company", "present employer", "current employer")) return p.currentCompany;
  if (has("current designation", "current title", "current role", "present designation")) return p.currentTitle;

  // --- education ---
  if (has("highest qualification", "highest degree", "education level")) return p.highestQualification;
  if (has("specialization", "branch", "stream", "major")) return p.specialization;
  if (has("university", "college", "institute", "school name")) return p.institute;
  if (has("graduation year", "year of passing", "passing year", "year of graduation"))
    return p.graduationYear ? String(p.graduationYear) : "";

  // --- links ---
  if (has("linkedin")) return p.linkedinUrl;
  if (has("github")) return p.githubUrl;
  if (has("portfolio", "website", "personal site")) return p.portfolioUrl;

  // --- demographics (all optional; blank is a valid answer) ---
  if (has("gender")) return p.gender;
  if (has("date of birth", "dob", "birth date")) return p.dateOfBirth;
  if (has("nationality", "citizenship")) return p.nationality;
  if (has("sponsorship", "work authorization", "require visa", "need visa"))
    return p.needsVisaSponsorship ? "Yes" : "No";
  if (has("disability", "differently abled", "physically challenged"))
    return p.differentlyAbled ? "Yes" : "No";
  if (has("legally authorized", "authorized to work", "eligible to work"))
    return p.needsVisaSponsorship ? "No" : "Yes";

  // --- headline / summary ---
  if (has("headline", "profile summary", "about you", "about yourself", "professional summary"))
    return resume.summary || p.summary;

  // --- anything the user pre-answered in settings ---
  for (const [k, v] of Object.entries(links)) {
    if (k && hay.includes(k.toLowerCase())) return v;
  }

  return null;
}

/** Pick the option on a <select> / radio group that best matches a free-text answer. */
export function bestOption(answer: string, options: { value: string; label: string }[]): string | null {
  if (!options.length) return null;
  const a = answer.trim().toLowerCase();
  if (!a) return null;

  const exact = options.find((o) => o.label.trim().toLowerCase() === a || o.value.trim().toLowerCase() === a);
  if (exact) return exact.value;

  const yes = /^(yes|y|true)$/.test(a);
  const no = /^(no|n|false)$/.test(a);
  if (yes || no) {
    const want = yes ? /^yes\b/i : /^no\b/i;
    const m = options.find((o) => want.test(o.label.trim()));
    if (m) return m.value;
  }

  const contains = options.find(
    (o) => o.label.toLowerCase().includes(a) || a.includes(o.label.trim().toLowerCase()),
  );
  if (contains) return contains.value;

  // Numeric answers against ranged options, e.g. "3" -> "2-5 years".
  const num = Number.parseFloat(a);
  if (!Number.isNaN(num)) {
    for (const o of options) {
      const bounds = o.label.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/);
      if (bounds && num >= Number(bounds[1]) && num <= Number(bounds[2])) return o.value;
      const plus = o.label.match(/(\d+(?:\.\d+)?)\s*\+/);
      if (plus && num >= Number(plus[1])) return o.value;
    }
  }
  return null;
}
