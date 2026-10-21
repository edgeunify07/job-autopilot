import { prisma } from "./db";

type Level = "debug" | "info" | "warn" | "error";

const COLORS: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

/**
 * Logs go to stdout and to the RunLog table so the dashboard can show a live feed.
 * A failure to write the log must never take down the caller.
 */
export async function log(level: Level, scope: string, message: string, data?: unknown) {
  const line = `${COLORS[level]}[${level}]\x1b[0m ${scope ? `(${scope}) ` : ""}${message}`;
  // eslint-disable-next-line no-console
  console.log(line, data === undefined ? "" : data);
  try {
    await prisma.runLog.create({
      data: { level, scope, message, data: data === undefined ? "" : JSON.stringify(data).slice(0, 8000) },
    });
  } catch {
    /* logging must not throw */
  }
}

export const logger = {
  debug: (scope: string, m: string, d?: unknown) => log("debug", scope, m, d),
  info: (scope: string, m: string, d?: unknown) => log("info", scope, m, d),
  warn: (scope: string, m: string, d?: unknown) => log("warn", scope, m, d),
  error: (scope: string, m: string, d?: unknown) => log("error", scope, m, d),
};

/** Keep the log table from growing without bound. */
export async function pruneLogs(keep = 5000) {
  const total = await prisma.runLog.count();
  if (total <= keep) return;
  const cutoff = await prisma.runLog.findMany({
    orderBy: { createdAt: "desc" },
    skip: keep,
    take: 1,
    select: { createdAt: true },
  });
  if (cutoff[0]) await prisma.runLog.deleteMany({ where: { createdAt: { lt: cutoff[0].createdAt } } });
}
