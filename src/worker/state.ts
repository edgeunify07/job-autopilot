import { prisma } from "../lib/db";
import type { SearchPreference } from "@prisma/client";

export const SINGLETON = "singleton";

export async function getState() {
  return prisma.agentState.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON },
  });
}

export async function setState(data: Parameters<typeof prisma.agentState.update>[0]["data"]) {
  return prisma.agentState.upsert({
    where: { id: SINGLETON },
    update: data,
    create: { id: SINGLETON, ...(data as object) },
  });
}

export async function getPrefs(): Promise<SearchPreference> {
  return prisma.searchPreference.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

export async function getProfile() {
  return prisma.profile.findUnique({ where: { id: "me" } });
}

const today = () => new Date().toISOString().slice(0, 10);

/** Reset the per-day counter when the date rolls over. */
export async function rollCounters() {
  const state = await getState();
  if (state.countersDate !== today()) {
    await setState({ countersDate: today(), appliedToday: 0 });
    return { ...state, countersDate: today(), appliedToday: 0 };
  }
  return state;
}

export interface GateResult {
  allowed: boolean;
  reason: string;
  /** How long to wait before this gate could pass, in ms. */
  retryAfterMs: number;
}

/**
 * Every rate limit in one place. These exist so the agent behaves like an
 * enthusiastic person rather than a bot: that is what keeps the account alive.
 */
export async function checkGates(portal: string, prefs: SearchPreference): Promise<GateResult> {
  const state = await rollCounters();

  if (state.needsHumanJobId) {
    return {
      allowed: false,
      reason: `Paused: ${state.needsHumanReason || "needs your attention"}`,
      retryAfterMs: 60_000,
    };
  }

  const hour = new Date().getHours();
  const { activeHoursStart: start, activeHoursEnd: end } = prefs;
  const withinHours = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  if (!withinHours) {
    return {
      allowed: false,
      reason: `Outside your active hours (${start}:00–${end}:00)`,
      retryAfterMs: 15 * 60_000,
    };
  }

  if (state.appliedToday >= prefs.dailyApplicationCap) {
    return {
      allowed: false,
      reason: `Daily cap reached (${prefs.dailyApplicationCap})`,
      retryAfterMs: 30 * 60_000,
    };
  }

  const hourAgo = new Date(Date.now() - 3_600_000);
  const thisHour = await prisma.application.count({
    where: { createdAt: { gte: hourAgo }, job: { portal } },
  });
  if (thisHour >= prefs.perPortalHourlyCap) {
    return {
      allowed: false,
      reason: `Hourly cap reached for ${portal} (${prefs.perPortalHourlyCap})`,
      retryAfterMs: 10 * 60_000,
    };
  }

  const last = await prisma.application.findFirst({ orderBy: { createdAt: "desc" } });
  if (last) {
    const since = Date.now() - last.createdAt.getTime();
    const need = prefs.minSecondsBetweenApps * 1000;
    if (since < need) {
      return { allowed: false, reason: "Spacing out applications", retryAfterMs: need - since };
    }
  }

  return { allowed: true, reason: "", retryAfterMs: 0 };
}

export async function requestHuman(jobId: string, reason: string) {
  await setState({ needsHumanJobId: jobId, needsHumanReason: reason });
}

export async function clearHuman() {
  await setState({ needsHumanJobId: "", needsHumanReason: "" });
}
