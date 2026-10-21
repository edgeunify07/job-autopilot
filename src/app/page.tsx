import Link from "next/link";
import { prisma, j } from "@/lib/db";
import { Stat, StatusPill, ScoreBadge, Empty } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { LiveLog } from "@/components/LiveLog";
import { setRunningAction, runOnceAction, clearBlockAction, exportAction } from "./actions";
import { aiConfigured } from "@/lib/ai";

export const dynamic = "force-dynamic";

function heartbeatAge(last: Date | null): { label: string; alive: boolean } {
  if (!last) return { label: "never", alive: false };
  const secs = Math.round((Date.now() - last.getTime()) / 1000);
  if (secs < 60) return { label: `${secs}s ago`, alive: true };
  if (secs < 3600) return { label: `${Math.round(secs / 60)}m ago`, alive: secs < 180 };
  return { label: `${Math.round(secs / 3600)}h ago`, alive: false };
}

export default async function Dashboard() {
  const [state, prefs, profile] = await Promise.all([
    prisma.agentState.findUnique({ where: { id: "singleton" } }),
    prisma.searchPreference.findUnique({ where: { id: "default" } }),
    prisma.profile.findUnique({ where: { id: "me" } }),
  ]);

  const configured = Boolean(profile?.resumeJson && profile.fullName && profile.email && profile.phone);
  const hasTitles = prefs ? j<string[]>(prefs.titles, []).length > 0 : false;
  const ready = configured && hasTitles;

  const [submitted, prepared, needsHuman, queued, totalSeen, recent] = await Promise.all([
    prisma.application.count({ where: { status: "submitted" } }),
    prisma.application.count({ where: { status: "prepared" } }),
    prisma.application.count({ where: { status: "needs_human" } }),
    prisma.job.count({ where: { status: "queued" } }),
    prisma.job.count(),
    prisma.application.findMany({
      include: { job: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const beat = heartbeatAge(state?.lastHeartbeat ?? null);
  const running = state?.running ?? false;

  return (
    <div className="space-y-6">
      {!aiConfigured() ? (
        <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          <strong>ANTHROPIC_API_KEY is not set.</strong> Copy <code>.env.example</code> to <code>.env</code> and add your
          key, then restart. Nothing will run without it.
        </div>
      ) : null}

      {!ready ? (
        <div className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          Setup is not finished.{" "}
          <Link href="/setup" className="underline">
            Upload your resume and fill in the basics
          </Link>{" "}
          — it takes about two minutes, then the agent runs on its own.
        </div>
      ) : null}

      {state?.needsHumanJobId ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <p className="font-medium text-warn">The agent is paused and needs you.</p>
          <p className="mt-1 text-slate-300">{state.needsHumanReason}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/jobs?focus=${state.needsHumanJobId}`} className="btn-ghost">
              Open the job
            </Link>
            <ActionButton action={clearBlockAction} className="btn-primary">
              I&apos;ve handled it — carry on
            </ActionButton>
          </div>
        </div>
      ) : null}

      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${running && beat.alive ? "bg-good animate-pulse" : running ? "bg-warn" : "bg-slate-600"}`} />
            <h1 className="text-lg font-semibold text-white">
              {running ? (beat.alive ? "Autopilot running" : "Switched on, but no worker is connected") : "Autopilot stopped"}
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {state?.phase && state.phase !== "idle" ? `Currently: ${state.phase}. ` : ""}
            Worker heartbeat {beat.label}.
            {running && !beat.alive ? " Start it with `npm run worker`." : ""}
          </p>
          {state?.lastError ? <p className="mt-1 text-sm text-bad">Last error: {state.lastError}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {running ? (
            <ActionButton action={setRunningAction.bind(null, false)} className="btn-danger">
              Stop
            </ActionButton>
          ) : (
            <ActionButton action={setRunningAction.bind(null, true)} className="btn-primary">
              Start autopilot
            </ActionButton>
          )}
          <ActionButton action={runOnceAction} className="btn-ghost" pendingLabel="Running a pass…">
            Run one pass now
          </ActionButton>
          <ActionButton action={exportAction} className="btn-ghost">
            Export spreadsheet
          </ActionButton>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Submitted" value={submitted} tone="good" />
        <Stat label="Awaiting your click" value={prepared} tone={prepared ? "warn" : "default"} />
        <Stat label="Needs you" value={needsHuman} tone={needsHuman ? "bad" : "default"} />
        <Stat label="In queue" value={queued} />
        <Stat label="Applied today" value={`${state?.appliedToday ?? 0} / ${prefs?.dailyApplicationCap ?? 25}`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Recent applications</h2>
            <Link href="/applications" className="text-xs text-accent hover:underline">
              See all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <Empty
              title="No applications yet"
              hint={
                ready
                  ? `${totalSeen} jobs seen so far. Start the autopilot, or run a single pass to see it work.`
                  : "Finish setup and the agent will start finding work for you."
              }
            />
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 pb-2 font-medium">Role</th>
                    <th className="px-2 pb-2 font-medium">Source</th>
                    <th className="px-2 pb-2 font-medium">Match</th>
                    <th className="px-2 pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((app) => (
                    <tr key={app.id} className="border-t border-ink-line/60">
                      <td className="px-2 py-2.5">
                        <a href={app.job.url} target="_blank" rel="noreferrer" className="text-slate-200 hover:text-accent">
                          {app.job.title}
                        </a>
                        <div className="text-xs text-slate-500">{app.job.company}</div>
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-500">{app.job.portal}</td>
                      <td className="px-2 py-2.5">
                        <ScoreBadge score={app.job.matchScore} />
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusPill status={app.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <LiveLog />
      </div>
    </div>
  );
}
