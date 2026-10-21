import { prisma, j } from "@/lib/db";
import { Field, Toggle } from "@/components/ui";
import { ActionForm } from "@/components/FormShell";
import { PortalLogin } from "@/components/PortalLogin";
import { savePreferencesAction, saveBoardsAction } from "../actions";
import { connectorSummaries } from "@/connectors";
import { loadBoards } from "@/connectors/boards";
import { MODELS, baseURL } from "@/lib/ai";
import { paths } from "@/lib/paths";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const prefs = await prisma.searchPreference.findUnique({ where: { id: "default" } });
  const accounts = await prisma.portalAccount.findMany();
  const boards = loadBoards();
  const connectors = connectorSummaries();
  const enabled = prefs ? j<string[]>(prefs.enabledPortals, []) : [];
  const accountFor = (id: string) => accounts.find((a) => a.portal === id);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-white">Settings</h1>

      <section className="card">
        <h2 className="mb-1 text-base font-semibold text-white">Pace and limits</h2>
        <p className="mb-4 text-sm text-slate-500">
          These are what keep your accounts healthy. Raising them raises your odds of a block, not your odds of a job.
        </p>
        <ActionForm action={savePreferencesAction} submitLabel="Save limits">
          {/* Carry the search fields through so saving here does not wipe them. */}
          <input type="hidden" name="titles" value={j<string[]>(prefs?.titles ?? "", []).join(", ")} />
          <input type="hidden" name="locations" value={j<string[]>(prefs?.locations ?? "", []).join(", ")} />
          <input type="hidden" name="mustHaveKeywords" value={j<string[]>(prefs?.mustHaveKeywords ?? "", []).join(", ")} />
          <input type="hidden" name="excludeKeywords" value={j<string[]>(prefs?.excludeKeywords ?? "", []).join(", ")} />
          <input type="hidden" name="minExperienceYears" value={prefs?.minExperienceYears ?? 0} />
          <input type="hidden" name="maxExperienceYears" value={prefs?.maxExperienceYears ?? 50} />
          {enabled.map((p) => (
            <input key={p} type="hidden" name="portals" value={p} />
          ))}
          {prefs?.remoteOnly ? <input type="hidden" name="remoteOnly" value="true" /> : null}
          {prefs?.indiaOnly ? <input type="hidden" name="indiaOnly" value="true" /> : null}
          {prefs?.allowUnscopedRemote ? <input type="hidden" name="allowUnscopedRemote" value="true" /> : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Minimum match score"
              name="minMatchScore"
              type="number"
              defaultValue={prefs?.minMatchScore ?? 65}
              hint="0-100. Below this, no application is sent."
            />
            <Field
              label="Applications per day"
              name="dailyApplicationCap"
              type="number"
              defaultValue={prefs?.dailyApplicationCap ?? 25}
              hint="25 is already a lot for one person."
            />
            <Field
              label="Per portal, per hour"
              name="perPortalHourlyCap"
              type="number"
              defaultValue={prefs?.perPortalHourlyCap ?? 6}
            />
            <Field
              label="Seconds between applications"
              name="minSecondsBetweenApps"
              type="number"
              defaultValue={prefs?.minSecondsBetweenApps ?? 90}
            />
            <Field
              label="Active from (hour)"
              name="activeHoursStart"
              type="number"
              defaultValue={prefs?.activeHoursStart ?? 8}
              hint="24h clock, local time"
            />
            <Field label="Active until (hour)" name="activeHoursEnd" type="number" defaultValue={prefs?.activeHoursEnd ?? 23} />
            <Field
              label="Search every (minutes)"
              name="searchIntervalMinutes"
              type="number"
              defaultValue={prefs?.searchIntervalMinutes ?? 45}
            />
            <Field label="Minimum salary (LPA)" name="minSalaryLpa" type="number" step="0.5" defaultValue={prefs?.minSalaryLpa} />
          </div>

          <Toggle
            label="Submit applications automatically"
            name="autoSubmit"
            defaultChecked={prefs?.autoSubmit}
            hint="Off is the safer default: everything is filled in and left for your final click."
          />
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="mb-1 text-base font-semibold text-white">Portal sign-ins</h2>
        <p className="mb-4 text-sm text-slate-500">
          No passwords are stored. Each portal gets its own browser profile — sign in once in the window that opens and
          the session is reused from then on.
        </p>
        <div className="space-y-2">
          {connectors
            .filter((c) => c.requiresLogin)
            .map((c) => (
              <PortalLogin
                key={c.id}
                id={c.id}
                label={c.label}
                loginUrl={c.loginUrl}
                tosNote={c.tosNote}
                status={accountFor(c.id)?.status ?? "unknown"}
                enabled={enabled.includes(c.id)}
              />
            ))}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-1 text-base font-semibold text-white">Company job boards</h2>
        <p className="mb-4 text-sm text-slate-500">
          These are the public ATS boards the agent reads. Find a token in a company&apos;s careers URL — the last path
          segment of <code className="text-slate-400">boards.greenhouse.io/&lt;token&gt;</code>,{" "}
          <code className="text-slate-400">jobs.lever.co/&lt;token&gt;</code> or{" "}
          <code className="text-slate-400">jobs.ashbyhq.com/&lt;token&gt;</code>. Adding the companies you actually want
          to work at is the highest-value thing you can do here.
        </p>
        <ActionForm action={saveBoardsAction} submitLabel="Save boards">
          <div className="grid gap-4 lg:grid-cols-3">
            {(["greenhouse", "lever", "ashby"] as const).map((key) => (
              <div key={key}>
                <label className="label" htmlFor={key}>
                  {key}
                </label>
                <textarea
                  id={key}
                  name={key}
                  rows={8}
                  defaultValue={boards[key].join("\n")}
                  className="input font-mono text-xs"
                  placeholder="one token per line"
                />
              </div>
            ))}
          </div>
        </ActionForm>
      </section>

      <section className="card text-sm">
        <h2 className="mb-3 text-base font-semibold text-white">Under the hood</h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[180px_1fr]">
          <dt className="text-slate-500">Tailoring &amp; answers</dt>
          <dd className="font-mono text-xs text-slate-300">{MODELS.main}</dd>
          <dt className="text-slate-500">Job scoring</dt>
          <dd className="font-mono text-xs text-slate-300">{MODELS.bulk}</dd>
          <dt className="text-slate-500">API endpoint</dt>
          <dd className="font-mono text-xs text-slate-300">
            {baseURL() ? (
              <>
                {baseURL()}
                <span className="ml-2 font-sans text-warn">
                  third-party gateway — your resume and details pass through it
                </span>
              </>
            ) : (
              "api.anthropic.com (direct)"
            )}
          </dd>
          <dt className="text-slate-500">Data directory</dt>
          <dd className="font-mono text-xs text-slate-300">{paths.root}</dd>
          <dt className="text-slate-500">Spreadsheets</dt>
          <dd className="font-mono text-xs text-slate-300">{paths.exports}</dd>
          <dt className="text-slate-500">Browser profiles</dt>
          <dd className="font-mono text-xs text-slate-300">{paths.profiles}</dd>
        </dl>
      </section>
    </div>
  );
}
