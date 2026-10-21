import fs from "node:fs/promises";
import path from "node:path";
import type { Resume } from "./schema";
import { paths, safeSlug, ensureDirs } from "../paths";
import { getRenderContext } from "../../automation/browser";

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A deliberately plain, single-column, ATS-parseable layout.
 * No tables, no columns, no icons, no images — those are what break resume parsers.
 */
export function resumeToHtml(r: Resume): string {
  const section = (title: string, body: string) =>
    body.trim() ? `<section><h2>${esc(title)}</h2>${body}</section>` : "";

  const contact = [r.email, r.phone, r.location, ...r.links.map((l) => l.url)].filter(Boolean);

  const experience = r.experience
    .map(
      (e) => `
      <article>
        <div class="row"><strong>${esc(e.title)}</strong><span>${esc(e.startDate)} – ${esc(e.endDate)}</span></div>
        <div class="row sub"><em>${esc(e.company)}</em><span>${esc(e.location)}</span></div>
        <ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </article>`,
    )
    .join("");

  const projects = r.projects
    .map(
      (p) => `
      <article>
        <div class="row"><strong>${esc(p.name)}</strong>${p.link ? `<span>${esc(p.link)}</span>` : ""}</div>
        ${p.description ? `<p>${esc(p.description)}</p>` : ""}
        <ul>${p.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </article>`,
    )
    .join("");

  const education = r.education
    .map(
      (e) => `
      <article>
        <div class="row">
          <strong>${esc(e.degree)}${e.field ? `, ${esc(e.field)}` : ""}</strong>
          <span>${esc(e.endYear)}</span>
        </div>
        <div class="row sub"><em>${esc(e.institute)}</em><span>${esc(e.score)}</span></div>
      </article>`,
    )
    .join("");

  const skills = r.skills
    .map((g) => `<p><strong>${esc(g.category)}:</strong> ${esc(g.items.join(", "))}</p>`)
    .join("");

  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(r.name)} — Resume</title>
<style>
  @page { size: A4; margin: 14mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt;
         line-height: 1.38; color: #111; margin: 0; }
  header { margin-bottom: 10px; }
  h1 { font-size: 19pt; margin: 0 0 2px; letter-spacing: -0.2px; }
  .headline { font-size: 11pt; color: #333; margin: 0 0 4px; }
  .contact { font-size: 9pt; color: #444; }
  h2 { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 1px; color: #000;
       border-bottom: 1px solid #999; padding-bottom: 2px; margin: 13px 0 6px; }
  article { margin-bottom: 8px; page-break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .row span { font-size: 9pt; color: #555; white-space: nowrap; }
  .sub { margin-bottom: 2px; }
  ul { margin: 3px 0 0; padding-left: 16px; }
  li { margin-bottom: 2px; }
  p { margin: 2px 0; }
  section { page-break-inside: auto; }
</style></head>
<body>
  <header>
    <h1>${esc(r.name)}</h1>
    ${r.headline ? `<p class="headline">${esc(r.headline)}</p>` : ""}
    <div class="contact">${contact.map(esc).join(" &nbsp;•&nbsp; ")}</div>
  </header>
  ${section("Summary", r.summary ? `<p>${esc(r.summary)}</p>` : "")}
  ${section("Skills", skills)}
  ${section("Experience", experience)}
  ${section("Projects", projects)}
  ${section("Education", education)}
  ${section("Certifications", list(r.certifications))}
  ${section("Awards", list(r.awards))}
  ${section("Languages", r.languages.length ? `<p>${esc(r.languages.join(", "))}</p>` : "")}
</body></html>`;
}

/** Markdown fallback, handy for plain-text application boxes. */
export function resumeToMarkdown(r: Resume): string {
  const out: string[] = [`# ${r.name}`];
  if (r.headline) out.push(`*${r.headline}*`);
  out.push([r.email, r.phone, r.location].filter(Boolean).join(" · "));
  if (r.summary) out.push("", "## Summary", r.summary);
  if (r.skills.length) {
    out.push("", "## Skills");
    r.skills.forEach((g) => out.push(`**${g.category}:** ${g.items.join(", ")}`));
  }
  if (r.experience.length) {
    out.push("", "## Experience");
    r.experience.forEach((e) => {
      out.push(`### ${e.title} — ${e.company}`, `${e.startDate} – ${e.endDate}${e.location ? ` · ${e.location}` : ""}`);
      e.bullets.forEach((b) => out.push(`- ${b}`));
    });
  }
  if (r.projects.length) {
    out.push("", "## Projects");
    r.projects.forEach((p) => {
      out.push(`### ${p.name}`);
      if (p.description) out.push(p.description);
      p.bullets.forEach((b) => out.push(`- ${b}`));
    });
  }
  if (r.education.length) {
    out.push("", "## Education");
    r.education.forEach((e) => out.push(`- **${e.degree}${e.field ? `, ${e.field}` : ""}**, ${e.institute} (${e.endYear}) ${e.score}`.trim()));
  }
  if (r.certifications.length) out.push("", "## Certifications", ...r.certifications.map((c) => `- ${c}`));
  return out.join("\n");
}

/** Render to a real PDF using the browser we already run for applying. */
export async function renderResumePdf(r: Resume, slug: string): Promise<string> {
  ensureDirs();
  const file = path.join(paths.variants, `${safeSlug(slug)}-${Date.now()}.pdf`);
  const context = await getRenderContext();
  const page = await context.newPage();
  try {
    await page.setContent(resumeToHtml(r), { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    await fs.writeFile(file, pdf);
    return file;
  } finally {
    await page.close().catch(() => {});
  }
}
