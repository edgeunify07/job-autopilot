#!/usr/bin/env node
/* First-run helper: makes .env, the data directory and the database. */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env");

if (!fs.existsSync(envPath)) {
  const template = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const withSecret = template.replace(
    "APP_SECRET=change-me-to-something-long-and-random",
    `APP_SECRET=${crypto.randomBytes(32).toString("hex")}`,
  );
  fs.writeFileSync(envPath, withSecret);
  console.log("Created .env with a generated APP_SECRET.");
} else {
  console.log(".env already exists — leaving it alone.");
}

for (const dir of ["data", "data/resumes", "data/resumes/variants", "data/browser-profiles", "data/screenshots", "data/exports", "data/logs"]) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
}

console.log("Setting up the database…");
execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
execSync("npx prisma generate", { stdio: "inherit" });

console.log("Downloading Chromium for Playwright (once, ~150 MB)…");
try {
  execSync("npx playwright install chromium", { stdio: "inherit" });
} catch {
  console.log("Could not install Chromium automatically. Run: npx playwright install chromium");
}

const env = fs.readFileSync(envPath, "utf8");
if (env.includes("ANTHROPIC_API_KEY=sk-ant-...")) {
  console.log("\nOne thing left: put your Anthropic API key in .env, then run `npm run dev:all`.");
} else {
  console.log("\nReady. Run `npm run dev:all` and open http://localhost:3000");
}
