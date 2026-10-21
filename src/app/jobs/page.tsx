import Link from "next/link";
import { prisma } from "@/lib/db";
import { StatusPill, ScoreBadge, Empty } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { retryJobAction, skipJobAction } from "../actions";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "queued", label: "Queued" },
  { key: "needs_human", label: "Needs you" },
  { key: "applied", label: "Applied" },
  { key: "failed", label: "Failed" },
  { key: "rejected", label: "Not a match" },
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; focus?: string }>;
}) {
  const { status = "all", focus } = await searchParams;

  const jobs = await prisma.job.findMany({
    where: status === "all" ? {} : { status },
    orderBy: [{ matchScore: "desc" }, { discoveredAt: "desc" }],
    take: 200,
    include: { application: true, resumeVariant: true },
  });

  const counts = await prisma.job.groupBy({ by: ["status"], _count: true });
  const countFor = (key: string) =>
    key === "all"
      ? counts.reduce((a, c) => a + c._count, 0)
      : (counts.find((c) => c.status === key)?._count ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-white">Jobs</h1>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/jobs?status=${f.key}`}
              className={`rounded-lg px-3 py-1.5 text-xs transition ${
                status === f.key ? "bg-accent text-white" : "text-slate-400 hover:bg-ink-soft hover:text-white"
              }`}
            >
              {f.label} <span className="opacity-60">{countFor(f.key)}</span>
            </Link>
          ))}
        </div>
      </div>

      {jobs.length === 0 ? (
        <Empty
          title="Nothing here yet"
          hint="Run a pass from the dashboard, or start the autopilot and give it a few minutes."
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const highlighted = focus === job.id;
            const unsupported = job.resumeVariant?.unsupported
              ? (JSON.parse(job.resumeVariant.unsupported) as string[])
              : [];
            return (
              <article
                key={job.id}
                className={`card ${highlighted ? "ring-2 ring-warn" : ""}`}
                id={job.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-slate-100 hover:text-accent"
                    >
                      {job.title}
                    </a>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[job.company, job.location, job.experienceText, job.salaryText].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <ScoreBadge score={job.matchScore} />
                    <StatusPill status={job.status} />
                    <span className="text-[11px] uppercase tracking-wide text-slate-600">{job.portal}</span>
                  </div>
                </div>

                {job.matchReason ? <p className="mt-2 text-xs text-slate-400">{job.matchReason}</p> : null}
                {job.skipReason ? <p className="mt-2 text-xs text-slate-500">Skipped: {job.skipReason}</p> : null}
                {job.application?.error ? (
                  <p className="mt-2 text-xs text-warn">{job.application.error}</p>
                ) : null}
                {unsupported.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-warn">
                      {unsupported.length} thing(s) this job wanted that your resume does not support
                    </summary>
                    <ul className="mt-1 list-disc pl-5 text-xs text-slate-500">
                      {unsupported.map((u, i) => (
                        <li key={i}>{u}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {job.status !== "queued" && job.status !== "applied" ? (
                    <ActionButton action={retryJobAction.bind(null, job.id)} className="btn-ghost">
                      Queue it
                    </ActionButton>
                  ) : null}
                  {job.status !== "skipped" && job.status !== "applied" ? (
                    <ActionButton action={skipJobAction.bind(null, job.id)} className="btn-ghost">
                      Skip
                    </ActionButton>
                  ) : null}
                  <a href={job.url} target="_blank" rel="noreferrer" className="btn-ghost">
                    Open posting
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
