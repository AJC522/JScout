# JScout

A job search tool that runs on your own computer. It gathers postings from public job boards, straight from employers' hiring pages, and from federal, state and local government (including police and sheriff's departments) into a local index, so searching is instant and the results are ranked, de-duplicated and filtered the way you want. Your profile, résumé and applications stay on your machine.

## What it does

- **Fast, accurate search.** Postings are synced into a local full-text index (SQLite FTS5). Searches take milliseconds, the same job listed on several sites shows up once, and location filters understand cities, radiuses, states, countries, hiring regions (EMEA, DACH, …) and which countries a remote job is open to.
- **Broader searches with one click.** JScout knows ~600 job titles and their synonyms ("Software Engineer" also finds "Software Developer" and "SWE"; "Security Analyst" also finds the federal "IT Specialist (INFOSEC)") and adjacent roles, including law-enforcement technology jobs such as crime analyst, digital forensics examiner and CAD/RMS administrator. When a search is thin it suggests ways to widen it — similar titles, a bigger radius, remote jobs, an older date window — and shows how many extra jobs each one adds.
- **Saves your information once.** A profile with your preferences, skills, certifications and résumé (PDF, DOCX or text) drives "search from my profile", match scores ("you have 6 of 9 listed skills"), saved searches with new-result counts, and one-click copy of your details while filling in application forms. It is kept in a data folder of your own, outside the app's folder, so updating JScout, downloading a fresh copy or running it from another folder never asks you to upload your résumé or fill in your details again.
- **Ranks jobs by how well you match them.** Every result gets a **% match** against your background, not just your search words. It weighs four things, and leaves out any the posting doesn't mention: your **skills** (from your profile, résumé and work history) against the skills the job lists (40 points), **certifications and licences** you hold against the ones it lists (15), your **background**, meaning the job's role against the titles you're targeting, your current job and past jobs, with partial credit for adjacent roles and the same field (30), and your **experience level** against the job's seniority (15). The default **Best match** order puts jobs in 10-point tiers (90–100%, 80–89%, …). Within a tier, jobs are ordered by **location**: remote jobs open to you, then jobs in or near your preferred places, then elsewhere in your state, your country and abroad. If you didn't pick Remote as a work arrangement, local jobs come before remote ones. After location comes **pay**, highest first, using the middle of the posted range converted to your currency. Hover a result's ring for the breakdown, or open the job for the full detail, including the skills and certifications you have and are missing. Relevance, Newest and Highest salary orders are still in the sort menu.
- **Reviews and tailors your résumé.** The Résumé review page (and a Résumé tab in every job's apply kit) scores your résumé from 0 to 100 against a job you're applying to, a tracked application, or any job description you paste. It checks each requirement and "nice to have" in the posting against your résumé and shows the line that proves it, breaks the score down (listed skills, requirements, keywords, job title, years of experience, résumé basics), and lists what to change, most important first: skills on your profile that your résumé leaves out, requirements it doesn't show, weak bullet openers with a stronger rewrite, bullets to move up, missing numbers. One click makes a tailored draft that reorders your bullets and skills for that job and fixes weak openers without adding anything you haven't done; with an AI key, Claude can rewrite it under the same rules. Edit the draft, re-check its score, then copy it, download it or save it to the application.
- **Shows what you're missing for the jobs you want.** The Skill gaps page looks at up to 250 of the jobs you're aiming for (your target titles and saved preferences), your active applications, or any search (the **Skill gaps** button above the results), and pinpoints what they ask for that your profile and résumé don't show: the skills and certifications they list most, each with how many jobs ask for it and how much having it would raise your match (and how many jobs it would move up a tier), skills you have that your résumé never mentions, and whether the jobs' level is above or below yours. It turns that into a short list of what to do first, says what your average match would be with the top gaps closed, and lists your most in-demand strengths. Already have a skill it flags? **I have it** adds it to your profile and the analysis updates.
- **Flags security clearances.** Every job that mentions a security clearance gets a flag saying what it means for you: **no clearance needed**, **preferred** (helps, not required), **sponsored** (required, but the employer gets it for you after you're hired; you only need to be eligible), **must already hold one** (bring it with you), or **required, sponsorship not stated** (ask before applying). The flag names the level (Public Trust, Confidential, Secret, Top Secret, TS/SCI, DOE L/Q) and any polygraph (CI or full-scope), and the job page quotes the sentence it came from. JScout reads the whole posting: "Basic" vs "Preferred qualifications" sections, defense contractors' "Clearance Level Must Currently Possess: None / Must Be Able to Obtain: Secret" lines, "active Secret required with the ability to obtain TS/SCI" (bring a Secret; they sponsor the upgrade), and it ignores FDA, medical, customs and fingerprint clearances and police polygraphs. Federal (USAJOBS) jobs count as sponsored, since agencies process the clearances of the people they hire. Add the clearance you hold under **Profile → Work** (level, active or inactive, polygraph) and each flag turns green when yours covers the job and red when it doesn't; the **Security clearance** filter (or **Only jobs I can get without one**) narrows a search, and fit analysis, saved answers and quick-fill use it too.
- **Helps you apply.** Track applications on a board (saved → applied → interviewing → offer), with notes, contacts, a timeline, follow-up reminders and documents. For any job, get a fit analysis (matched and missing skills, keywords, likely blockers), a cover letter draft, and answers to common application questions drawn from your saved answers. All of this works offline; if you add your own Anthropic API key, drafts can also be written by Claude.
- **Applies by email from inside JScout.** When a posting says to apply by email ("send your résumé to jobs@…"), its job page has an **Apply by email** button: JScout fills in the address, the subject line the posting asks for, a cover letter as the message (your saved one for that application, or a draft from your profile) and attaches your résumé. Edit it, press **Send application**, and it goes out from your own email account; the job moves to Applied in your tracker with the email saved on it and a follow-up reminder. The apply kit's **Email** tab does the same for any job, for example to a recruiter whose address is on the application. Set up the account once under **Settings → Sending applications** (Gmail, Outlook, Yahoo, iCloud and Fastmail are preset; most need an app password). Employer job boards (Greenhouse, Lever, Ashby, SmartRecruiters) only accept applications through their own forms, and USAJOBS and GovernmentJobs through your account there, so those are still made on their sites: JScout's quick-fill panel has your details ready to copy.

## Requirements

- [Node.js](https://nodejs.org/) **22.13 or newer** (the LTS download is fine)
- Windows, macOS or Linux, and an internet connection for syncing jobs

## Getting started

1. Install [Node.js](https://nodejs.org/) if you don't have it.
2. Get JScout: `git clone https://github.com/AJC522/JScout.git`, or download the ZIP from GitHub (**Code → Download ZIP**) and extract it.
3. Start it with the launcher in the JScout folder:

| System | Launcher |
|---|---|
| Windows | Double-click `JScout.bat` |
| macOS | Double-click `JScout.command` |
| Linux | Run `./jscout.sh` in a terminal, or right-click it in the file manager and choose **Run as a Program** |

The launcher sets JScout up the first time (it downloads what JScout needs and builds it, which takes a few minutes), and again after updates, then opens it at <http://localhost:4310>. A short setup asks for your résumé, what you are looking for, and which industries' employers to follow; every step can be skipped. JScout then fetches jobs in the background: the job boards give you around 9,000 postings within a couple of minutes, USAJOBS adds every open U.S. federal job (about 9,500) a couple of minutes later, and the employers and agencies you follow are added as they sync.

JScout runs for as long as the launcher's window is open. Close the window, or press `Ctrl+C` in it, to stop JScout; start the launcher again whenever you want to use it. If JScout is already running, the launcher just opens it in your browser. On Windows, right-click `JScout.bat` and choose **Send to → Desktop (create shortcut)** to start it from your desktop.

From a terminal, `npm start` in the JScout folder does the same as the launchers.

### Options

Set these environment variables before starting JScout if you need them:

| Variable | Default | Purpose |
|---|---|---|
| `JSCOUT_PORT` | `4310` | Port to listen on |
| `JSCOUT_DATA_DIR` | your user data folder (see [Privacy](#privacy)) | Where the database and your résumé are stored |
| `JSCOUT_NO_OPEN` | unset | Set to `1` to not open the browser automatically |
| `ANTHROPIC_API_KEY` | unset | Optional; same as entering a key in Settings |
| `HTTPS_PROXY` | unset | Use a proxy for syncing (picked up automatically on Node.js 22.21 or newer) |

## Where jobs come from

| Source | What it covers |
|---|---|
| **Employer job boards** on Greenhouse, Lever, Ashby and SmartRecruiters | Postings straight from employers — the freshest data. About 540 companies (roughly 43,000 open jobs) are included, among them government-technology, public-safety-technology and defense employers (Axon, Mark43, Anduril, Palantir, Esri, …); you choose which to follow during setup or on the Companies page, and can add any other company by pasting its careers-page link. Following all of them means a download of several hundred MB, so pick the industries you care about. |
| **Government agencies** on [GovernmentJobs.com](https://www.governmentjobs.com) (NEOGOV) | State, county and city governments, police and sheriff's departments, courts and other public agencies, read from each agency's public job feed with full bulletins, pay ranges and closing dates. About 290 agencies (roughly 13,000 open jobs, from the State of Washington to the Honolulu Police Department) are included under *Government and public safety*; add any other agency by pasting its governmentjobs.com/careers link. |
| [USAJOBS](https://www.usajobs.gov) | Every open U.S. federal job announcement that the public can apply for, from the official USAJOBS data API (no key needed): grades, pay, security clearance and who may apply. Full text is downloaded for IT, cyber, data, engineering, intelligence, investigation and police series; other jobs get theirs when you open them. Settings → Job sources can change the series or include jobs open only to current federal employees. |
| [Remote OK](https://remoteok.com), [We Work Remotely](https://weworkremotely.com), [Jobicy](https://jobicy.com), [Remotive](https://remotive.com), [Working Nomads](https://www.workingnomads.com) | Remote jobs |
| [Arbeitnow](https://www.arbeitnow.com) | Jobs across Europe, many on-site in Germany |
| [Hacker News "Who is hiring?"](https://news.ycombinator.com) | Monthly threads of tech jobs, often with salaries |
| [Himalayas](https://himalayas.app) | Remote jobs; needs a free API key (Settings → Job sources) |

Each source is credited next to its postings and every posting links back to the original listing, as the sources ask. Sources can be switched off individually in Settings. JScout fetches politely: each source is synced on its own schedule, with pauses between requests and conditional requests where supported.

Sites that do not allow automated access (such as LinkedIn and Indeed) are not indexed; instead, every search offers one-click links to run the same search there. For US searches and public-sector, law-enforcement or cleared-job searches those links include USAJOBS, GovernmentJobs.com and ClearanceJobs.

## Privacy

- Everything you enter — profile, résumé, applications, saved searches, API keys — is stored only in a data folder on your computer: `%LOCALAPPDATA%\JScout` on Windows, `~/Library/Application Support/JScout` on macOS and `~/.local/share/jscout` on Linux (or `$XDG_DATA_HOME/jscout`). JScout prints its location when it starts. Because it is outside the app's folder, updates and new copies of JScout keep using it. Versions before this one kept data in a `data` folder inside the app's folder; it is moved to the new location the first time you start this version. Back it up or move it to another computer with **Settings → Your data → Export**.
- JScout only accepts connections from your own computer. It has no password, though: while it runs, anyone else signed in to the same computer (another user account) could read your data through it, so on a shared computer stop it when you are done.
- Requests to job sources never include your personal information.
- Nothing is sent to an AI provider unless you add a key **and** press a "with AI" button (such as **Rewrite with AI** on a résumé).
- Nothing is emailed unless you set up an account in **Settings → Sending applications** **and** press **Send application** (or **Send a test email**). Emails go through your own provider's outgoing mail server over an encrypted connection, from your address, to the recipients you see before sending. The password is stored only in your data folder, never shown again, and removed with **Remove account**.

## Development

```bash
npm run dev        # API with auto-reload + Vite dev server at http://localhost:5173
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript, server and client
npm run e2e        # end-to-end tests (Playwright) against the built app;
                   # run `npx playwright install chromium` once before the first run
npm run build      # production build into dist/
```

Code layout: `src/shared` holds the types and API contract shared by both sides; `src/server` has the job source adapters (`sources/`), ingest and sync (`ingest/`), the search engine (`search/`), features and routes; `src/client` is the React interface. Reference data (cities, skills, job titles, company boards) lives in `src/server/data`; `scripts/build-gazetteer.mjs` regenerates the city data.

## Troubleshooting

- **"JScout needs Node.js"** — install the LTS version from <https://nodejs.org/>, then start the launcher again.
- **macOS won't open `JScout.command`** — this can happen when JScout was downloaded as a ZIP. Right-click the file and choose **Open**, or allow it under System Settings → Privacy & Security. Running `sh jscout.sh` in Terminal from the JScout folder always works.
- **"Port 4310 is in use by another program"** — start JScout on another port: `JSCOUT_PORT=4311 npm start` (PowerShell: `$env:JSCOUT_PORT=4311; npm start`).
- **No jobs appear** — check Settings → Job sources for errors. Behind a company proxy, set `HTTPS_PROXY`; this needs Node.js 22.21 or newer (older versions ignore the proxy).
- **A scanned PDF résumé shows no text** — paste the text instead (Profile → Résumé).

## Credits

- Location data from [GeoNames](https://www.geonames.org/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Federal job data from the [USAJOBS data API](https://developer.usajobs.gov/), published by the U.S. Office of Personnel Management.
- Job listings belong to their publishers and the sources listed above.

## License

[Apache 2.0](LICENSE)
