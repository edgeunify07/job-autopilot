import { prisma, j, s } from "../lib/db";
import { logger } from "../lib/logger";
import { getConnector, ALL_CONNECTORS } from "../connectors";
import type { JobPosting } from "../connectors/types";
import { prefilter, scoreJob } from "../lib/match";
import { tailorResume } from "../lib/resume/tailor";
import { renderResumePdf } from "../lib/resume/render";
import { writeCoverLetter } from "../lib/cover";
import { EMPTY_RESUME, type Resume } from "../lib/resume/schema";
import { exportSpreadsheet } from "../lib/sheet";
import { getPrefs, getProfile, getState, setState, checkGates, requestHuman } from "./state";
import { safeSlug } from "../lib/paths";

const SCOPE = "pipeline";

function resumeOf(profileResumeJson: string): Resume {
  return j<Resume>(profileResumeJson, EMPTY_RESUME);
}

// ------------------------------------------------------------------ discover

/** Ask every enabled connector what is out there, and record anything new. */
export async function discover(): Promise<number> {
  const prefs = await getPrefs();
  const enabled = j<string[]>(prefs.enabledPortals, []);
  const queries = j<string[]>(prefs.titles, []);
  const locations = j<string[]>(prefs.locations, []);

  if (!queries.length) {
    await logger.warn(SCOPE, "No search titles configured — nothing to look for.");
    return 0;
  }

  let added = 0;
  for (const id of enabled) {
    const connector = getConnector(id);
    if (!connector) continue;

    await setState({ phase: `searching ${connector.label}` });
    let postings: JobPosting[] = [];
    try {
      postings = await connector.search({
        queries,
        locations,
        remoteOnly: prefs.remoteOnly,
        maxPerQuery: 25,
      });
    } catch (err) {
      await logger.error(SCOPE, `${connector.label} search failed`, { error: String(err) });
      continue;
    }

    for (const p of postings) {
      if (!p.title || !p.url) continue;
      try {
        const existing = await prisma.job.findUnique({
          where: { portal_externalId: { portal: p.portal, externalId: p.externalId } },
        });
        if (existing) continue;
        await prisma.job.create({
          data: {
            portal: p.portal,
            externalId: p.externalId,
            url: p.url,
            title: p.title,
            company: p.company,
            location: p.location,
            description: p.description,
            salaryText: p.salaryText,
            experienceText: p.experienceText,
            postedText: p.postedText,
            raw: s(p.raw),
            status: "new",
          },
        });
        added++;
      } catch (err) {
        await logger.debug(SCOPE, "Could not record a posting", { error: String(err), url: p.url });
      }
    }
    await logger.info(SCOPE, `${connector.label}: ${postings.length} seen, ${added} new so far`);
  }

  return added;
}

// --------------------------------------------------------------------- score

/** Turn raw finds into scored candidates. Cheap rejections happen before any model call. */
export async function scoreNewJobs(limit = 40): Promise<number> {
  const profile = await getProfile();
  if (!profile) return 0;
  const prefs = await getPrefs();
  const resume = resumeOf(profile.resumeJson);

  const matchPrefs = {
    mustHaveKeywords: j<string[]>(prefs.mustHaveKeywords, []),
    excludeKeywords: j<string[]>(prefs.excludeKeywords, []),
    minExperienceYears: prefs.minExperienceYears,
    maxExperienceYears: prefs.maxExperienceYears,
    minSalaryLpa: prefs.minSalaryLpa ?? null,
  };

  const jobs = await prisma.job.findMany({
    where: { status: "new" },
    orderBy: { discoveredAt: "desc" },
    take: limit,
  });
  if (!jobs.length) return 0;

  await setState({ phase: `scoring ${jobs.length} jobs` });
  let scored = 0;

  for (const job of jobs) {
    const posting: JobPosting = {
      portal: job.portal,
      externalId: job.externalId,
      url: job.url,
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      salaryText: job.salaryText,
      experienceText: job.experienceText,
      postedText: job.postedText,
      raw: {},
    };

    const rejected = prefilter(posting, matchPrefs);
    if (rejected) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "rejected", skipReason: rejected, matchedAt: new Date() },
      });
      continue;
    }

    // Portals only give a snippet on the results page; get the real text first.
    const connector = getConnector(job.portal);
    let enriched = posting;
    if (connector?.fetchDetail && posting.description.length < 400) {
      enriched = await connector.fetchDetail(posting);
      if (enriched.description !== posting.description) {
        await prisma.job.update({ where: { id: job.id }, data: { description: enriched.description } });
      }
    }

    try {
      const match = await scoreJob(enriched, profile, resume);
      if (!match) {
        await prisma.job.update({ where: { id: job.id }, data: { status: "rejected", skipReason: "Scoring failed" } });
        continue;
      }
      const score = Math.max(0, Math.min(100, Math.round(match.score)));
      const pass = score >= prefs.minMatchScore;
      await prisma.job.update({
        where: { id: job.id },
        data: {
          matchScore: score,
          matchReason: [match.reason, match.missingRequirements.length ? `Missing: ${match.missingRequirements.join(", ")}` : ""]
            .filter(Boolean)
            .join(" "),
          matchedAt: new Date(),
          status: pass ? "queued" : "rejected",
          skipReason: pass ? "" : `Score ${score} < ${prefs.minMatchScore}`,
        },
      });
      scored++;
    } catch (err) {
      await logger.error(SCOPE, `Scoring failed for ${job.title}`, { error: String(err) });
      await prisma.job.update({ where: { id: job.id }, data: { status: "rejected", skipReason: "Scoring error" } });
    }
  }

  return scored;
}

// --------------------------------------------------------------------- apply

export interface ApplyOutcome {
  applied: number;
  blocked: string;
}

/** Work the queue, highest match first, stopping the moment a gate says stop. */
export async function applyToQueued(max = 5): Promise<ApplyOutcome> {
  const profile = await getProfile();
  if (!profile) return { applied: 0, blocked: "No profile configured" };
  if (!profile.resumeJson) return { applied: 0, blocked: "No resume uploaded" };

  const prefs = await getPrefs();
  const resume = resumeOf(profile.resumeJson);
  let applied = 0;

  const queue = await prisma.job.findMany({
    where: { status: "queued" },
    orderBy: [{ matchScore: "desc" }, { discoveredAt: "desc" }],
    take: max * 3,
  });

  for (const job of queue) {
    if (applied >= max) break;

    const gate = await checkGates(job.portal, prefs);
    if (!gate.allowed) return { applied, blocked: gate.reason };

    const connector = getConnector(job.portal);
    if (!connector) {
      await prisma.job.update({ where: { id: job.id }, data: { status: "skipped", skipReason: "No connector" } });
      continue;
    }

    await setState({ phase: `applying: ${job.company} — ${job.title}` });
    await prisma.job.update({ where: { id: job.id }, data: { status: "applying" } });

    try {
      // 1. Tailor the resume, and refuse to proceed if the result drifted from the truth.
      const tailored = await tailorResume({
        base: resume,
        job: { title: job.title, company: job.company, location: job.location, description: job.description },
      });

      if (!tailored.verification.ok) {
        await logger.warn(SCOPE, `Tailoring failed verification for ${job.company}; using base resume`, {
          violations: tailored.verification.violations,
        });
      }
      const finalResume = tailored.verification.ok ? tailored.resume : resume;

      const pdfPath = await renderResumePdf(finalResume, `${safeSlug(job.company)}-${safeSlug(job.title)}`);

      await prisma.resumeVariant.upsert({
        where: { jobId: job.id },
        create: {
          jobId: job.id,
          json: s(finalResume),
          pdfPath,
          changeLog: s(tailored.verification.ok ? tailored.changeLog : ["Base resume used — tailoring failed verification"]),
          unsupported: s([...tailored.unsupported, ...tailored.verification.violations]),
        },
        update: {
          json: s(finalResume),
          pdfPath,
          changeLog: s(tailored.changeLog),
          unsupported: s([...tailored.unsupported, ...tailored.verification.violations]),
        },
      });

      // 2. Cover letter.
      const coverLetter = await writeCoverLetter({
        profile,
        resume: finalResume,
        job: { title: job.title, company: job.company, description: job.description },
      });

      // 3. Apply.
      const result = await connector.apply({
        job,
        profile,
        resume: finalResume,
        resumePdfPath: pdfPath,
        coverLetter,
        autoSubmit: prefs.autoSubmit,
      });

      const jobStatus =
        result.status === "submitted"
          ? "applied"
          : result.status === "needs_human"
            ? "needs_human"
            : result.status === "failed"
              ? "failed"
              : "applied"; // "prepared" still counts as worked

      await prisma.application.upsert({
        where: { jobId: job.id },
        create: {
          jobId: job.id,
          status: result.status === "submitted" ? "submitted" : result.status,
          submittedAt: result.status === "submitted" ? new Date() : null,
          method: result.method,
          coverLetter,
          answers: s(result.answers ?? {}),
          resumePath: pdfPath,
          screenshotPath: result.screenshotPath ?? "",
          confirmation: result.confirmation ?? "",
          error: result.error ?? "",
          attempts: 1,
          submittedBy: "agent",
        },
        update: {
          status: result.status === "submitted" ? "submitted" : result.status,
          submittedAt: result.status === "submitted" ? new Date() : null,
          answers: s(result.answers ?? {}),
          screenshotPath: result.screenshotPath ?? "",
          confirmation: result.confirmation ?? "",
          error: result.error ?? "",
          attempts: { increment: 1 },
        },
      });

      await prisma.job.update({ where: { id: job.id }, data: { status: jobStatus } });

      if (result.status === "needs_human") {
        await requestHuman(job.id, result.error || "Needs you to finish this application");
        await logger.warn(SCOPE, `Needs you: ${job.company} — ${job.title}`, { reason: result.error });
        return { applied, blocked: result.error || "Needs human" };
      }

      applied++;
      const state = await getState();
      await setState({ appliedToday: state.appliedToday + 1 });
      await logger.info(
        SCOPE,
        `${result.status === "submitted" ? "Applied" : "Prepared"}: ${job.company} — ${job.title} (${job.matchScore})`,
      );
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      await logger.error(SCOPE, `Application failed for ${job.company}`, { error: message });
      await prisma.job.update({ where: { id: job.id }, data: { status: "failed", skipReason: message.slice(0, 400) } });
      await prisma.application.upsert({
        where: { jobId: job.id },
        create: { jobId: job.id, status: "failed", error: message.slice(0, 1000), attempts: 1 },
        update: { status: "failed", error: message.slice(0, 1000), attempts: { increment: 1 } },
      });
    }
  }

  return { applied, blocked: "" };
}

// ---------------------------------------------------------------------- tick

export interface TickResult {
  discovered: number;
  scored: number;
  applied: number;
  blocked: string;
}

/** One full pass. Safe to call from the loop or by hand from the dashboard. */
export async function tick(): Promise<TickResult> {
  const discovered = await discover();
  const scored = await scoreNewJobs();
  const { applied, blocked } = await applyToQueued();

  if (applied > 0) {
    try {
      const file = await exportSpreadsheet();
      await logger.info(SCOPE, `Tracker updated: ${file}`);
    } catch (err) {
      await logger.warn(SCOPE, "Could not write the spreadsheet", { error: String(err) });
    }
  }

  await setState({ phase: "idle", lastHeartbeat: new Date() });
  return { discovered, scored, applied, blocked };
}

export { ALL_CONNECTORS };
