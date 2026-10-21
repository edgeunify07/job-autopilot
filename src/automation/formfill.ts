import { z } from "zod";
import type { Page } from "playwright";
import type { Profile } from "@prisma/client";
import { structured, MODELS, TRUTHFULNESS_RULE } from "../lib/ai";
import { resumeToText, type Resume } from "../lib/resume/schema";
import { deterministicAnswer, bestOption, type FieldDescriptor } from "./fields";
import { jitter } from "./browser";
import { logger } from "../lib/logger";

const ATTR = "data-ja-key";

/** Escape a value for use inside a CSS attribute selector, Node-side.
 *  (CSS.escape only exists in the browser, so it cannot be used here.) */
const attrValue = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * Walk the page and describe every control a human would have to fill.
 * Each control gets a stable attribute so we can come back and fill it.
 */
export async function scanForm(page: Page): Promise<FieldDescriptor[]> {
  const raw = await page.evaluate((attr) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };

    const labelFor = (el: HTMLElement): string => {
      const id = el.getAttribute("id");
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl?.textContent?.trim()) return lbl.textContent.trim();
      }
      const wrapping = el.closest("label");
      if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
      const aria = el.getAttribute("aria-label");
      if (aria) return aria;
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const t = labelledBy
          .split(/\s+/)
          .map((i) => document.getElementById(i)?.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ");
        if (t) return t;
      }
      // Fall back to the nearest preceding text node in the field's group.
      let node: HTMLElement | null = el.parentElement;
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        const text = Array.from(node.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent?.trim() ?? "")
          .filter((t) => t.length > 1)
          .join(" ");
        if (text) return text;
        const heading = node.querySelector("legend, .label, [class*='label'], [class*='question']");
        if (heading?.textContent?.trim()) return heading.textContent.trim();
      }
      return "";
    };

    const out: Array<Record<string, unknown>> = [];
    const seenRadioGroups = new Set<string>();
    let n = 0;

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>("input, textarea, select"),
    ).filter((el) => {
      const t = (el.getAttribute("type") || "").toLowerCase();
      if (t === "hidden" || t === "submit" || t === "button" || t === "reset" || t === "image") return false;
      if ((el as HTMLInputElement).disabled) return false;
      return visible(el);
    });

    for (const el of controls) {
      const tag = el.tagName.toLowerCase() as "input" | "textarea" | "select";
      const type = (el.getAttribute("type") || (tag === "select" ? "select" : "text")).toLowerCase();

      // Radio groups are one logical question; describe the group once.
      // The question text comes from the group (legend / aria-label / heading),
      // NOT from labelFor(member) — that returns the option text ("Yes").
      if (type === "radio") {
        const name = el.getAttribute("name") || "";
        if (!name || seenRadioGroups.has(name)) continue;
        seenRadioGroups.add(name);
        const members = Array.from(
          document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
        );

        const groupLabel = (): string => {
          const first = members[0];
          const legend = first.closest("fieldset")?.querySelector("legend")?.textContent?.trim();
          if (legend) return legend;
          const group = first.closest("[role='radiogroup'], [role='group']");
          const aria = group?.getAttribute("aria-label");
          if (aria) return aria;
          const ariaBy = group?.getAttribute("aria-labelledby");
          if (ariaBy) {
            const txt = ariaBy
              .split(/\s+/)
              .map((i) => document.getElementById(i)?.textContent?.trim() ?? "")
              .filter(Boolean)
              .join(" ");
            if (txt) return txt;
          }
          // Walk up to the first ancestor that contains every option, then look
          // for question-ish text inside it that is not one of the options.
          let node: HTMLElement | null = first.parentElement;
          for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
            if (!members.every((m) => node!.contains(m))) continue;
            const heading = node.querySelector(
              "legend, h1, h2, h3, h4, h5, h6, .label, [class*='label'], [class*='question'], [class*='title']",
            );
            const headingText = heading?.textContent?.trim();
            if (headingText && !members.some((m) => heading!.contains(m))) return headingText;
            const direct = Array.from(node.childNodes)
              .filter((c) => c.nodeType === Node.TEXT_NODE)
              .map((c) => c.textContent?.trim() ?? "")
              .filter((x) => x.length > 2)
              .join(" ");
            if (direct) return direct;
          }
          return name;
        };

        const key = `f${n++}`;
        members.forEach((m) => m.setAttribute(attr, key));
        out.push({
          key,
          tag: "input",
          type: "radio",
          label: groupLabel(),
          placeholder: "",
          name,
          required: members.some((m) => m.required),
          options: members.map((m) => ({ value: m.value, label: labelFor(m) || m.value })),
          maxLength: null,
          currentValue: members.find((m) => m.checked)?.value ?? "",
        });
        continue;
      }

      const key = `f${n++}`;
      el.setAttribute(attr, key);

      let options: Array<{ value: string; label: string }> = [];
      if (tag === "select") {
        options = Array.from((el as HTMLSelectElement).options)
          .filter((o) => o.value !== "")
          .map((o) => ({ value: o.value, label: o.textContent?.trim() ?? o.value }));
      }

      const maxAttr = el.getAttribute("maxlength");
      out.push({
        key,
        tag,
        type,
        label: labelFor(el).slice(0, 300),
        placeholder: el.getAttribute("placeholder") ?? "",
        name: el.getAttribute("name") ?? "",
        required: (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true",
        options,
        maxLength: maxAttr ? Number(maxAttr) : null,
        currentValue: (el as HTMLInputElement).value ?? "",
      });
    }
    return out;
  }, ATTR);
  return raw as unknown as FieldDescriptor[];
}

const AnswerSchema = z.object({
  answers: z.array(
    z.object({
      key: z.string(),
      answer: z.string().describe('Your answer. Use "" to deliberately leave a field blank.'),
      confident: z.boolean().describe("false if you are guessing and a human should look."),
    }),
  ),
});

const ANSWER_SYSTEM = `
You fill in a job application form on behalf of a candidate. You are given the
candidate's profile and resume, the job, and the questions the form asks.

Rules:
- Answer only from the candidate's material. If the material does not say, answer ""
  and set confident=false. Never guess at a fact about this person.
- Match the expected format: a number field gets a bare number, a yes/no gets "Yes" or "No",
  a dropdown gets text matching one of the listed options.
- Free-text "why do you want this role" answers: 2-4 sentences, specific to this job,
  grounded in the candidate's actual experience, no flattery, no clichés.
- Respect maxLength.
- Salary fields in India are in LPA (lakhs per annum) unless the form says otherwise.

${TRUTHFULNESS_RULE}
`.trim();

export interface FillPlanItem {
  field: FieldDescriptor;
  answer: string;
  source: "rule" | "model" | "skip";
  confident: boolean;
}

/** Decide what to put in every field, using rules first and the model for the rest. */
export async function planAnswers(
  fields: FieldDescriptor[],
  profile: Profile,
  resume: Resume,
  job: { title: string; company: string; description: string },
): Promise<FillPlanItem[]> {
  const plan: FillPlanItem[] = [];
  const unresolved: FieldDescriptor[] = [];

  for (const f of fields) {
    if (f.type === "file") continue; // handled separately (resume upload)
    const ruled = deterministicAnswer(f, profile, resume);
    if (ruled !== null && ruled !== "") {
      plan.push({ field: f, answer: ruled, source: "rule", confident: true });
    } else {
      unresolved.push(f);
    }
  }

  if (unresolved.length) {
    const payload = {
      candidate: {
        name: profile.fullName,
        location: profile.currentCity,
        totalExperienceYears: Number((profile.totalExperienceMonths / 12).toFixed(1)),
        currentTitle: profile.currentTitle,
        currentCompany: profile.currentCompany,
        currentCtcLpa: profile.currentCtcLpa,
        expectedCtcLpa: profile.expectedCtcLpa,
        noticePeriodDays: profile.noticePeriodDays,
      },
      resume: resumeToText(resume).slice(0, 12000),
      job: { title: job.title, company: job.company, description: job.description.slice(0, 8000) },
      questions: unresolved.map((f) => ({
        key: f.key,
        question: f.label || f.placeholder || f.name,
        inputType: f.type,
        required: f.required,
        maxLength: f.maxLength,
        options: f.options.map((o) => o.label),
      })),
    };

    try {
      const out = await structured({
        schema: AnswerSchema,
        system: ANSWER_SYSTEM,
        user: JSON.stringify(payload, null, 2),
        model: MODELS.main,
        effort: "medium",
        maxTokens: 8000,
        label: "form-answers",
      });
      const byKey = new Map((out?.answers ?? []).map((a) => [a.key, a]));
      for (const f of unresolved) {
        const a = byKey.get(f.key);
        plan.push({
          field: f,
          answer: a?.answer ?? "",
          source: a ? "model" : "skip",
          confident: a?.confident ?? false,
        });
      }
    } catch (err) {
      await logger.warn("formfill", "Model could not answer form questions; leaving them blank", {
        error: String(err),
      });
      for (const f of unresolved) plan.push({ field: f, answer: "", source: "skip", confident: false });
    }
  }

  return plan;
}

/** Apply the plan to the page. Returns what was actually entered. */
export async function fillForm(page: Page, plan: FillPlanItem[]): Promise<Record<string, string>> {
  const entered: Record<string, string> = {};

  for (const item of plan) {
    const { field, answer } = item;
    if (!answer) continue;
    const sel = `[${ATTR}="${field.key}"]`;

    try {
      if (field.type === "radio") {
        const value = bestOption(answer, field.options);
        if (!value) continue;
        await page.locator(`${sel}[value="${attrValue(value)}"]`).first().check({ timeout: 8000 });
      } else if (field.tag === "select") {
        const value = bestOption(answer, field.options);
        if (!value) continue;
        await page.locator(sel).first().selectOption(value, { timeout: 8000 });
      } else if (field.type === "checkbox") {
        const yes = /^(yes|true|1|agree|accept)/i.test(answer);
        if (yes) await page.locator(sel).first().check({ timeout: 8000 });
      } else {
        const el = page.locator(sel).first();
        const text = field.maxLength ? answer.slice(0, field.maxLength) : answer;
        await el.click({ timeout: 8000 });
        await el.fill("");
        await el.type(text, { delay: 15 + Math.random() * 35 });
      }
      entered[field.label || field.name || field.key] = answer;
      await jitter(120, 400);
    } catch (err) {
      await logger.debug("formfill", `Could not fill "${field.label || field.key}"`, { error: String(err) });
    }
  }

  return entered;
}

/** Attach the tailored resume to any file input that wants a resume. */
export async function uploadResume(page: Page, pdfPath: string): Promise<boolean> {
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const context = (
      (await input.getAttribute("name")) +
      " " +
      (await input.getAttribute("accept")) +
      " " +
      (await input.getAttribute("id"))
    ).toLowerCase();
    // Skip inputs clearly meant for something else (photo, cover letter, transcript).
    if (/photo|image|avatar|transcript|certificate/.test(context)) continue;
    try {
      await input.setInputFiles(pdfPath, { timeout: 15_000 });
      await jitter(600, 1500);
      return true;
    } catch {
      /* try the next one */
    }
  }
  return false;
}

const SUBMIT_PATTERNS = [
  /^submit( application)?$/i,
  /^apply( now)?$/i,
  /^send application$/i,
  /^finish$/i,
  /^submit & apply$/i,
];

/** Locate the real submit control without clicking "Save draft" or "Next". */
export async function findSubmitButton(page: Page) {
  const candidates = page.locator('button, input[type="submit"], [role="button"], a[class*="submit"]');
  const n = Math.min(await candidates.count().catch(() => 0), 60);
  for (let i = 0; i < n; i++) {
    const el = candidates.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    if (!(await el.isEnabled().catch(() => false))) continue;
    const label = ((await el.innerText().catch(() => "")) || (await el.getAttribute("value")) || "").trim();
    if (SUBMIT_PATTERNS.some((p) => p.test(label))) return el;
  }
  return null;
}
