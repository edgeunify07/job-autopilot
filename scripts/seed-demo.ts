/**
 * Fills the database with realistic demo data so the UI can be previewed
 * without running the agent. Safe to re-run; `npm run seed:demo -- --clear`
 * wipes it again.
 */
import "dotenv/config";
import { prisma, s } from "../src/lib/db";

const RESUME = {
  name: "Ananya Sharma",
  headline: "Backend Engineer",
  email: "ananya.sharma@example.com",
  phone: "+91 98765 43210",
  location: "Bengaluru",
  links: [{ label: "GitHub", url: "https://github.com/ananya" }],
  summary: "Backend engineer with 4.5 years building payment and ledger services at scale.",
  skills: [
    { category: "Languages", items: ["Python", "Go", "SQL"] },
    { category: "Infrastructure", items: ["PostgreSQL", "Redis", "Kafka", "AWS", "Docker"] },
  ],
  experience: [
    {
      company: "Acme Systems", title: "Backend Engineer", location: "Bengaluru",
      startDate: "Jun 2021", endDate: "Present",
      bullets: ["Cut p99 latency by 35% across the payments API.", "Built the idempotency layer behind 4M daily transactions."],
      tech: ["Python", "PostgreSQL", "Kafka"],
    },
    {
      company: "Finlo", title: "Software Engineer", location: "Pune",
      startDate: "Jul 2019", endDate: "May 2021",
      bullets: ["Migrated the settlement job from cron to Airflow, cutting reconciliation time from 6 hours to 40 minutes."],
      tech: ["Python", "Airflow"],
    },
  ],
  education: [{ institute: "NIT Trichy", degree: "B.Tech", field: "Computer Science", startYear: "2015", endYear: "2019", score: "8.4/10" }],
  projects: [], certifications: [], languages: ["English", "Hindi"], awards: [],
};

const JOBS: Array<[string, string, string, string, number, string, string, string, string]> = [
  // portal, title, company, location, score, status, salary, exp, reason
  ["greenhouse", "Senior Backend Engineer, Payments", "Stripe", "Bengaluru", 91, "applied", "₹45–65 LPA", "4-8 Yrs", "Payments domain match is unusually direct: the idempotency and ledger work maps onto what this team owns."],
  ["ashby", "Backend Engineer (Platform)", "Ramp", "Remote", 84, "applied", "", "3-6 Yrs", "Go and Postgres line up. Fintech background is relevant; no prior US-market experience."],
  ["naukri", "SDE II - Backend", "Flipkart", "Bengaluru", 82, "applied", "₹28–40 LPA", "3-6 Yrs", "Scale and stack both fit. Kafka experience is a genuine edge here."],
  ["greenhouse", "Software Engineer, Infrastructure", "Databricks", "Bengaluru", 78, "prepared", "", "4-7 Yrs", "Strong on distributed systems. Missing: Scala, Spark internals."],
  ["linkedin", "Backend Engineer - Fintech", "Jupiter", "Bengaluru", 76, "applied", "₹30–42 LPA", "3-5 Yrs", "Direct fintech fit. Smaller team than current employer."],
  ["naukri", "Python Developer", "Infosys", "Pune", 71, "needs_human", "₹12–18 LPA", "3-6 Yrs", "Stack matches but the band is below current CTC."],
  ["ashby", "Member of Technical Staff", "OpenAI", "Remote", 68, "queued", "", "5+ Yrs", "Backend depth is there; no ML infrastructure experience, which this role treats as required."],
  ["lever", "Backend Engineer", "Palantir", "Remote", 66, "queued", "", "4-8 Yrs", "Generalist backend fit. Domain is unfamiliar."],
  ["naukri", "Senior Software Engineer", "TCS", "Chennai", 54, "rejected", "₹14–20 LPA", "5-9 Yrs", "Below the match threshold: service-delivery role, not product engineering."],
  ["indeed", "Full Stack Developer", "Startup Co", "Bengaluru", 48, "rejected", "₹8–14 LPA", "2-5 Yrs", "Heavy frontend requirement; no React experience in the resume."],
  ["naukri", "Java Backend Developer", "Wipro", "Hyderabad", 41, "rejected", "₹10–16 LPA", "4-8 Yrs", "Java-first role. Candidate is Python/Go."],
  ["indeed", "Engineering Manager", "Zeta", "Bengaluru", 38, "rejected", "", "8-12 Yrs", "Wrong seniority band: no people-management experience."],
];

const LOGS: Array<[string, string, string]> = [
  ["info", "worker", "Autopilot worker started. It runs until you stop it."],
  ["info", "pipeline", "greenhouse: 41 seen, 6 new so far"],
  ["info", "pipeline", "ashby: 28 seen, 9 new so far"],
  ["debug", "lever", 'No board for "swiggy" — check the token'],
  ["info", "pipeline", "naukri: 25 seen, 14 new so far"],
  ["info", "pipeline", "Scoring 29 jobs"],
  ["info", "apply", "Found 14 fields on Stripe — Senior Backend Engineer, Payments"],
  ["info", "apply", "Attached tailored resume"],
  ["info", "pipeline", "Applied: Stripe — Senior Backend Engineer, Payments (91)"],
  ["info", "apply", "Found 11 fields on Ramp — Backend Engineer (Platform)"],
  ["info", "pipeline", "Applied: Ramp — Backend Engineer (Platform) (84)"],
  ["info", "pipeline", "Applied: Flipkart — SDE II - Backend (82)"],
  ["warn", "pipeline", "Tailoring failed verification for Databricks; using base resume"],
  ["info", "pipeline", "Prepared: Databricks — Software Engineer, Infrastructure (78)"],
  ["info", "pipeline", "Applied: Jupiter — Backend Engineer - Fintech (76)"],
  ["warn", "pipeline", "Needs you: Infosys — Python Developer"],
  ["info", "pipeline", "Tracker updated: data/exports/job-applications-2026-10-21.xlsx"],
  ["info", "worker", "Pass complete — 29 found, 29 scored, 5 applied (paused: Hit a otp wall — open the browser window and clear it.)"],
];

async function clear() {
  await prisma.application.deleteMany();
  await prisma.resumeVariant.deleteMany();
  await prisma.job.deleteMany();
  await prisma.runLog.deleteMany();
  await prisma.portalAccount.deleteMany();
}

async function main() {
  const wipe = process.argv.includes("--clear");
  await clear();
  if (wipe) {
    await prisma.profile.deleteMany();
    await prisma.agentState.deleteMany();
    console.log("Demo data cleared.");
    return;
  }

  await prisma.profile.upsert({
    where: { id: "me" },
    create: {
      id: "me", fullName: "Ananya Sharma", email: "ananya.sharma@example.com", phone: "+91 98765 43210",
      currentCity: "Bengaluru", preferredLocations: s(["Bengaluru", "Pune", "Remote"]), willingToRelocate: true,
      currentTitle: "Backend Engineer", currentCompany: "Acme Systems", totalExperienceMonths: 54,
      currentCtcLpa: 18, expectedCtcLpa: 26, noticePeriodDays: 60,
      highestQualification: "B.Tech", specialization: "Computer Science", institute: "NIT Trichy", graduationYear: 2019,
      skills: s(RESUME.skills.flatMap((g) => g.items)), linkedinUrl: "https://linkedin.com/in/ananya-sharma",
      githubUrl: "https://github.com/ananya", summary: RESUME.summary,
      resumeJson: s(RESUME), resumeText: RESUME.summary, resumeFileName: "ananya-sharma-resume.pdf",
    },
    update: { resumeJson: s(RESUME), resumeFileName: "ananya-sharma-resume.pdf" },
  });

  await prisma.searchPreference.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      titles: s(["Backend Engineer", "Python Developer", "Senior Software Engineer"]),
      mustHaveKeywords: s(["python", "go", "postgres"]),
      excludeKeywords: s(["commission only", "field sales", "unpaid"]),
      locations: s(["Bengaluru", "Pune", "Remote"]),
      minExperienceYears: 3, maxExperienceYears: 8, minMatchScore: 65,
      enabledPortals: s(["greenhouse", "lever", "ashby", "naukri", "linkedin"]),
      autoSubmit: true,
    },
    update: {},
  });

  await prisma.agentState.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton", running: true, phase: "idle", lastHeartbeat: new Date(),
      appliedToday: 5, countersDate: new Date().toISOString().slice(0, 10),
      needsHumanJobId: "", needsHumanReason: "",
    },
    update: { running: true, lastHeartbeat: new Date(), appliedToday: 5, countersDate: new Date().toISOString().slice(0, 10) },
  });

  let minutesAgo = JOBS.length * 23;
  for (const [portal, title, company, location, score, status, salary, exp, reason] of JOBS) {
    minutesAgo -= 23;
    const when = new Date(Date.now() - minutesAgo * 60_000);
    const job = await prisma.job.create({
      data: {
        portal, externalId: `${company}-${title}`.toLowerCase().replace(/\W+/g, "-"),
        url: `https://example.com/jobs/${company.toLowerCase().replace(/\W+/g, "-")}`,
        title, company, location, salaryText: salary, experienceText: exp,
        description: `We are looking for a ${title}…`,
        matchScore: score, matchReason: reason, matchedAt: when, discoveredAt: when,
        status,
        skipReason: status === "rejected" ? `Score ${score} < 65` : "",
      },
    });

    if (["applied", "prepared", "needs_human"].includes(status)) {
      const appStatus = status === "applied" ? "submitted" : status === "prepared" ? "prepared" : "needs_human";
      await prisma.application.create({
        data: {
          jobId: job.id, status: appStatus,
          submittedAt: appStatus === "submitted" ? when : null,
          method: portal === "naukri" || portal === "linkedin" ? `${portal}-easy-apply` : "generic-form",
          resumePath: `data/resumes/variants/${company.toLowerCase()}-tailored.pdf`,
          confirmation: appStatus === "submitted" ? "Application submitted" : appStatus === "prepared" ? "Filled in and left open for your review. Nothing was submitted." : "",
          error: appStatus === "needs_human" ? "Hit a otp wall — open the browser window and clear it." : "",
          attempts: 1, submittedBy: "agent",
        },
      });
      await prisma.resumeVariant.create({
        data: {
          jobId: job.id, json: s(RESUME),
          pdfPath: `data/resumes/variants/${company.toLowerCase()}-tailored.pdf`,
          changeLog: s([
            "Summary rewritten to lead with payments-infrastructure work.",
            "Moved the idempotency-layer bullet to the top of the Acme role.",
            "Dropped the Airflow migration bullet — not relevant to this posting.",
            "Reordered skills so Go and Postgres lead.",
          ]),
          unsupported: company === "Databricks" ? s(["Posting requires Scala and Spark internals — not in your resume, left out."]) : s([]),
        },
      });
    }
  }

  for (const [portal, status] of [["naukri", "ok"], ["linkedin", "ok"], ["indeed", "needs_login"], ["internshala", "unknown"]] as const) {
    await prisma.portalAccount.create({ data: { portal, status, lastCheckedAt: new Date() } });
  }

  let logAgo = LOGS.length * 90;
  for (const [level, scope, message] of LOGS) {
    logAgo -= 90;
    await prisma.runLog.create({ data: { level, scope, message, createdAt: new Date(Date.now() - logAgo * 1000) } });
  }

  const counts = {
    jobs: await prisma.job.count(),
    applications: await prisma.application.count(),
    logs: await prisma.runLog.count(),
  };
  console.log("Seeded:", counts);
}

main().then(() => prisma.$disconnect());
