# JScout

A job search tool that runs on your own computer. It gathers postings from public job boards, straight from employers' hiring pages, and from federal, state and local government (including police and sheriff's departments) into a local index, so searching is instant and the results are ranked, de-duplicated and filtered the way you want. Your profile, résumé and applications stay on your machine.

## What it does

- **Fast, accurate search.** Postings are synced into a local full-text index (SQLite FTS5). Searches take milliseconds, the same job listed on several sites shows up once, and location filters understand cities, radiuses, states, countries, hiring regions (EMEA, DACH, …) and which countries a remote job is open to.
- **Broader searches with one click.** JScout knows ~600 job titles and their synonyms ("Software Engineer" also finds "Software Developer" and "SWE"; "Security Analyst" also finds the federal "IT Specialist (INFOSEC)") and adjacent roles, including law-enforcement technology jobs such as crime analyst, digital forensics examiner and CAD/RMS administrator. When a search is thin it suggests ways to widen it — similar titles, a bigger radius, remote jobs, an older date window — and shows how many extra jobs each one adds.
- **Saves your information.** A profile with your preferences, skills, certifications and résumé (PDF, DOCX or text) drives "search from my profile", match scores ("you have 6 of 9 listed skills"), saved searches with new-result counts, and one-click copy of your details while filling in application forms.
- **Ranks jobs by how well you match them.** Every result gets a **% match** against your background, not just your search words. It weighs four things, and leaves out any the posting doesn't mention: your **skills** (from your profile, résumé and work history) against the skills the job lists (40 points), **certifications and licences** you hold against the ones it lists (15), your **background**, meaning the job's role against the titles you're targeting, your current job and past jobs, with partial credit for adjacent roles and the same field (30), and your **experience level** against the job's seniority (15). The default **Best match** order puts jobs in 10-point tiers (90–100%, 80–89%, …). Within a tier, jobs are ordered by **location**: remote jobs open to you, then jobs in or near your preferred places, then elsewhere in your state, your country and abroad. If you didn't pick Remote as a work arrangement, local jobs come before remote ones. After location comes **pay**, highest first, using the middle of the posted range converted to your currency. Hover a result's ring for the breakdown, or open the job for the full detail, including the skills and certifications you have and are missing. Relevance, Newest and Highest salary orders are still in the sort menu.
- **Reviews and tailors your résumé.** The Résumé review page (and a Résumé tab in every job's apply kit) scores your résumé from 0 to 100 against a job you're applying to, a tracked application, or any job description you paste. It checks each requirement and "nice to have" in the posting against your résumé and shows the line that proves it, breaks the score down (listed skills, requirements, keywords, job title, years of experience, résumé basics), and lists what to change, most important first: skills on your profile that your résumé leaves out, requirements it doesn't show, weak bullet openers with a stronger rewrite, bullets to move up, missing numbers. One click makes a tailored draft that reorders your bullets and skills for that job and fixes weak openers without adding anything you haven't done; with an AI key, Claude can rewrite it under the same rules. Edit the draft, re-check its score, then copy it, download it or save it to the application.
- **Helps you apply.** Track applications on a board (saved → applied → interviewing → offer), with notes, contacts, a timeline, follow-up reminders and documents. For any job, get a fit analysis (matched and missing skills, keywords, likely blockers), a cover letter draft, and answers to common application questions drawn from your saved answers. All of this works offline; if you add your own Anthropic API key, drafts can also be written by Claude.

## Requirements

- [Node.js](https://nodejs.org/) **22.13 or newer** (the LTS download is fine)
- Windows, macOS or Linux, and an internet connection for syncing jobs

## Getting started

```bash
git clone https://github.com/AJC522/JScout.git
cd JScout
npm install
npm start
```

`npm start` builds the app the first time (and again after updates, installing any new dependencies), then opens it at <http://localhost:4310>. A short setup asks for your résumé, what you are looking for, and which industries' employers to follow; every step can be skipped. JScout then fetches jobs in the background: the job boards give you around 9,000 postings within a couple of minutes, USAJOBS adds every open U.S. federal job (about 9,500) a couple of minutes later, and the employers and agencies you follow are added as they sync.

Stop it with `Ctrl+C` in the terminal. Run `npm start` again whenever you want to use it.

### Options

Set these environment variables before `npm start` if you need them:

| Variable | Default | Purpose |
|---|---|---|
| `JSCOUT_PORT` | `4310` | Port to listen on |
| `JSCOUT_DATA_DIR` | `./data` | Where the database and your résumé are stored |
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

- Everything you enter — profile, résumé, applications, saved searches, API keys — is stored only in the local data folder (`./data` by default). Back it up or move it with **Settings → Your data → Export**.
- JScout only accepts connections from your own computer. It has no password, though: while it runs, anyone else signed in to the same computer (another user account) could read your data through it, so on a shared computer stop it when you are done.
- Requests to job sources never include your personal information.
- Nothing is sent to an AI provider unless you add a key **and** press a "with AI" button (such as **Rewrite with AI** on a résumé).

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

- **"Port 4310 is already in use"** — JScout may already be running; open <http://localhost:4310>. Or start it on another port: `JSCOUT_PORT=4311 npm start` (PowerShell: `$env:JSCOUT_PORT=4311; npm start`).
- **No jobs appear** — check Settings → Job sources for errors. Behind a company proxy, set `HTTPS_PROXY`; this needs Node.js 22.21 or newer (older versions ignore the proxy).
- **A scanned PDF résumé shows no text** — paste the text instead (Profile → Résumé).

## Credits

- Location data from [GeoNames](https://www.geonames.org/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Federal job data from the [USAJOBS data API](https://developer.usajobs.gov/), published by the U.S. Office of Personnel Management.
- Job listings belong to their publishers and the sources listed above.

## License

[Apache 2.0](LICENSE)
