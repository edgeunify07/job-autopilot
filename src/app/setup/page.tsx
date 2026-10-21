import Link from "next/link";
import { prisma, j } from "@/lib/db";
import { Field, Toggle } from "@/components/ui";
import { ActionForm } from "@/components/FormShell";
import { uploadResumeAction, saveProfileAction, savePreferencesAction } from "../actions";
import { connectorSummaries } from "@/connectors";
import { EMPTY_RESUME, type Resume } from "@/lib/resume/schema";

export const dynamic = "force-dynamic";

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="mb-4 flex items-center gap-3">
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${
            done ? "bg-good/20 text-good" : "bg-ink text-slate-400 ring-1 ring-ink-line"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <h2 className="text-base font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default async function SetupPage() {
  const [profile, prefs] = await Promise.all([
    prisma.profile.findUnique({ where: { id: "me" } }),
    prisma.searchPreference.findUnique({ where: { id: "default" } }),
  ]);

  const resume = j<Resume>(profile?.resumeJson ?? "", EMPTY_RESUME);
  const hasResume = Boolean(profile?.resumeJson);
  const profileDone = Boolean(profile?.fullName && profile.email && profile.phone && profile.currentCity);
  const prefsDone = prefs ? j<string[]>(prefs.titles, []).length > 0 : false;
  const enabled = prefs ? j<string[]>(prefs.enabledPortals, []) : ["greenhouse", "lever", "ashby"];
  const connectors = connectorSummaries();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Setup</h1>
        <p className="mt-1 text-sm text-slate-500">
          Three steps. After this the agent runs on its own — you only come back when it needs a human.
        </p>
      </div>

      <Step n={1} title="Upload your resume" done={hasResume}>
        <ActionForm action={uploadResumeAction} submitLabel="Upload and read it" encType="multipart/form-data">
          <p className="text-sm text-slate-400">
            PDF, DOCX or plain text. It gets read into structured data so each application can be tailored — and so the
            agent can fill in forms without asking you the same questions forty times.
          </p>
          <input
            type="file"
            name="resume"
            accept=".pdf,.docx,.doc,.txt,.md"
            required
            className="block w-full rounded-lg border border-dashed border-ink-line bg-ink px-3 py-6 text-sm text-slate-400
                       file:mr-4 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm
                       file:font-medium file:text-white hover:border-slate-600"
          />
        </ActionForm>

        {hasResume ? (
          <div className="mt-4 rounded-lg border border-ink-line bg-ink p-4 text-sm">
            <p className="font-medium text-slate-200">{profile?.resumeFileName}</p>
            <p className="mt-1 text-slate-500">
              {resume.experience.length} roles · {resume.education.length} qualifications ·{" "}
              {resume.skills.flatMap((g) => g.items).length} skills · {resume.projects.length} projects
            </p>
            {resume.experience.length ? (
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {resume.experience.slice(0, 4).map((e, i) => (
                  <li key={i}>
                    <span className="text-slate-300">{e.title}</span> at {e.company} ({e.startDate} – {e.endDate})
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-xs text-slate-600">
              Anything wrong here will end up on applications. Re-upload a corrected file if it misread something.
            </p>
          </div>
        ) : null}
      </Step>

      <Step n={2} title="Your details" done={profileDone}>
        <ActionForm action={saveProfileAction} submitLabel="Save details">
          <p className="text-sm text-slate-400">
            Pre-filled from your resume where possible. These are the answers portals ask for over and over.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" name="fullName" defaultValue={profile?.fullName} required />
            <Field label="Email" name="email" type="email" defaultValue={profile?.email} required />
            <Field label="Phone" name="phone" type="tel" defaultValue={profile?.phone} required placeholder="+91 98765 43210" />
            <Field label="Current city" name="currentCity" defaultValue={profile?.currentCity} placeholder="Bengaluru" />
            <Field
              label="Preferred locations"
              name="preferredLocations"
              defaultValue={j<string[]>(profile?.preferredLocations ?? "", []).join(", ")}
              placeholder="Bengaluru, Pune, Remote"
              hint="Comma separated"
            />
            <Field label="Current title" name="currentTitle" defaultValue={profile?.currentTitle} />
            <Field label="Current company" name="currentCompany" defaultValue={profile?.currentCompany} />
            <Field
              label="Total experience (years)"
              name="totalExperienceYears"
              type="number"
              step="0.5"
              defaultValue={profile ? (profile.totalExperienceMonths / 12).toFixed(1) : ""}
            />
            <Field label="Current CTC (LPA)" name="currentCtcLpa" type="number" step="0.1" defaultValue={profile?.currentCtcLpa} />
            <Field label="Expected CTC (LPA)" name="expectedCtcLpa" type="number" step="0.1" defaultValue={profile?.expectedCtcLpa} />
            <Field label="Notice period (days)" name="noticePeriodDays" type="number" defaultValue={profile?.noticePeriodDays ?? 30} />
            <Field label="Highest qualification" name="highestQualification" defaultValue={profile?.highestQualification} placeholder="B.Tech" />
            <Field label="Specialization" name="specialization" defaultValue={profile?.specialization} placeholder="Computer Science" />
            <Field label="Institute" name="institute" defaultValue={profile?.institute} />
            <Field label="Graduation year" name="graduationYear" type="number" defaultValue={profile?.graduationYear} />
            <Field label="LinkedIn" name="linkedinUrl" defaultValue={profile?.linkedinUrl} />
            <Field label="GitHub" name="githubUrl" defaultValue={profile?.githubUrl} />
            <Field label="Portfolio" name="portfolioUrl" defaultValue={profile?.portfolioUrl} />
          </div>

          <details className="rounded-lg border border-ink-line bg-ink p-4">
            <summary className="cursor-pointer text-sm text-slate-300">Optional details some forms ask for</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Gender" name="gender" defaultValue={profile?.gender} hint="Leave blank to skip" />
              <Field label="Date of birth" name="dateOfBirth" defaultValue={profile?.dateOfBirth} placeholder="1998-04-21" />
              <Field label="Nationality" name="nationality" defaultValue={profile?.nationality ?? "Indian"} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Toggle label="Willing to relocate" name="willingToRelocate" defaultChecked={profile?.willingToRelocate ?? true} />
              <Toggle label="Currently serving notice" name="servingNotice" defaultChecked={profile?.servingNotice} />
              <Toggle label="I need visa sponsorship" name="needsVisaSponsorship" defaultChecked={profile?.needsVisaSponsorship} />
              <Toggle label="I'm a person with a disability" name="differentlyAbled" defaultChecked={profile?.differentlyAbled} />
            </div>
          </details>

          <div>
            <label className="label" htmlFor="summary">
              Profile summary
            </label>
            <textarea id="summary" name="summary" rows={3} defaultValue={profile?.summary ?? ""} className="input" />
          </div>
        </ActionForm>
      </Step>

      <Step n={3} title="What to look for" done={prefsDone}>
        <ActionForm action={savePreferencesAction} submitLabel="Save and finish">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Job titles to search"
              name="titles"
              defaultValue={j<string[]>(prefs?.titles ?? "", []).join(", ")}
              placeholder="Backend Engineer, Python Developer"
              hint="Comma separated. These are the actual search queries."
              required
            />
            <Field
              label="Locations"
              name="locations"
              defaultValue={j<string[]>(prefs?.locations ?? "", []).join(", ")}
              placeholder="Bengaluru, Hyderabad, Remote"
            />
            <Field
              label="Must mention one of"
              name="mustHaveKeywords"
              defaultValue={j<string[]>(prefs?.mustHaveKeywords ?? "", []).join(", ")}
              placeholder="python, django, postgres"
            />
            <Field
              label="Never apply if it mentions"
              name="excludeKeywords"
              defaultValue={j<string[]>(prefs?.excludeKeywords ?? "", []).join(", ")}
              placeholder="commission only, unpaid, field sales"
            />
            <Field label="Min experience (years)" name="minExperienceYears" type="number" step="0.5" defaultValue={prefs?.minExperienceYears ?? 0} />
            <Field label="Max experience (years)" name="maxExperienceYears" type="number" step="0.5" defaultValue={prefs?.maxExperienceYears ?? 50} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle
              label="Jobs in India only"
              name="indiaOnly"
              defaultChecked={prefs?.indiaOnly ?? true}
              hint="Keeps roles located in India, whoever the employer is. Drops US/EU-remote postings you could not take."
            />
            <Toggle label="Remote roles only" name="remoteOnly" defaultChecked={prefs?.remoteOnly} />
            <Toggle
              label={'Include unscoped "Remote" roles'}
              name="allowUnscopedRemote"
              defaultChecked={prefs?.allowUnscopedRemote}
              hint="Postings that say only 'Remote' with no country. Many turn out to be country-locked."
            />
          </div>

          <div>
            <p className="label">Where to search</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {connectors.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-line bg-ink p-3">
                  <input
                    type="checkbox"
                    name="portals"
                    value={c.id}
                    defaultChecked={enabled.includes(c.id)}
                    className="mt-0.5 h-4 w-4 accent-[#5b8cff]"
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm text-slate-200">
                      {c.label}
                      <span className={`pill ${c.kind === "ats" ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
                        {c.kind === "ats" ? "allowed" : "against ToS"}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{c.tosNote}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Toggle
            label="Submit applications automatically"
            name="autoSubmit"
            defaultChecked={prefs?.autoSubmit}
            hint="Off: the agent fills everything in and leaves the tab open for you to check and click Submit. Turn this on once you trust what it produces."
          />

          <p className="text-xs text-slate-600">
            Rate limits, active hours and the match threshold live in{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Settings
            </Link>
            . The defaults are deliberately conservative.
          </p>
        </ActionForm>
      </Step>

      {hasResume && profileDone && prefsDone ? (
        <div className="rounded-lg border border-good/30 bg-good/10 px-4 py-3 text-sm text-good">
          Setup complete.{" "}
          <Link href="/" className="underline">
            Go to the dashboard and start the autopilot
          </Link>
          .
        </div>
      ) : null}
    </div>
  );
}
