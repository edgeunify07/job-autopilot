import "dotenv/config";
import { prisma } from "../lib/db";
import { logger, pruneLogs } from "../lib/logger";
import { ensureDirs } from "../lib/paths";
import { aiConfigured } from "../lib/ai";
import { closeAll } from "../automation/browser";
import { getPrefs, getState, setState } from "./state";
import { tick } from "./pipeline";

const SCOPE = "worker";
const HEARTBEAT_MS = 20_000;

let stopping = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function heartbeat() {
  while (!stopping) {
    await setState({ lastHeartbeat: new Date() }).catch(() => {});
    await sleep(HEARTBEAT_MS);
  }
}

async function main() {
  ensureDirs();

  if (!aiConfigured()) {
    await logger.error(SCOPE, "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add it.");
    process.exit(1);
  }

  await logger.info(SCOPE, "Autopilot worker started. It runs until you stop it.");
  void heartbeat();

  while (!stopping) {
    const state = await getState();
    const prefs = await getPrefs();

    if (!state.running) {
      await setState({ phase: "stopped" });
      await sleep(10_000);
      continue;
    }

    if (state.needsHumanJobId) {
      await setState({ phase: "waiting for you" });
      await sleep(30_000);
      continue;
    }

    try {
      const result = await tick();
      await logger.info(
        SCOPE,
        `Pass complete — ${result.discovered} found, ${result.scored} scored, ${result.applied} applied` +
          (result.blocked ? ` (paused: ${result.blocked})` : ""),
      );
      await setState({ lastError: "" });
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      await logger.error(SCOPE, "Pass failed", { error: message });
      await setState({ lastError: message.slice(0, 500), phase: "error" });
      // Back off after a hard failure rather than spinning.
      await sleep(120_000);
      continue;
    }

    await pruneLogs().catch(() => {});

    const waitMs = Math.max(5, prefs.searchIntervalMinutes) * 60_000;
    await logger.debug(SCOPE, `Sleeping ${prefs.searchIntervalMinutes} min until the next pass`);
    // Wake early if someone stops the agent from the dashboard.
    const until = Date.now() + waitMs;
    while (Date.now() < until && !stopping) {
      await sleep(5_000);
      const s = await getState();
      if (!s.running) break;
    }
  }

  await shutdown("loop exited");
}

async function shutdown(why: string) {
  if (stopping) return;
  stopping = true;
  await logger.info(SCOPE, `Shutting down (${why})`).catch(() => {});
  await setState({ phase: "stopped", running: false }).catch(() => {});
  await closeAll().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => {
  void logger.error(SCOPE, "Unhandled rejection", { error: String(err) });
});

void main();
