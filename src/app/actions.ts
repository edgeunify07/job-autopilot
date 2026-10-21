"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma, j, s } from "@/lib/db";
import { paths, ensureDirs, safeSlug } from "@/lib/paths";
import { parseResume } from "@/lib/resume/parse";
import { resumeToText, EMPTY_RESUME, type Resume } from "@/lib/resume/schema";
import { exportSpreadsheet, exportCsv } from "@/lib/sheet";
import { loadBoards, saveBoards, type BoardList } from "@/connectors/boards";
import { getConnector } from "@/connectors";
import { setState, clearHuman } from "@/worker/state";
import { tick } from "@/worker/pipeline";
import { logger } from "@/lib/logger";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string): number | null => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (fd: FormData, k: string, fallback: number) => {
  const n = num(fd, k);
  return n == null ? fallback : Math.round(n);
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
/** Comma- or newline-separated input into a clean list. */
const list = (fd: FormData, k: string) =>
  str(fd, k)
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);

// ------------------------------------------------------------------- resume

export async function uploadResumeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const file = fd.get("resume");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Pick a resume file first." };
  if (file.size > 10 * 1024 * 1024) return { ok: false, message: "That file is over 10 MB." };

  try {
    ensureDirs();
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = path.join(paths.resumes, `${safeSlug(file.name.replace(/\.[^.]+$/, ""))}${path.extname(file.name)}`);
    await fs.writeFile(stored, buffer);

    const { resume, text } = await parseResume({ buffer, fileName: file.name, mimeType: file.type });

    // Pre-fill everything the resume already tells us, so setup is short.
    const existing = await prisma.profile.findUnique({ where: { id: "me" } });
    const years = resume.experience.length ? undefined : 0;

    await prisma.profile.upsert({
      where: { id: "me" },
      create: {
        id: "me",
        fullName: resume.name,
        email: resume.email,
        phone: resume.phone,
        currentCity: resume.location,
        currentTitle: resume.experience[0]?.title ?? "",
        currentCompany: resume.experience[0]?.company ?? "",
        highestQualification: resume.education[0]?.degree ?? "",
        specialization: resume.education[0]?.field ?? "",
        institute: resume.education[0]?.institute ?? "",
        graduationYear: Number(resume.education[0]?.endYear) || null,
        skills: s(resume.skills.flatMap((g) => g.items)),
        linkedinUrl: resume.links.find((l) => /linkedin/i.test(l.label + l.url))?.url ?? "",
        githubUrl: resume.links.find((l) => /github/i.test(l.label + l.url))?.url ?? "",
        portfolioUrl: resume.links.find((l) => !/linkedin|github/i.test(l.label + l.url))?.url ?? "",
        summary: resume.summary,
        resumeJson: s(resume),
        resumeText: text,
        resumeFileName: file.name,
        resumeFilePath: stored,
        totalExperienceMonths: years ?? 0,
      },
      update: {
        // Never overwrite something the user typed by hand.
        fullName: existing?.fullName || resume.name,
        email: existing?.email || resume.email,
        phone: existing?.phone || resume.phone,
        currentCity: existing?.currentCity || resume.location,
        currentTitle: existing?.currentTitle || resume.experience[0]?.title || "",
        currentCompany: existing?.currentCompany || resume.experience[0]?.company || "",
        summary: existing?.summary || resume.summary,
        skills: s(resume.skills.flatMap((g) => g.items)),
        resumeJson: s(resume),
        resumeText: text,
        resumeFileName: file.name,
        resumeFilePath: stored,
      },
    });

    revalidatePath("/setup");
    revalidatePath("/");
    return {
      ok: true,
      message: `Read your resume: ${resume.experience.length} roles, ${resume.skills.flatMap((g) => g.items).length} skills. Check the details below.`,
    };
  } catch (err) {
    return { ok: false, message: String(err instanceof Error ? err.message : err) };
  }
}

// ------------------------------------------------------------------ profile

export async function saveProfileAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const fullName = str(fd, "fullName");
  const email = str(fd, "email");
  const phone = str(fd, "phone");
  if (!fullName || !email || !phone) return { ok: false, message: "Name, email and phone are required." };

  const months = Math.round((num(fd, "totalExperienceYears") ?? 0) * 12);

  await prisma.profile.upsert({
    where: { id: "me" },
    create: { id: "me", fullName, email, phone },
    update: {},
  });

  await prisma.profile.update({
    where: { id: "me" },
    data: {
      fullName,
      email,
      phone,
      currentCity: str(fd, "currentCity"),
      preferredLocations: s(list(fd, "preferredLocations")),
      willingToRelocate: bool(fd, "willingToRelocate"),
      currentTitle: str(fd, "currentTitle"),
      currentCompany: str(fd, "currentCompany"),
      totalExperienceMonths: months,
      currentCtcLpa: num(fd, "currentCtcLpa"),
      expectedCtcLpa: num(fd, "expectedCtcLpa"),
      noticePeriodDays: int(fd, "noticePeriodDays", 30),
      servingNotice: bool(fd, "servingNotice"),
      highestQualification: str(fd, "highestQualification"),
      specialization: str(fd, "specialization"),
      institute: str(fd, "institute"),
      graduationYear: num(fd, "graduationYear") ? Math.round(num(fd, "graduationYear")!) : null,
      linkedinUrl: str(fd, "linkedinUrl"),
      githubUrl: str(fd, "githubUrl"),
      portfolioUrl: str(fd, "portfolioUrl"),
      gender: str(fd, "gender"),
      dateOfBirth: str(fd, "dateOfBirth"),
      nationality: str(fd, "nationality") || "Indian",
      needsVisaSponsorship: bool(fd, "needsVisaSponsorship"),
      differentlyAbled: bool(fd, "differentlyAbled"),
      summary: str(fd, "summary"),
    },
  });

  revalidatePath("/setup");
  revalidatePath("/");
  return { ok: true, message: "Saved." };
}

// -------------------------------------------------------------- preferences

export async function savePreferencesAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const titles = list(fd, "titles");
  if (!titles.length) return { ok: false, message: "Add at least one job title to search for." };

  const portals = fd.getAll("portals").map(String).filter(Boolean);

  await prisma.searchPreference.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });

  await prisma.searchPreference.update({
    where: { id: "default" },
    data: {
      titles: s(titles),
      mustHaveKeywords: s(list(fd, "mustHaveKeywords")),
      excludeKeywords: s(list(fd, "excludeKeywords")),
      locations: s(list(fd, "locations")),
      remoteOnly: bool(fd, "remoteOnly"),
      minExperienceYears: num(fd, "minExperienceYears") ?? 0,
      maxExperienceYears: num(fd, "maxExperienceYears") ?? 50,
      minSalaryLpa: num(fd, "minSalaryLpa"),
      enabledPortals: s(portals),
      minMatchScore: int(fd, "minMatchScore", 65),
      dailyApplicationCap: int(fd, "dailyApplicationCap", 25),
      perPortalHourlyCap: int(fd, "perPortalHourlyCap", 6),
      minSecondsBetweenApps: int(fd, "minSecondsBetweenApps", 90),
      autoSubmit: bool(fd, "autoSubmit"),
      activeHoursStart: int(fd, "activeHoursStart", 8),
      activeHoursEnd: int(fd, "activeHoursEnd", 23),
      searchIntervalMinutes: Math.max(5, int(fd, "searchIntervalMinutes", 45)),
    },
  });

  revalidatePath("/settings");
  revalidatePath("/setup");
  revalidatePath("/");
  return { ok: true, message: "Preferences saved." };
}

export async function saveBoardsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const next: BoardList = {
    greenhouse: list(fd, "greenhouse"),
    lever: list(fd, "lever"),
    ashby: list(fd, "ashby"),
  };
  saveBoards(next);
  revalidatePath("/settings");
  return { ok: true, message: `Tracking ${next.greenhouse.length + next.lever.length + next.ashby.length} company boards.` };
}

// ------------------------------------------------------------------ control

export async function setRunningAction(running: boolean): Promise<ActionResult> {
  const profile = await prisma.profile.findUnique({ where: { id: "me" } });
  if (running) {
    if (!profile?.resumeJson) return { ok: false, message: "Upload a resume before starting." };
    if (!profile.fullName || !profile.email || !profile.phone)
      return { ok: false, message: "Fill in your name, email and phone first." };
    const prefs = await prisma.searchPreference.findUnique({ where: { id: "default" } });
    if (!prefs || !j<string[]>(prefs.titles, []).length)
      return { ok: false, message: "Add at least one job title to search for." };
  }
  await setState({ running, phase: running ? "starting" : "stopped" });
  await logger.info("control", running ? "Autopilot switched on" : "Autopilot switched off");
  revalidatePath("/");
  return { ok: true, message: running ? "Autopilot is on." : "Autopilot stopped." };
}

export async function clearBlockAction(): Promise<ActionResult> {
  await clearHuman();
  revalidatePath("/");
  return { ok: true, message: "Cleared. The agent will carry on at its next pass." };
}

export async function runOnceAction(): Promise<ActionResult> {
  try {
    const result = await tick();
    revalidatePath("/");
    revalidatePath("/jobs");
    revalidatePath("/applications");
    return {
      ok: true,
      message: `${result.discovered} found, ${result.scored} scored, ${result.applied} applied${result.blocked ? ` — paused: ${result.blocked}` : ""}.`,
    };
  } catch (err) {
    return { ok: false, message: String(err instanceof Error ? err.message : err) };
  }
}

export async function exportAction(): Promise<ActionResult> {
  try {
    const xlsx = await exportSpreadsheet();
    await exportCsv();
    return { ok: true, message: `Written to ${xlsx}` };
  } catch (err) {
    return { ok: false, message: String(err instanceof Error ? err.message : err) };
  }
}

export async function openPortalLoginAction(portalId: string): Promise<ActionResult> {
  const connector = getConnector(portalId);
  if (!connector?.checkAuth) return { ok: false, message: "That connector does not need a login." };
  try {
    const status = await connector.checkAuth();
    await prisma.portalAccount.upsert({
      where: { portal: portalId },
      create: { portal: portalId, status, lastCheckedAt: new Date() },
      update: { status, lastCheckedAt: new Date() },
    });
    revalidatePath("/settings");
    return {
      ok: status === "ok",
      message:
        status === "ok"
          ? `Logged in to ${connector.label}.`
          : `Not logged in. Run HEADLESS=false npm run worker, then sign in once in the window that opens — the session is remembered after that.`,
    };
  } catch (err) {
    return { ok: false, message: String(err instanceof Error ? err.message : err) };
  }
}

export async function retryJobAction(jobId: string): Promise<ActionResult> {
  await prisma.job.update({ where: { id: jobId }, data: { status: "queued", skipReason: "" } });
  await clearHuman();
  revalidatePath("/jobs");
  revalidatePath("/");
  return { ok: true, message: "Back in the queue." };
}

export async function skipJobAction(jobId: string): Promise<ActionResult> {
  await prisma.job.update({ where: { id: jobId }, data: { status: "skipped", skipReason: "Skipped by you" } });
  await clearHuman();
  revalidatePath("/jobs");
  revalidatePath("/");
  return { ok: true, message: "Skipped." };
}

export async function markSubmittedAction(jobId: string): Promise<ActionResult> {
  await prisma.application.updateMany({
    where: { jobId },
    data: { status: "submitted", submittedAt: new Date(), submittedBy: "human", error: "" },
  });
  await prisma.job.update({ where: { id: jobId }, data: { status: "applied" } });
  await clearHuman();
  revalidatePath("/applications");
  revalidatePath("/");
  return { ok: true, message: "Marked as submitted." };
}

export async function getBoardsAction(): Promise<BoardList> {
  return loadBoards();
}

export async function resumePreviewAction(): Promise<string> {
  const profile = await prisma.profile.findUnique({ where: { id: "me" } });
  if (!profile?.resumeJson) return "";
  return resumeToText(j<Resume>(profile.resumeJson, EMPTY_RESUME));
}
