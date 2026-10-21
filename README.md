# Job Autopilot

A job-search agent you run yourself. It searches job sources on a loop, scores each
posting against your actual resume, rewrites that resume for the ones worth applying
to, fills in the application form, and keeps a spreadsheet of everything it did.

Built for the Indian market: it knows about CTC in LPA, notice periods, "total
experience in years", and the other fields Naukri and friends ask on every single form.

```
┌─ web app (Next.js) ─────────────┐     ┌─ worker (node, 24/7) ───────────────┐
│  setup wizard                   │     │  search → score → tailor → apply     │
│  dashboard + live activity log  │ ◄───┤  rate limits, quiet hours, caps      │
│  jobs / applications tables     │     │  pauses and asks you on a captcha    │
│  settings                       │     └──────────────────────────────────────┘
└─────────────────────────────────┘                    │
              └──────── SQLite ────────────────────────┘ ───► .xlsx / .csv tracker
```

---

## Read this before you run it

**Automated applying breaks the terms of service of Naukri, Indeed and LinkedIn.**
They prohibit automated access, and enforcement is real: rate limiting, then account
restriction. This tool runs on *your* logged-in session with deliberately low limits
and a kill switch, which is the difference between "an enthusiastic job seeker" and
"a bot", but it does not make the terms go away. That is your call to make.

The Greenhouse, Lever and Ashby connectors read public job-board APIs and apply through
the company's own form. Nothing about those is against anyone's terms. If you want the
safe subset, enable only those three.

**It will not lie on your behalf.** Resume tailoring reorders, rewrites and drops your
real experience to match a posting. It is forbidden from inventing employers, titles,
dates, degrees, certifications or metrics, and every tailored resume is checked against
your original by [`src/lib/resume/verify.ts`](src/lib/resume/verify.ts) before it gets
attached to anything. If the check fails, your unmodified resume is sent instead and the
job is flagged. This is not squeamishness — fabricated resumes get offers rescinded and
people fired after they start.

**Autosubmit is off by default.** Out of the box the agent does all the work and leaves
the form filled in for you to check and submit. Turn autosubmit on once you have seen a
few of its applications and trust them.

---

## Setup

Needs Node 20+ and an [Anthropic API key](https://console.anthropic.com).

```bash
git clone <this repo> && cd job-autopilot
npm install
npm run setup          # writes .env, creates the database, downloads Chromium
# put your ANTHROPIC_API_KEY in .env
npm run dev:all        # web app + worker together
```

Open <http://localhost:3000> and work through Setup:

1. **Upload your resume** — PDF, DOCX or text. It is read into structured data, which
   is what makes per-job tailoring and form filling possible. Most of step 2 gets
   pre-filled from it.
2. **Your details** — the answers portals ask over and over: CTC, notice period, total
   experience, location, education. Enter them once.
3. **What to look for** — job titles (these are the literal search queries), locations,
   must-have and never-apply keywords, and which sources to use.

Then press **Start autopilot** on the dashboard. That is the whole thing.

### Portal logins

Naukri, Indeed, LinkedIn and Internshala need you to be logged in. No passwords are
stored anywhere. Each portal gets its own persistent browser profile:

```bash
HEADLESS=false npm run worker
```

A browser window opens. Log in once, by hand, including any OTP. The session is kept in
`data/browser-profiles/` and reused from then on. Close it and go back to `HEADLESS=true`.

---

## How it decides

Each pass runs four stages. Only jobs that survive one stage cost anything in the next.

| Stage | What happens | Cost |
|---|---|---|
| **Discover** | Each enabled connector searches your titles × locations | free |
| **Pre-filter** | Keyword and experience-band rejection, in code | free |
| **Score** | Claude Haiku rates fit 0–100 against your real resume | cheap, runs a lot |
| **Apply** | Claude Opus tailors the resume, writes the cover letter, answers the form | per application |

Anything scoring below your threshold (default 65) is recorded with a reason and never
applied to. You can see the rejections and the reasoning on the **Jobs** page.

Form filling tries rules before the model. About 70% of fields on a typical Indian job
form — name, email, phone, CTC, notice period, experience, location, LinkedIn — are
answered deterministically from your profile, with no model call and no chance of drift.
The model only handles what is left, and a required field it cannot answer honestly stops
the application and asks you rather than guessing.

---

## Safety rails

All configurable in **Settings**; the defaults are conservative on purpose.

| Rail | Default | Why |
|---|---|---|
| Applications per day | 25 | More than a person plausibly sends |
| Per portal, per hour | 6 | The limit that actually matters |
| Seconds between applications | 90 | Machine-gun timing is the clearest bot tell |
| Active hours | 08:00–23:00 | Applications at 4am look like what they are |
| Minimum match score | 65 | Spraying applications is worse than sending none |
| Autosubmit | off | You see the first ones before it sends anything |

On a captcha, OTP, unexpected login screen or missing required field, the worker **stops**,
records why, and surfaces it on the dashboard. It does not retry its way around a wall.

---

## Adding company job boards

The highest-value thing you can do. In **Settings → Company job boards**, add the ATS
token of any company you actually want to work at. It is the last path segment of their
careers URL:

```
boards.greenhouse.io/stripe   →  stripe      (greenhouse)
jobs.lever.co/palantir        →  palantir    (lever)
jobs.ashbyhq.com/openai       →  openai      (ashby)
```

The shipped seed list is verified against the live APIs but skews global, because most
Indian employers do not publish a public ATS board. For the Indian market the portal
connectors do the heavy lifting — so add the specific companies you are targeting.

---

## Running it on a server

```bash
sudo bash deploy/ec2-setup.sh
```

Ubuntu 22.04/24.04. Adds swap if RAM is under 2 GB (a 1 GB box OOM-kills
`next build` otherwise), installs Node and Chromium with its system libraries,
writes `.env`, builds, and registers two systemd services that come back on
reboot and on crash.

The script sets `APP_PASSWORD` and prints it. **Do not skip that**: the
dashboard holds your resume, phone number and salary, and a button that applies
for jobs in your name. With `APP_PASSWORD` set, every page and API route is
behind a login; without it the app assumes localhost and does not gate.

Open inbound TCP 3000 in the security group **to your own IP only**.

```bash
journalctl -u job-autopilot-worker -f                    # watch it work
sudo systemctl restart job-autopilot-web                 # after a config change
```

One caveat on a headless server: Naukri, Indeed and LinkedIn need a one-off
manual login in a visible browser, which a server cannot show you. The company
job boards need no login and are enabled by default.

## Commands

```bash
npm run dev:all     # web app + worker
npm run dev         # web app only
npm run worker      # worker only  (HEADLESS=false to watch it / log in)
npm run selftest    # offline checks: form scanner, field rules, fabrication guard, PDF, xlsx
npm run db:studio   # browse the database
npm run build       # production build
```

`npm run selftest` makes no model calls and needs no API key. Run it after changing a
connector or upgrading Playwright.

---

## When a portal stops returning results

Portals redesign their markup and the selectors go stale. Everything portal-specific is
in one object per portal in [`src/connectors/portals.ts`](src/connectors/portals.ts) —
each field takes a list of candidate selectors and the first that hits wins. Add the new
selector to the front of the list. The worker logs
`No cards matched for "<query>" — selectors may need updating` when this happens.

## Layout

```
src/
  app/              Next.js pages + server actions
  components/       UI
  connectors/       one module per job source; ats.ts is the clean ones
  automation/       Playwright: browser, form scanner, field rules, apply driver
  lib/
    resume/         parse → tailor → verify → render
    match.ts        pre-filter + scoring
    sheet.ts        xlsx / csv tracker
    ai.ts           Anthropic client, models, the truthfulness rule
  worker/           the 24/7 loop, rate-limit gates, pipeline
prisma/schema.prisma
scripts/            setup.mjs, selftest.ts
```

Everything lives in `data/` — SQLite database, resumes, tailored PDFs, screenshots of
every submitted form, browser profiles, exports. Back that folder up; delete it to start over.

## Cost

Roughly: scoring is fractions of a paisa per job on Haiku. A full application — tailor
the resume, write the cover letter, answer the form — is a few rupees on Opus. At the
default 25/day you are looking at low tens of rupees a day, most of it spent only on jobs
that cleared the match threshold. Set `ANTHROPIC_MODEL=claude-sonnet-5-5` in `.env` to cut
that significantly.

## Licence

MIT. It runs under your accounts and sends applications in your name; what it sends is
your responsibility.
