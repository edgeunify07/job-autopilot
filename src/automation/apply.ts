import type { BrowserContext, Page } from "playwright";
import type { ApplyContext, ApplyResult } from "../connectors/types";
import { scanForm, planAnswers, fillForm, uploadResume, findSubmitButton } from "./formfill";
import { detectHumanWall, jitter, screenshot } from "./browser";
import { logger } from "../lib/logger";

const APPLY_TRIGGERS = [
  /^apply( now| for this job| to this job)?$/i,
  /^easy apply$/i,
  /^i'?m interested$/i,
  /^start application$/i,
  /^apply with (your )?resume$/i,
];

const CONFIRMATION_PATTERNS = [
  /application (has been )?(submitted|sent|received)/i,
  /thank you for (applying|your application|your interest)/i,
  /we(?:'| ha)ve received your application/i,
  /successfully applied/i,
  /applied successfully/i,
  /your application is (in|on its way)/i,
];

/** Click whatever reveals the application form, if the form is not already present. */
async function revealForm(page: Page): Promise<boolean> {
  const existing = await scanForm(page);
  if (existing.length >= 2) return true;

  const buttons = page.locator('button, a[role="button"], a[href*="apply"], [role="button"]');
  const n = Math.min(await buttons.count().catch(() => 0), 50);
  for (let i = 0; i < n; i++) {
    const el = buttons.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const label = ((await el.innerText().catch(() => "")) || "").trim();
    if (!APPLY_TRIGGERS.some((p) => p.test(label))) continue;
    await el.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
    await jitter(1200, 2500);
    return true;
  }
  return false;
}

async function looksConfirmed(page: Page): Promise<string | null> {
  const body = await page.innerText("body").catch(() => "");
  for (const p of CONFIRMATION_PATTERNS) {
    const m = body.match(p);
    if (m) return m[0];
  }
  return null;
}

/**
 * The shared application driver. Every connector that just needs "open the posting
 * and fill in whatever form is there" uses this; portal-specific connectors call it
 * after they have navigated to the right place.
 */
export async function applyOnPage(ctx: ApplyContext, page: Page): Promise<ApplyResult> {
  const label = `${ctx.job.company}-${ctx.job.title}`;

  const wall = await detectHumanWall(page);
  if (wall) {
    return {
      status: "needs_human",
      method: "generic-form",
      error: `Hit a ${wall} wall — open the browser window and clear it.`,
      screenshotPath: await screenshot(page, `${label}-wall`),
    };
  }

  await revealForm(page);
  await jitter(800, 1600);

  const fields = await scanForm(page);
  if (fields.length === 0) {
    return {
      status: "needs_human",
      method: "generic-form",
      error: "No form fields found — this posting probably redirects to an external site.",
      screenshotPath: await screenshot(page, `${label}-noform`),
    };
  }

  await logger.info("apply", `Found ${fields.length} fields on ${ctx.job.company} — ${ctx.job.title}`);

  const plan = await planAnswers(fields, ctx.profile, ctx.resume, {
    title: ctx.job.title,
    company: ctx.job.company,
    description: ctx.job.description,
  });

  const answers = await fillForm(page, plan);
  const uploaded = await uploadResume(page, ctx.resumePdfPath);
  if (uploaded) await logger.info("apply", "Attached tailored resume");

  // A required field we could not answer is a stop sign, not something to guess past.
  const blockers = plan.filter((p) => p.field.required && !p.answer);
  if (blockers.length) {
    return {
      status: "needs_human",
      method: "generic-form",
      answers,
      error: `Required but unanswerable: ${blockers.map((b) => b.field.label || b.field.name).join("; ")}`,
      screenshotPath: await screenshot(page, `${label}-blocked`),
    };
  }

  const shot = await screenshot(page, `${label}-filled`);

  if (!ctx.autoSubmit) {
    return {
      status: "prepared",
      method: "generic-form",
      answers,
      screenshotPath: shot,
      confirmation: "Filled in and left open for your review. Nothing was submitted.",
    };
  }

  const submit = await findSubmitButton(page);
  if (!submit) {
    return {
      status: "needs_human",
      method: "generic-form",
      answers,
      error: "Form filled but no Submit button identified.",
      screenshotPath: shot,
    };
  }

  await submit.click({ timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await jitter(2000, 4000);

  const confirmation = await looksConfirmed(page);
  const afterShot = await screenshot(page, `${label}-after-submit`);

  if (confirmation) {
    return { status: "submitted", method: "generic-form", answers, confirmation, screenshotPath: afterShot };
  }

  const wallAfter = await detectHumanWall(page);
  return {
    status: "needs_human",
    method: "generic-form",
    answers,
    error: wallAfter
      ? `Submitted but hit a ${wallAfter} — check the browser.`
      : "Clicked Submit but saw no confirmation. Verify manually before re-running.",
    screenshotPath: afterShot,
  };
}

/** Open the posting in the portal's own context and run the generic driver. */
export async function applyViaContext(ctx: ApplyContext, context: BrowserContext): Promise<ApplyResult> {
  const page = await context.newPage();
  try {
    await page.goto(ctx.job.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await jitter(1500, 3000);
    return await applyOnPage(ctx, page);
  } catch (err) {
    return {
      status: "failed",
      method: "generic-form",
      error: String(err instanceof Error ? err.message : err),
      screenshotPath: await screenshot(page, `${ctx.job.company}-error`),
    };
  } finally {
    // Leave the page open when a human needs to finish the job.
    if (ctx.autoSubmit) await page.close().catch(() => {});
  }
}
