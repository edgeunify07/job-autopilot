import type { Resume } from "./schema";
import { resumeToText } from "./schema";

export interface VerificationResult {
  ok: boolean;
  violations: string[];
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Deterministic fabrication check run on every tailored resume before it is
 * attached to an application. The model is told not to invent things; this is
 * what makes that stick. Anything flagged here blocks auto-submit.
 */
export function verifyTailoring(base: Resume, tailored: Resume): VerificationResult {
  const violations: string[] = [];
  const baseText = norm(resumeToText(base));

  // Identity must not drift.
  for (const [field, a, b] of [
    ["name", base.name, tailored.name],
    ["email", base.email, tailored.email],
    ["phone", base.phone, tailored.phone],
  ] as const) {
    if (norm(a) !== norm(b)) violations.push(`${field} was changed ("${a}" -> "${b}")`);
  }

  // Employers, titles and dates are facts, not positioning.
  const baseRoles = new Map(base.experience.map((e) => [`${norm(e.company)}|${norm(e.title)}`, e]));
  for (const role of tailored.experience) {
    const key = `${norm(role.company)}|${norm(role.title)}`;
    const original = baseRoles.get(key);
    if (!original) {
      violations.push(`Role not in your resume: "${role.title}" at "${role.company}"`);
      continue;
    }
    if (norm(original.startDate) !== norm(role.startDate) || norm(original.endDate) !== norm(role.endDate)) {
      violations.push(
        `Dates changed for ${role.title} at ${role.company} ` +
          `(${original.startDate}–${original.endDate} -> ${role.startDate}–${role.endDate})`,
      );
    }
  }

  // Degrees and institutions.
  const baseEdu = new Set(base.education.map((e) => `${norm(e.institute)}|${norm(e.degree)}`));
  for (const e of tailored.education) {
    if (!baseEdu.has(`${norm(e.institute)}|${norm(e.degree)}`)) {
      violations.push(`Education not in your resume: "${e.degree}" at "${e.institute}"`);
    }
  }

  // Certifications are a classic place for invented credentials.
  const baseCerts = new Set(base.certifications.map(norm));
  for (const c of tailored.certifications) {
    if (!baseCerts.has(norm(c))) violations.push(`Certification not in your resume: "${c}"`);
  }

  // Every number in the tailored resume must already exist in the base resume.
  // Catches inflated metrics ("improved latency 40%" when the base said 15%).
  const baseNumbers = new Set(baseText.match(/\d+(?:\.\d+)?/g) ?? []);
  const tailoredNumbers = new Set(norm(resumeToText(tailored)).match(/\d+(?:\.\d+)?/g) ?? []);
  for (const n of tailoredNumbers) {
    if (!baseNumbers.has(n)) violations.push(`Number "${n}" does not appear in your resume`);
  }

  return { ok: violations.length === 0, violations };
}
