import type { Connector, JobPosting, SearchParams, ApplyContext, ApplyResult } from "./types";
import { loadBoards } from "./boards";
import { getPortalContext } from "../automation/browser";
import { applyViaContext } from "../automation/apply";
import { logger } from "../lib/logger";
import { locationMatches } from "../lib/locations";

const UA = "job-autopilot/0.1 (personal job search)";

/** These APIs return HTML (Greenhouse entity-encodes it, so decode before stripping). */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function stripHtml(html: string): string {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\u2022 ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Keep only postings that plausibly match what the user is looking for.
 *
 * Title matching may consult the description; location matching may NOT — a US
 * role whose text mentions a Bengaluru office is still a US role.
 */
function matchesQuery(posting: JobPosting, params: SearchParams): boolean {
  const hay = `${posting.title} ${posting.description.slice(0, 1500)}`.toLowerCase();
  const titleHit = params.queries.length === 0 || params.queries.some((q) => hay.includes(q.toLowerCase()));
  if (!titleHit) return false;

  return locationMatches(posting.location, {
    wanted: params.locations,
    remoteOnly: params.remoteOnly,
    indiaOnly: params.indiaOnly,
    allowUnscopedRemote: params.allowUnscopedRemote,
  });
}

// ---------------------------------------------------------------- Greenhouse

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  content: string;
  updated_at: string;
  location?: { name?: string };
}

async function searchGreenhouse(params: SearchParams): Promise<JobPosting[]> {
  const boards = loadBoards().greenhouse;
  const out: JobPosting[] = [];
  for (const token of boards) {
    const data = await getJson<{ jobs: GhJob[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
    );
    if (!data?.jobs) {
      await logger.debug("greenhouse", `No board for "${token}" — check the token`);
      continue;
    }
    for (const job of data.jobs.slice(0, params.maxPerQuery * 3)) {
      const posting: JobPosting = {
        portal: "greenhouse",
        externalId: `${token}:${job.id}`,
        url: job.absolute_url,
        title: job.title,
        company: token,
        location: job.location?.name ?? "",
        description: stripHtml(job.content ?? ""),
        salaryText: "",
        experienceText: "",
        postedText: job.updated_at ?? "",
        raw: job,
      };
      if (matchesQuery(posting, params)) out.push(posting);
    }
  }
  return out;
}

// --------------------------------------------------------------------- Lever

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  descriptionPlain?: string;
  description?: string;
  createdAt?: number;
  categories?: { location?: string; commitment?: string; team?: string };
}

async function searchLever(params: SearchParams): Promise<JobPosting[]> {
  const out: JobPosting[] = [];
  for (const company of loadBoards().lever) {
    const jobs = await getJson<LeverJob[]>(
      `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`,
    );
    if (!jobs) {
      await logger.debug("lever", `No board for "${company}" — check the token`);
      continue;
    }
    for (const job of jobs.slice(0, params.maxPerQuery * 3)) {
      const posting: JobPosting = {
        portal: "lever",
        externalId: `${company}:${job.id}`,
        url: job.hostedUrl,
        title: job.text,
        company,
        location: job.categories?.location ?? "",
        description: job.descriptionPlain || stripHtml(job.description ?? ""),
        salaryText: "",
        experienceText: job.categories?.commitment ?? "",
        postedText: job.createdAt ? new Date(job.createdAt).toISOString() : "",
        raw: job,
      };
      if (matchesQuery(posting, params)) out.push(posting);
    }
  }
  return out;
}

// --------------------------------------------------------------------- Ashby

interface AshbyJob {
  id: string;
  title: string;
  location: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  jobUrl: string;
  employmentType?: string;
  publishedAt?: string;
  compensation?: { compensationTierSummary?: string };
}

async function searchAshby(params: SearchParams): Promise<JobPosting[]> {
  const out: JobPosting[] = [];
  for (const company of loadBoards().ashby) {
    const data = await getJson<{ jobs: AshbyJob[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}?includeCompensation=true`,
    );
    if (!data?.jobs) {
      await logger.debug("ashby", `No board for "${company}" — check the token`);
      continue;
    }
    for (const job of data.jobs.slice(0, params.maxPerQuery * 3)) {
      const posting: JobPosting = {
        portal: "ashby",
        externalId: `${company}:${job.id}`,
        url: job.jobUrl,
        title: job.title,
        company,
        location: job.location ?? "",
        description: job.descriptionPlain || stripHtml(job.descriptionHtml ?? ""),
        salaryText: job.compensation?.compensationTierSummary ?? "",
        experienceText: job.employmentType ?? "",
        postedText: job.publishedAt ?? "",
        raw: job,
      };
      if (matchesQuery(posting, params)) out.push(posting);
    }
  }
  return out;
}

// --------------------------------------------------------------- Connectors

function atsConnector(
  id: string,
  label: string,
  search: (p: SearchParams) => Promise<JobPosting[]>,
): Connector {
  return {
    id,
    label,
    kind: "ats",
    tosNote: "Public job-board API. Reading it and applying through the company's own form is above board.",
    requiresLogin: false,
    search,
    async apply(ctx: ApplyContext): Promise<ApplyResult> {
      const context = await getPortalContext(id);
      return applyViaContext(ctx, context);
    },
  };
}

export const greenhouseConnector = atsConnector("greenhouse", "Greenhouse boards", searchGreenhouse);
export const leverConnector = atsConnector("lever", "Lever boards", searchLever);
export const ashbyConnector = atsConnector("ashby", "Ashby boards", searchAshby);
