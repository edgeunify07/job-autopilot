import type { Page } from "playwright";
import type { Connector, JobPosting, SearchParams, ApplyContext, ApplyResult } from "./types";
import { getPortalContext, jitter, detectHumanWall, screenshot } from "../automation/browser";
import { applyViaContext, applyOnPage } from "../automation/apply";
import { logger } from "../lib/logger";

/**
 * Selector config per portal. Portals redesign their markup regularly, so every
 * field takes a list of candidates and we use the first that hits. When a portal
 * stops returning results, this is the object to update.
 */
interface CardSelectors {
  root: string[];
  title: string[];
  company: string[];
  location: string[];
  salary: string[];
  experience: string[];
  posted: string[];
  snippet: string[];
  link: string[];
}

interface PortalSpec {
  id: string;
  label: string;
  tosNote: string;
  loginUrl: string;
  /** Present on the page only when logged in. */
  loggedInProbe: string[];
  searchUrl(query: string, location: string, pageNum: number, remoteOnly: boolean): string;
  card: CardSelectors;
  detail: { description: string[] };
  /** Some portals need an in-page "Apply" flow rather than a form on the posting. */
  applyMode: "generic" | "easy-apply";
}

const enc = encodeURIComponent;
const slug = (v: string) => v.trim().toLowerCase().replace(/\s+/g, "-");

export const PORTALS: PortalSpec[] = [
  {
    id: "naukri",
    label: "Naukri.com",
    tosNote:
      "Naukri's terms prohibit automated access. Runs on your own logged-in session with conservative limits; use at your own risk.",
    loginUrl: "https://www.naukri.com/nlogin/login",
    loggedInProbe: ["div.nI-gNb-drawer__bars", ".nI-gNb-menuItems", "[class*='view-profile']"],
    searchUrl: (q, loc, pageNum) =>
      `https://www.naukri.com/${slug(q)}-jobs${loc ? `-in-${slug(loc)}` : ""}${pageNum > 1 ? `-${pageNum}` : ""}?k=${enc(q)}${loc ? `&l=${enc(loc)}` : ""}`,
    card: {
      root: ["div.srp-jobtuple-wrapper", "article.jobTuple", "div.cust-job-tuple"],
      title: ["a.title", "a.jobTupleHeader-title", "h2 a"],
      company: ["a.comp-name", "a.subTitle", "span.comp-name"],
      location: ["span.locWdth", "li.location", "span.loc-wrap"],
      salary: ["span.sal-wrap", "span.sal", "li.salary"],
      experience: ["span.expwdth", "span.exp-wrap", "li.experience"],
      posted: ["span.job-post-day", "span.jobTupleFooter span"],
      snippet: ["span.job-desc", "div.job-description"],
      link: ["a.title", "h2 a"],
    },
    detail: { description: ["div.styles_JDC__dang-inner-html__h0K4t", "section.job-desc", "div.dang-inner-html"] },
    applyMode: "easy-apply",
  },
  {
    id: "indeed",
    label: "Indeed India",
    tosNote:
      "Indeed's terms prohibit scraping and automated applying, and it uses aggressive bot protection. Expect frequent human handoffs.",
    loginUrl: "https://secure.indeed.com/account/login",
    loggedInProbe: ["[data-gnav-element-name='AccountMenu']", "#AccountMenu"],
    searchUrl: (q, loc, pageNum, remote) =>
      `https://in.indeed.com/jobs?q=${enc(q)}${loc ? `&l=${enc(loc)}` : ""}${remote ? "&sc=0kf%3Aattr(DSQF7)%3B" : ""}${pageNum > 1 ? `&start=${(pageNum - 1) * 10}` : ""}`,
    card: {
      root: ["div.job_seen_beacon", "div.cardOutline", "li div.slider_container"],
      title: ["h2.jobTitle span[title]", "h2.jobTitle a span", "h2.jobTitle"],
      company: ["[data-testid='company-name']", "span.companyName"],
      location: ["[data-testid='text-location']", "div.companyLocation"],
      salary: ["[data-testid='attribute_snippet_testid']", "div.salary-snippet-container"],
      experience: [],
      posted: ["[data-testid='myJobsStateDate']", "span.date"],
      snippet: ["[data-testid='jobsnippet_footer']", "div.job-snippet"],
      link: ["h2.jobTitle a", "a.jcs-JobTitle"],
    },
    detail: { description: ["#jobDescriptionText", "div.jobsearch-JobComponent-description"] },
    applyMode: "generic",
  },
  {
    id: "linkedin",
    label: "LinkedIn Jobs",
    tosNote:
      "LinkedIn's User Agreement forbids automated access, and enforcement includes account restriction. Lowest limits of any connector here.",
    loginUrl: "https://www.linkedin.com/login",
    loggedInProbe: ["img.global-nav__me-photo", ".global-nav__me", "[data-control-name='nav.settings']"],
    searchUrl: (q, loc, pageNum, remote) =>
      `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}${loc ? `&location=${enc(loc)}` : ""}${remote ? "&f_WT=2" : ""}${pageNum > 1 ? `&start=${(pageNum - 1) * 25}` : ""}`,
    card: {
      root: ["div.job-card-container", "li.jobs-search-results__list-item", "div.base-card"],
      title: ["a.job-card-list__title", "h3.base-search-card__title", "[class*='job-card-list__title']"],
      company: ["span.job-card-container__primary-description", "h4.base-search-card__subtitle"],
      location: ["li.job-card-container__metadata-item", "span.job-search-card__location"],
      salary: ["span.job-card-container__salary-info"],
      experience: [],
      posted: ["time", "div.job-card-container__footer-item"],
      snippet: [],
      link: ["a.job-card-list__title", "a.base-card__full-link"],
    },
    detail: { description: ["div.jobs-description__content", "div.show-more-less-html__markup"] },
    applyMode: "easy-apply",
  },
  {
    id: "internshala",
    label: "Internshala",
    tosNote: "Automated applying is against Internshala's terms. Good for entry-level and internships.",
    loginUrl: "https://internshala.com/login/student",
    loggedInProbe: ["#profile_container", ".profile_container", "[href*='/student/dashboard']"],
    searchUrl: (q, loc, pageNum) =>
      `https://internshala.com/jobs/keywords-${slug(q)}${loc ? `/location-${slug(loc)}` : ""}${pageNum > 1 ? `/page-${pageNum}` : ""}`,
    card: {
      root: ["div.individual_internship", "div.internship_meta"],
      title: ["h3.job-internship-name", "div.heading_4_5 a", "h3 a"],
      company: ["p.company-name", "div.company_name a", "h4.company_name"],
      location: ["div.row-1-item.locations span", "a.location_link", "#location_names span"],
      salary: ["span.desktop", "div.item_body.salary", "span.stipend"],
      experience: ["div.row-1-item:nth-child(2) span", "div.item_body.experience"],
      posted: ["div.status-success", "div.posted_by_container"],
      snippet: ["div.internship_details"],
      link: ["h3.job-internship-name a", "a.job-title-href", "h3 a"],
    },
    detail: { description: ["div.internship_details", "div.detail_view"] },
    applyMode: "generic",
  },
];

/** First selector that yields text wins. */
async function pick(root: import("playwright").Locator, selectors: string[]): Promise<string> {
  for (const sel of selectors) {
    const el = root.locator(sel).first();
    const txt = await el.innerText({ timeout: 1200 }).catch(() => "");
    if (txt?.trim()) return txt.trim().replace(/\s+/g, " ");
  }
  return "";
}

async function pickHref(root: import("playwright").Locator, selectors: string[]): Promise<string> {
  for (const sel of selectors) {
    const href = await root.locator(sel).first().getAttribute("href", { timeout: 1200 }).catch(() => null);
    if (href) return href;
  }
  return "";
}

async function anyVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    if (await page.locator(sel).first().isVisible({ timeout: 2500 }).catch(() => false)) return true;
  }
  return false;
}

function makePortalConnector(spec: PortalSpec): Connector {
  return {
    id: spec.id,
    label: spec.label,
    kind: "portal",
    tosNote: spec.tosNote,
    requiresLogin: true,
    loginUrl: spec.loginUrl,

    async checkAuth() {
      const ctx = await getPortalContext(spec.id);
      const page = await ctx.newPage();
      try {
        await page.goto(spec.loginUrl, { waitUntil: "domcontentloaded", timeout: 40_000 });
        await jitter(1500, 2500);
        return (await anyVisible(page, spec.loggedInProbe)) ? "ok" : "needs_login";
      } catch {
        return "needs_login";
      } finally {
        await page.close().catch(() => {});
      }
    },

    async search(params: SearchParams): Promise<JobPosting[]> {
      const ctx = await getPortalContext(spec.id);
      const page = await ctx.newPage();
      const found: JobPosting[] = [];
      const seen = new Set<string>();

      try {
        const locations = params.locations.length ? params.locations : [""];
        for (const query of params.queries) {
          for (const location of locations) {
            if (found.length >= params.maxPerQuery * params.queries.length) break;

            const url = spec.searchUrl(query, location, 1, params.remoteOnly);
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
            await jitter(2500, 5000);

            const wall = await detectHumanWall(page);
            if (wall) {
              await logger.warn(spec.id, `Search blocked by ${wall}. Open the browser and clear it.`);
              await screenshot(page, `${spec.id}-search-${wall}`);
              return found;
            }

            let cards = page.locator(spec.card.root[0]);
            for (const sel of spec.card.root) {
              const probe = page.locator(sel);
              if ((await probe.count().catch(() => 0)) > 0) {
                cards = probe;
                break;
              }
            }

            const count = Math.min(await cards.count().catch(() => 0), params.maxPerQuery);
            if (count === 0) {
              await logger.warn(spec.id, `No cards matched for "${query}" — selectors may need updating`, { url });
              continue;
            }

            for (let i = 0; i < count; i++) {
              const card = cards.nth(i);
              const href = await pickHref(card, spec.card.link);
              if (!href) continue;
              const absolute = href.startsWith("http") ? href : new URL(href, page.url()).toString();
              const externalId = absolute.split("?")[0];
              if (seen.has(externalId)) continue;
              seen.add(externalId);

              found.push({
                portal: spec.id,
                externalId,
                url: absolute,
                title: await pick(card, spec.card.title),
                company: await pick(card, spec.card.company),
                location: await pick(card, spec.card.location),
                description: await pick(card, spec.card.snippet),
                salaryText: await pick(card, spec.card.salary),
                experienceText: await pick(card, spec.card.experience),
                postedText: await pick(card, spec.card.posted),
                raw: { query, searchLocation: location },
              });
            }
            await jitter(3000, 6000); // be a polite visitor between result pages
          }
        }
      } catch (err) {
        await logger.error(spec.id, "Search failed", { error: String(err) });
      } finally {
        await page.close().catch(() => {});
      }

      return found;
    },

    async fetchDetail(posting: JobPosting): Promise<JobPosting> {
      const ctx = await getPortalContext(spec.id);
      const page = await ctx.newPage();
      try {
        await page.goto(posting.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await jitter(1500, 3000);
        let description = "";
        for (const sel of spec.detail.description) {
          description = await page.locator(sel).first().innerText({ timeout: 4000 }).catch(() => "");
          if (description.trim()) break;
        }
        if (!description.trim()) description = await page.innerText("body").catch(() => "");
        return { ...posting, description: description.slice(0, 25_000).trim() || posting.description };
      } catch {
        return posting;
      } finally {
        await page.close().catch(() => {});
      }
    },

    async apply(ctx: ApplyContext): Promise<ApplyResult> {
      const context = await getPortalContext(spec.id);

      if (spec.applyMode === "generic") return applyViaContext(ctx, context);

      // Easy-apply portals keep the form in a modal on the posting page.
      const page = await context.newPage();
      try {
        await page.goto(ctx.job.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await jitter(2000, 4000);

        if (!(await anyVisible(page, spec.loggedInProbe))) {
          return {
            status: "needs_human",
            method: `${spec.id}-easy-apply`,
            error: `Not logged in to ${spec.label}. Log in once in the browser window; the session is remembered.`,
            screenshotPath: await screenshot(page, `${spec.id}-logged-out`),
          };
        }
        return await applyOnPage(ctx, page);
      } catch (err) {
        return {
          status: "failed",
          method: `${spec.id}-easy-apply`,
          error: String(err instanceof Error ? err.message : err),
        };
      } finally {
        if (ctx.autoSubmit) await page.close().catch(() => {});
      }
    },
  };
}

export const portalConnectors = PORTALS.map(makePortalConnector);
