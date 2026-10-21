import type { Page } from "playwright";
import type { Profile, Job } from "@prisma/client";
import type { Resume } from "../lib/resume/schema";

export interface JobPosting {
  portal: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salaryText: string;
  experienceText: string;
  postedText: string;
  raw: unknown;
}

export interface SearchParams {
  queries: string[];
  locations: string[];
  remoteOnly: boolean;
  /** Hard ceiling per query, so one run cannot balloon. */
  maxPerQuery: number;
}

export interface ApplyContext {
  job: Job;
  profile: Profile;
  resume: Resume;
  /** Path to the tailored PDF to upload. */
  resumePdfPath: string;
  coverLetter: string;
  /** false = fill everything in, stop before the final Submit, and hand back. */
  autoSubmit: boolean;
}

export type ApplyStatus = "submitted" | "prepared" | "needs_human" | "failed" | "skipped";

export interface ApplyResult {
  status: ApplyStatus;
  method: string;
  confirmation?: string;
  error?: string;
  screenshotPath?: string;
  answers?: Record<string, string>;
}

export interface Connector {
  id: string;
  label: string;
  /** "ats" = public job-board API, automation is within terms.
   *  "portal" = aggregator that forbids automated access in its ToS. */
  kind: "ats" | "portal";
  /** Shown in the UI next to the toggle. Be honest about this. */
  tosNote: string;
  requiresLogin: boolean;
  /** Where the user logs in by hand the first time. */
  loginUrl?: string;
  search(params: SearchParams): Promise<JobPosting[]>;
  /** Portals only list a snippet on the results page; this fills in the full
   *  description for the postings that survived the cheap pre-filter. */
  fetchDetail?(posting: JobPosting): Promise<JobPosting>;
  apply(ctx: ApplyContext): Promise<ApplyResult>;
  /** Open a headed browser so the user can log in once. */
  checkAuth?(): Promise<"ok" | "needs_login">;
}

export type PageFn<T> = (page: Page) => Promise<T>;
