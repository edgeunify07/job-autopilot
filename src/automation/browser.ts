import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { paths, ensureDirs, safeSlug } from "../lib/paths";

const USER_AGENT =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-dev-shm-usage",
];

export const headless = () => process.env.HEADLESS !== "false";

/**
 * Point at an existing Chromium/Chrome instead of Playwright's own download.
 * Useful on a machine that already has one, or in a container that ships it.
 */
const executablePath = () => process.env.CHROMIUM_PATH || undefined;

let _browser: Browser | null = null;
let _renderContext: BrowserContext | null = null;
const _contexts = new Map<string, BrowserContext>();

/**
 * Scripts that must run in every page before any of our own code does.
 *
 * These are passed as strings on purpose. A function argument would be compiled
 * by esbuild (which `tsx` uses to run the worker), and esbuild rewrites named
 * functions into `__name(fn, "fn")` calls referencing a module-scope helper that
 * does not exist inside the browser — so a compiled init script throws
 * "__name is not defined" at runtime. The same rewrite happens inside every
 * page.evaluate body, which is why the first shim below has to exist at all.
 */
const INIT_SCRIPTS = [
  // Give the page a no-op __name so esbuild-compiled evaluate bodies run.
  "globalThis.__name = globalThis.__name || function (fn) { return fn; };",
  // Remove the most obvious automation tell. This is about not being blocked
  // while doing your own job search; it is not a general anti-detection suite.
  'Object.defineProperty(navigator, "webdriver", { get: function () { return undefined; } });',
];

async function applyInitScripts(ctx: BrowserContext) {
  for (const content of INIT_SCRIPTS) await ctx.addInitScript({ content });
}

/** Plain browser, used for rendering resume PDFs. */
export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS, executablePath: executablePath() });
  return _browser;
}

/**
 * One persistent profile per portal. Cookies and localStorage survive restarts,
 * so you log in to Naukri once by hand and the agent reuses that session —
 * no stored password, no repeated login attempts tripping bot detection.
 */
export async function getPortalContext(portal: string): Promise<BrowserContext> {
  const existing = _contexts.get(portal);
  if (existing) return existing;

  ensureDirs();
  const profileDir = path.join(paths.profiles, safeSlug(portal));

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: headless(),
    args: LAUNCH_ARGS,
    executablePath: executablePath(),
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 860 },
    locale: "en-IN",
    timezoneId: process.env.TZ_NAME || "Asia/Kolkata",
    geolocation: { latitude: 19.076, longitude: 72.8777 }, // Mumbai; only used if a site asks
    permissions: [],
    acceptDownloads: true,
  });

  await applyInitScripts(ctx);

  ctx.setDefaultTimeout(30_000);
  ctx.setDefaultNavigationTimeout(45_000);
  _contexts.set(portal, ctx);
  return ctx;
}

/** A clean context with the same shims, used for rendering and for tests. */
export async function getRenderContext(): Promise<BrowserContext> {
  if (_renderContext) return _renderContext;
  const browser = await getBrowser();
  _renderContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await applyInitScripts(_renderContext);
  return _renderContext;
}

export async function closePortalContext(portal: string) {
  const ctx = _contexts.get(portal);
  if (ctx) {
    await ctx.close().catch(() => {});
    _contexts.delete(portal);
  }
}

export async function closeAll() {
  for (const portal of [..._contexts.keys()]) await closePortalContext(portal);
  if (_renderContext) {
    await _renderContext.close().catch(() => {});
    _renderContext = null;
  }
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

/** Jittered pause. Never hammer a portal at machine speed. */
export function jitter(minMs: number, maxMs = minMs * 1.8) {
  return new Promise((r) => setTimeout(r, Math.floor(minMs + Math.random() * (maxMs - minMs))));
}

/** Type like a person rather than pasting a whole string at once. */
export async function humanType(page: Page, selector: string, value: string) {
  const el = page.locator(selector).first();
  await el.click({ timeout: 10_000 });
  await el.fill("");
  await el.type(value, { delay: 40 + Math.random() * 60 });
}

export async function screenshot(page: Page, label: string): Promise<string> {
  ensureDirs();
  const file = path.join(paths.screenshots, `${safeSlug(label)}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

/** Heuristic: are we looking at a captcha / OTP / "verify you're human" wall? */
export async function detectHumanWall(page: Page): Promise<string | null> {
  const html = (await page.content().catch(() => "")).toLowerCase();
  const tells: Array<[RegExp, string]> = [
    [/recaptcha|g-recaptcha|hcaptcha|cf-turnstile/, "captcha"],
    [/enter (the )?otp|one[- ]time password|verification code/, "otp"],
    [/verify (you are|you're) (a )?human|are you a robot/, "bot-check"],
    [/unusual (activity|traffic) (detected|from)/, "rate-limited"],
    [/your account has been (temporarily )?(locked|suspended)/, "account-locked"],
  ];
  for (const [re, reason] of tells) if (re.test(html)) return reason;
  return null;
}
