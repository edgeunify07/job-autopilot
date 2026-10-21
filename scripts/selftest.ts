/**
 * Offline self-test: everything except the model calls.
 *
 * Checks the parts most likely to break on a new machine or after a portal
 * redesign — browser launch, form scanning, field mapping, the fabrication
 * guard, PDF rendering and the spreadsheet writer. Run it with `npm run selftest`.
 */
import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import { prisma, s } from "../src/lib/db";
import { ensureDirs } from "../src/lib/paths";
import { getRenderContext, closeAll } from "../src/automation/browser";
import { scanForm, planAnswers, fillForm, findSubmitButton, uploadResume } from "../src/automation/formfill";
import { deterministicAnswer, bestOption } from "../src/automation/fields";
import { verifyTailoring } from "../src/lib/resume/verify";
import { renderResumePdf } from "../src/lib/resume/render";
import { exportSpreadsheet } from "../src/lib/sheet";
import { prefilter } from "../src/lib/match";
import { stripHtml } from "../src/connectors/ats";
import type { Resume } from "../src/lib/resume/schema";
import type { Profile } from "@prisma/client";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const FORM_HTML = `<!doctype html><html><body>
<h1>Apply: Senior Backend Engineer</h1>
<form>
  <label for="fn">First Name</label><input id="fn" name="first_name" required>
  <label for="ln">Last Name</label><input id="ln" name="last_name" required>
  <label for="em">Email Address</label><input id="em" type="email" name="email" required>
  <label for="ph">Mobile Number</label><input id="ph" type="tel" name="phone" required>
  <label for="cc">Current CTC (LPA)</label><input id="cc" name="current_ctc">
  <label for="ec">Expected CTC (LPA)</label><input id="ec" name="expected_ctc">
  <label for="np">Notice Period</label><input id="np" name="notice_period">
  <label for="te">Total Experience (years)</label><input id="te" name="total_experience">
  <label for="cl">Current Location</label><input id="cl" name="current_location">
  <label for="li">LinkedIn Profile</label><input id="li" name="linkedin">
  <label for="exp">Years of experience band</label>
  <select id="exp" name="exp_band"><option value="">Select</option><option value="a">0-2 years</option><option value="b">3-6 years</option><option value="c">7+ years</option></select>
  <fieldset><legend>Are you willing to relocate?</legend>
    <label><input type="radio" name="reloc" value="y"> Yes</label>
    <label><input type="radio" name="reloc" value="n"> No</label>
  </fieldset>
  <label for="pic">Profile photo</label><input id="pic" type="file" name="photo" accept="image/*">
  <label for="res">Resume</label><input id="res" type="file" name="resume" accept=".pdf">
  <label for="why">Why do you want this role?</label><textarea id="why" name="why" maxlength="600"></textarea>
  <input type="hidden" name="csrf" value="x">
  <button type="button">Save draft</button>
  <button type="submit">Submit Application</button>
</form></body></html>`;

const PROFILE = {
  id: "me",
  fullName: "Ananya Sharma",
  email: "ananya@example.com",
  phone: "+91 98765 43210",
  currentCity: "Bengaluru",
  preferredLocations: s(["Bengaluru", "Remote"]),
  willingToRelocate: true,
  currentTitle: "Backend Engineer",
  currentCompany: "Acme Systems",
  totalExperienceMonths: 54,
  currentCtcLpa: 18,
  expectedCtcLpa: 26,
  noticePeriodDays: 60,
  servingNotice: false,
  highestQualification: "B.Tech",
  specialization: "Computer Science",
  institute: "NIT Trichy",
  graduationYear: 2019,
  skills: s(["Python", "Go"]),
  linkedinUrl: "https://linkedin.com/in/ananya",
  githubUrl: "https://github.com/ananya",
  portfolioUrl: "",
  gender: "",
  dateOfBirth: "",
  nationality: "Indian",
  needsVisaSponsorship: false,
  differentlyAbled: false,
  summary: "Backend engineer.",
  resumeJson: "",
  resumeText: "",
  resumeFileName: "",
  resumeFilePath: "",
  extraAnswers: "{}",
  createdAt: new Date(),
  updatedAt: new Date(),
} as Profile;

const RESUME: Resume = {
  name: "Ananya Sharma",
  headline: "Backend Engineer",
  email: "ananya@example.com",
  phone: "+91 98765 43210",
  location: "Bengaluru",
  links: [{ label: "GitHub", url: "https://github.com/ananya" }],
  summary: "Backend engineer with 4 years building payment services.",
  skills: [{ category: "Languages", items: ["Python", "Go", "SQL"] }],
  experience: [
    {
      company: "Acme Systems",
      title: "Backend Engineer",
      location: "Bengaluru",
      startDate: "Jun 2021",
      endDate: "Present",
      bullets: ["Cut p99 latency by 35% across the payments API."],
      tech: ["Python", "PostgreSQL"],
    },
  ],
  education: [
    { institute: "NIT Trichy", degree: "B.Tech", field: "CSE", startYear: "2015", endYear: "2019", score: "8.4/10" },
  ],
  projects: [],
  certifications: [],
  languages: ["English", "Hindi"],
  awards: [],
};

async function main() {
  ensureDirs();
  console.log("\nJob Autopilot self-test\n");

  // ---------------------------------------------------------------- pure logic
  console.log("Field mapping");
  const mk = (label: string, extra: Partial<Parameters<typeof deterministicAnswer>[0]> = {}) => ({
    key: "k", tag: "input" as const, type: "text", label, placeholder: "", name: "",
    required: false, options: [], maxLength: null, currentValue: "", ...extra,
  });
  check("current CTC", deterministicAnswer(mk("Current CTC"), PROFILE, RESUME) === "18");
  check("expected CTC", deterministicAnswer(mk("Expected CTC (LPA)"), PROFILE, RESUME) === "26");
  check("notice period", deterministicAnswer(mk("Notice Period"), PROFILE, RESUME) === "60 days");
  check("total experience", deterministicAnswer(mk("Total Experience"), PROFILE, RESUME) === "4.5");
  check("first name", deterministicAnswer(mk("First Name"), PROFILE, RESUME) === "Ananya");
  check("last name", deterministicAnswer(mk("Last Name"), PROFILE, RESUME) === "Sharma");
  check("relocation", deterministicAnswer(mk("Willing to relocate?"), PROFILE, RESUME) === "Yes");
  check(
    "numeric answer maps into a range option",
    bestOption("4.5", [
      { value: "a", label: "0-2 years" },
      { value: "b", label: "3-6 years" },
    ]) === "b",
  );
  check("yes maps to a Yes option", bestOption("Yes", [{ value: "y", label: "Yes" }, { value: "n", label: "No" }]) === "y");

  console.log("\nFabrication guard");
  check("an unchanged resume passes", verifyTailoring(RESUME, RESUME).ok);
  const invented: Resume = {
    ...RESUME,
    certifications: ["AWS Solutions Architect"],
    experience: [{ ...RESUME.experience[0], bullets: ["Cut p99 latency by 60% across the payments API."] }],
  };
  const v = verifyTailoring(RESUME, invented);
  check("an invented certification is caught", !v.ok && v.violations.some((x) => /Certification/.test(x)));
  check("an inflated metric is caught", v.violations.some((x) => /60/.test(x)));
  const retitled: Resume = { ...RESUME, experience: [{ ...RESUME.experience[0], title: "Staff Engineer" }] };
  check("an invented title is caught", !verifyTailoring(RESUME, retitled).ok);
  const redated: Resume = { ...RESUME, experience: [{ ...RESUME.experience[0], startDate: "Jun 2018" }] };
  check("changed dates are caught", !verifyTailoring(RESUME, redated).ok);

  console.log("\nPre-filter and parsing helpers");
  const posting = {
    portal: "x", externalId: "1", url: "u", title: "Senior Backend Engineer", company: "C",
    location: "Bengaluru", description: "python postgres", salaryText: "", experienceText: "8-12 Yrs",
    postedText: "", raw: {},
  };
  check(
    "a role above the experience ceiling is rejected",
    prefilter(posting, { mustHaveKeywords: [], excludeKeywords: [], minExperienceYears: 0, maxExperienceYears: 6, minSalaryLpa: null }) !== null,
  );
  check(
    "an excluded keyword is rejected",
    prefilter(posting, { mustHaveKeywords: [], excludeKeywords: ["postgres"], minExperienceYears: 0, maxExperienceYears: 20, minSalaryLpa: null }) !== null,
  );
  check(
    "a matching role passes",
    prefilter(posting, { mustHaveKeywords: ["python"], excludeKeywords: [], minExperienceYears: 0, maxExperienceYears: 20, minSalaryLpa: null }) === null,
  );
  check(
    "entity-encoded HTML is decoded then stripped",
    stripHtml("&lt;p&gt;Hello &amp; welcome&lt;/p&gt;&lt;li&gt;One&lt;/li&gt;") === "Hello & welcome\n\u2022 One",
  );

  // -------------------------------------------------------------- browser work
  console.log("\nBrowser");
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(FORM_HTML);
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  const context = await getRenderContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

  const fields = await scanForm(page);
  check(`scanner found the controls (${fields.length})`, fields.length >= 13, `got ${fields.length}`);
  check("hidden inputs are ignored", !fields.some((f) => f.type === "hidden"));
  check("the radio group is one question", fields.filter((f) => f.type === "radio").length === 1);
  check(
    "the radio group kept both options",
    (fields.find((f) => f.type === "radio")?.options.length ?? 0) === 2,
  );
  check("labels were resolved", fields.some((f) => /first name/i.test(f.label)));
  check("the select kept its options", (fields.find((f) => f.tag === "select")?.options.length ?? 0) === 3);
  check("maxlength was read", fields.some((f) => f.maxLength === 600));

  // Plan without the model: rules only, so this runs with no API key.
  const rulePlan = fields
    .filter((f) => f.type !== "file")
    .map((f) => ({ field: f, answer: deterministicAnswer(f, PROFILE, RESUME) ?? "", source: "rule" as const, confident: true }))
    .filter((p) => p.answer);
  const entered = await fillForm(page, rulePlan);
  check(`rules answered most fields (${Object.keys(entered).length})`, Object.keys(entered).length >= 8);
  check("email landed in the DOM", (await page.inputValue("#em")) === PROFILE.email);
  check("CTC landed in the DOM", (await page.inputValue("#cc")) === "18");
  check("the experience band was selected", (await page.inputValue("#exp")) === "b");
  check("the relocate radio was ticked", await page.isChecked('input[name="reloc"][value="y"]'));

  const submit = await findSubmitButton(page);
  check("found Submit, not Save draft", submit !== null && /submit/i.test((await submit!.innerText()).trim()));

  console.log("\nResume upload");
  const pdf = await renderResumePdf(RESUME, "selftest");
  check("resume PDF rendered", fs.existsSync(pdf) && fs.statSync(pdf).size > 2000, pdf);

  const uploaded = await uploadResume(page, pdf);
  check("uploadResume reported success", uploaded);
  const resumeFiles = await page.locator("#res").evaluate(
    (el) => Array.from((el as HTMLInputElement).files ?? []).map((f) => f.name),
  );
  check(`PDF attached to the resume input (${resumeFiles.join(",") || "none"})`, resumeFiles.length === 1);
  const photoFiles = await page.locator("#pic").evaluate(
    (el) => Array.from((el as HTMLInputElement).files ?? []).map((f) => f.name),
  );
  check("photo input was left alone", photoFiles.length === 0);

  await page.close();
  server.close();

  console.log("\nOutputs");

  await prisma.job.upsert({
    where: { portal_externalId: { portal: "selftest", externalId: "1" } },
    create: {
      portal: "selftest", externalId: "1", url: "https://example.com/job", title: "Backend Engineer",
      company: "Acme", location: "Bengaluru", matchScore: 82, status: "applied",
    },
    update: {},
  });
  const job = await prisma.job.findUniqueOrThrow({ where: { portal_externalId: { portal: "selftest", externalId: "1" } } });
  await prisma.application.upsert({
    where: { jobId: job.id },
    create: { jobId: job.id, status: "submitted", submittedAt: new Date(), method: "selftest" },
    update: {},
  });
  const xlsx = await exportSpreadsheet();
  check("spreadsheet written", fs.existsSync(xlsx) && fs.statSync(xlsx).size > 5000, xlsx);

  // Clean up the fixture so it does not pollute the real tracker.
  await prisma.job.delete({ where: { id: job.id } });

  await closeAll();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nSelf-test crashed:", err);
  process.exit(1);
});
