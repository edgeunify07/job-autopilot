import { prisma } from "@/lib/db";
import { StatusPill, ScoreBadge, Empty } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { exportAction, markSubmittedAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const applications = await prisma.application.findMany({
    include: { job: { include: { resumeVariant: true } } },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    take: 300,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Applications</h1>
          <p className="mt-1 text-sm text-slate-500">
            {applications.length} total. The spreadsheet is regenerated from this table.
          </p>
        </div>
        <ActionButton action={exportAction} className="btn-primary">
          Export to spreadsheet
        </ActionButton>
      </div>

      {applications.length === 0 ? (
        <Empty title="No applications yet" hint="They will show up here the moment the agent sends the first one." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 pb-3 font-medium">When</th>
                <th className="px-2 pb-3 font-medium">Role</th>
                <th className="px-2 pb-3 font-medium">Source</th>
                <th className="px-2 pb-3 font-medium">Match</th>
                <th className="px-2 pb-3 font-medium">Status</th>
                <th className="px-2 pb-3 font-medium">Notes</th>
                <th className="px-2 pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id} className="border-t border-ink-line/60 align-top">
                  <td className="px-2 py-3 text-xs text-slate-500">
                    {(app.submittedAt ?? app.createdAt).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-2 py-3">
                    <a href={app.job.url} target="_blank" rel="noreferrer" className="text-slate-200 hover:text-accent">
                      {app.job.title}
                    </a>
                    <div className="text-xs text-slate-500">
                      {app.job.company}
                      {app.job.location ? ` · ${app.job.location}` : ""}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-xs text-slate-500">{app.job.portal}</td>
                  <td className="px-2 py-3">
                    <ScoreBadge score={app.job.matchScore} />
                  </td>
                  <td className="px-2 py-3">
                    <StatusPill status={app.status} />
                    <div className="mt-1 text-[11px] text-slate-600">by {app.submittedBy}</div>
                  </td>
                  <td className="max-w-xs px-2 py-3 text-xs text-slate-500">
                    {app.error || app.confirmation || "—"}
                  </td>
                  <td className="px-2 py-3">
                    {app.status !== "submitted" ? (
                      <ActionButton
                        action={markSubmittedAction.bind(null, app.jobId)}
                        className="btn-ghost text-xs"
                        confirm="Mark this as submitted? Only do this if you actually sent it."
                      >
                        Mark submitted
                      </ActionButton>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
