# Handoff prompt — paste this into a new Claude session

I'm continuing work on **OutreachOS** — AI-powered job-search automation. Memory files in `~/.claude/projects/-Users-lakshmisravyarachakonda-VS-CODE-email-tracker/memory/` will auto-load. Key context follows; please confirm you can access memory + the working dirs before we begin.

---

## Stack & deployment (live as of 2026-04-25)

```
Vercel (outreach-jt.vercel.app)
   │  static React SPA, sends Bearer <jwt> on every /api/* call
   ▼
Oracle Cloud Always Free VM (140.245.15.56 → outreach-jt.duckdns.org)
   │  Express + pm2 + nginx + Let's Encrypt SSL
   │  Playwright for auto-apply, Puppeteer for PDFs
   │  Auth: ES256 JWKS verify, AUTH_MODE=enforce
   ▼
Supabase Postgres 17.6 (session pooler: aws-1-us-east-1)
```

- Frontend repo: `/Users/lakshmisravyarachakonda/VS CODE/email tracker` (branch: `main`)
- Backend worktree: `/Users/lakshmisravyarachakonda/VS CODE/outreach-local` (branch: `phase-4-pg` — VM tracks this)
- Repo: `https://github.com/Sravya1802/outreach-os` (PUBLIC — flagged in memory: still has historical PII commits, recommend rewriting history or going private)

## Accounts

- **`lakshmisravyar@gmail.com`** (UUID `70df2946-a46e-4b63-832c-2822cda4cf4b`) — owns ALL existing production data: 1499 companies, 36 job_contacts (14 with email), 2 evaluations, resume text, 6 role-archetype PDFs in `/home/ubuntu/outreach/resumes/`.
- **`rls180202@gmail.com`** (UUID `459b9b5b-1f86-48cf-9b8a-98e7a4fb4c5d`) — empty / clean-slate account.
- Per-user isolation is enforced — each account sees ONLY its own data via RLS + backend `WHERE user_id = req.user.id` on every query.

## Migrations applied to Supabase

- `001_init.sql` (legacy)
- `002_backend_schema.sql` — full canonical schema (13 tables + indexes + RLS + storage)
- `003_per_user_isolation.sql` — added `user_id UUID DEFAULT <founder>` to every table, backfilled, swapped RLS to `user_id = auth.uid()`
- `004_user_id_not_null.sql` — tightened user_id NOT NULL (kept DEFAULT for cron paths)

## Recent commits (main branch, latest first)

```
cbdb5cf  test: deepen audit coverage and privacy controls
a2616eb  docs: record green e2e verification
4233ff4  docs: record e2e credential failure
0b59c6d  fix: cache companies dashboard counts
4584276  fix: prevent company count flicker and route scrapes
e986b4d  docs: record dashboard auto-apply queue widget
8d87bf2  ux(dashboard): surface auto-apply queue counts with needs-review urgency
…
```

phase-4-pg tip:
```
8005128  fix: deepen auto-apply audit backend coverage
d0016ee  fix: scrape selected sources into jobs
2890bf0  feat(career ops): nightly auto-apply pipeline + visible queue
60615c5  feat(scrape): broaden role queries beyond CS + persist new-company names
ee4b6e2  feat(scrape): clearer feedback + last-scrape widget data
fa28694  fix(apify): export noteApifyError so scraper.js can import it
d8bf3b4  fix(scraper): align linkedin actors with apify schema changes
```

## Known gaps & open work

### Pending — needs my input or has an unfixed bug
1. **Outreach CRM "0 contacts"** — code fix is committed (`8a55549`) so `/outreach` now calls the JWT-attaching API wrapper. After Vercel deploy, verify as `lakshmisravyar@gmail.com` that `/outreach` shows 36 contacts (14 with email). If still empty, check Settings page → red Account box and DevTools Network `all-contacts` `Authorization` header.
2. ~~**Email + DM templates**~~ — implemented in the current uncommitted stabilization pass: `/outreach/templates` is now an editable per-user template UI, backend stores templates in `meta.outreach_templates`, and `generate` routes pass saved templates into the AI prompt as style anchors.
3. **Role Eligibility / Ranked Roles loading bug** — hardened again in frontend `6f84fda`: `/apply/ranked` now has a visible error/retry state and normalizes non-string `fit_assessment` values before rendering. Vercel route returns HTTP 200. Browser-verify while logged in; if it still fails, capture the rendered error or DevTools Console.
4. ~~**Sign in / Sign up UI**~~ — implemented in the current uncommitted stabilization pass: Login now has Sign in / Sign up tabs, with magic link kept as a secondary sign-in option.
5. **"Email rate limit exceeded" on magic link** — Supabase auth config issue, not code.
6. **Audit follow-ups** — current CI e2e is green on `main` (`24980521017`): **25 passed / 4 skipped** before this pass. Newly verified by default: combined Companies + Auto Apply queue filters, authenticated privacy export + sensitive-profile dry-run, render smoke, mobile smoke, and protected unauth API rejection. As of the 2026-04-27 fixture-seeding pass: `scripts/seed-e2e-fixtures.mjs` runs in CI before Playwright and creates a `jobs` row + queued auto-apply evaluation against a fresh Greenhouse URL, so the application-tracking Save and `E2E_AUTO_APPLY_EVAL_ID` Auto Apply dry-run gates run automatically once `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY` are added to GitHub Actions secrets. `E2E_RUN_REAL_APIFY` is now opt-in via either the workflow_dispatch `run_real_apify` checkbox or repo variable. Two-user isolation remains intentionally skipped per user decision.

### Deferred / acknowledged
- Apify actor quota/key can still block LinkedIn/Wellfound/Google Jobs scrapers even when `/api/health` says `has_apify: true`; latest frontend `6f84fda` refreshes `/credits/status?refresh=true` after scrape failures so the sidebar status should turn red/critical quickly. If actors keep returning 0 or quota errors, fix is Apify account/quota/actor choice, not only app code.
- ~~"Apify status card should turn red when limit hit"~~ — fixed in frontend `346c0b2` and backend `f929862`; VM deployed and public health check passed on 2026-04-25.
- ~~"Top Companies filter on Companies page is broken"~~ — fixed in frontend `463f756` + backend `86eaeed` (server-side sort + source/status filters); VM deployed through `d0016ee`.
- ~~"Companies page shows 0/loading first then populates"~~ — fixed in `7f42c6d`; tightened in `4584276`; final UX fix in `0b59c6d` uses per-user sessionStorage cache + parent stats snapshot so the page paints last known counts immediately and refreshes silently.
- ~~"Job Scraper source buttons show 'no companies found'"~~ — fixed in frontend `4584276` + backend `d0016ee`; per-source scrapes now hit canonical `/jobs/scrape` and backend accepts selected sources.
- ~~"Don't pre-load resume in Career Ops Evaluate"~~ — fixed in `6cf20ad` (Resume section now only renders on Auto-Apply Setup tab or when user has no resume).
- ~~"Job Dashboard slow to load"~~ — improved in `c2eabdb` (stale-while-revalidate sessionStorage cache, 5min TTL; instant first paint on revisit, background refresh).

### Architectural follow-ups (no urgency)
- Migration 005 to drop `user_id DEFAULT` after fixing 5 TODO(auth) markers in cron/startup paths (server.js daily refresh, jobs.js runReclassifyUnclassified, autoApplier comment).
- "System user" concept for background paths that genuinely have no request context.
- ~~Schema follow-up: replace global UNIQUE constraints with per-user uniqueness~~ — fixed in backend `5cce7a7`; migrations `005_per_user_uniqueness.sql` + `006_auto_apply_safety_profile.sql` applied on Supabase through the VM on 2026-04-26.

## How I work

- Auto mode: usually ON — execute autonomously on low-risk work. Off for big architectural calls.
- Memory rules I've internalized:
  - **No Claude attribution** in commits / PR bodies / code (no `Co-Authored-By`, no 🤖 footers).
  - **Disambiguate ambiguous "yes"/"go"** on multi-option prompts before acting on destructive branches.
  - **Never `git reset --hard` with a dirty tree** — stash first, always.
- Sandbox blocks: writing credentials to VM .env, force-pushing to main, broad credential probes. I ask before those.

## What's likely next

If the session resumes my work as of this snapshot:
1. **Browser-verify** after hard refresh: `/apply/ranked`, `/apply/auto-apply` Setup/Queue/Completed/History, `/discover/scraper`, `/discover/companies`, `/outreach`, and mobile sidebar layout.
2. **Auto Apply setup action:** open Career Ops / Auto-Apply Setup, review the expanded profile fields, explicitly check Auto Apply consent, save, then preview/queue. Backend now refuses queue/run without consent.
3. **Convert the remaining optional e2e skips to full verification:** seed one company row for the e2e user, set `E2E_AUTO_APPLY_EVAL_ID` to a queued supported-ATS evaluation with consent/resume, and only set `E2E_RUN_REAL_APIFY=1` when you intentionally want to spend Apify quota. Do not chase the second-user e2e skip unless the user reverses the decision; they chose to skip it.
4. **Apify reality check:** retry scrapers and watch sidebar API Status. If Apify turns red or sources still return quota/no-data results, check Apify console actor limits and upgrade/swap actors.
5. **Quick wins left:** Supabase magic-link rate-limit config and any browser-verified regressions.

Confirm you can read `~/.claude/projects/-Users-lakshmisravyarachakonda-VS-CODE-email-tracker/memory/MEMORY.md` and the auto-loaded memory files, then ask me which item I want to start with.

---

## ⚠️ Standing instruction to Claude (keep this HANDOFF.md alive)

**Every time you finish a unit of work — bug fix, new feature, diagnosis, branch state change — append a dated entry to the "Session log" below BEFORE ending your turn.** The user should never have to ask "what did you do so far?" — the answer always lives here.

Entry format:
```
### YYYY-MM-DD — <short title>
- **What:** 1–2 lines on the change
- **Files:** file.ext:line(s)
- **Status:** committed / uncommitted / branch name / not yet tested / verified working
- **Follow-up:** anything the next session needs to pick up
```

Also update the "Known gaps" section above when an item is resolved (strike through + move to "Session log") or when a new issue is uncovered.

---

## Session log

### 2026-10-12 — Claude path modernized (OpenAI stays live)

- **What:** User chose "modernize the Claude path only". `@anthropic-ai/sdk` 0.17 → **0.128.0** (pinned, backend + root package.json). New `backend/services/claude.js` is the single Claude helper: `claude-opus-5-5`, explicit `output_config.effort`, `max_tokens` 16000 (thinking counts toward it), server-side refusal fallback (`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`), refusal/max_tokens checks before reading content, text read by block type, SDK-level timeout + retries.
- **Call sites:** `ai.js` outreach (effort medium), `jobEvaluator.js` A–G evaluation (high, rubric prompt-cached; removed `temperature`, which 400s on current models), `resumeGenerator.js` tailoring (medium), `categorize.js` classification (low). OpenAI/Gemini code is untouched.
- **Status:** inactive in prod. The VM's `ANTHROPIC_API_KEY` is empty and `AI_PROVIDER=openai`. To turn it on, set the key in `~/outreach/.env` and `pm2 restart outreach-backend --update-env`. For evaluation, Claude stays third in line after OpenAI and Gemini (existing order).
- **Tests:** `backend/tests/claude.test.mjs` (mocked fetch: request shape, banned params, thinking-first content, refusal, truncation). Not verified against the live API: no Anthropic credentials on this Mac or the VM.

### 2026-10-12 — UI rebuild phase 1: foundation, shell, Home, Settings, Login

- **What:** Start of the full frontend rebuild (plan in memory `project_ui_rebuild.md`). New TypeScript code (strict) lives in `frontend/src/{app,ui,lib,features,styles}`. The dark-first design tokens are in `styles/app.css`. The old pages still render inside the new shell via `app/LegacyPage.tsx`; their CSS is scoped to `.legacy` in `styles/legacy.css` (layered below Tailwind utilities). Delete that file once every page is rebuilt.
- **New:** 5-section sidebar (Home/Jobs/Applications/Outreach/Settings) with section tabs; ⌘K command palette (pages, actions, company search); Home (setup checklist, needs-attention, KPIs, funnel, new roles, activity); Settings (account + password change, theme, integrations status, privacy export/erase with a confirm dialog); new Login and Reset Password.
- **Data layer:** React Query (`app/queries.ts`, keys in `app/queryClient.ts`). Typed API in `lib/api.ts` wraps the legacy `src/api.js`, which is kept because the old pages and `tests/api-client.test.mjs` import it. Old pages' `stats-refresh`/`credits-refresh` window events invalidate the cache.
- **URLs:** new paths in `app/nav.ts`. Every old path redirects via `LEGACY_REDIRECTS` and keeps its query string.
- **Quality gate:** `npm run check --prefix frontend` = tsc + eslint (0 warnings on TS) + vitest + build. E2E specs updated for the new copy and URLs, plus new `tests/e2e/shell.spec.js`. Local run: 37 passed / 4 skipped (opt-in).
- **Backend fix:** `services/creditChecker.js` now reads Apify `/v2/users/me/limits`. `/users/me` has no usage fields, so it always showed "$0 of $5, OK". Real state: $5.65 of $5 used, cycle resets 2026-10-24, so LinkedIn/Wellfound/Google Jobs scraping is down until then or until the limit is raised.
- **Bugs found, not fixed yet:**
  1. `/api/alerts/subscription` → 404 on the VM. The Job Alerts page is broken in prod.
  2. `job-metrics` `funnel_applied` counts `opened` + `queued` as applied, which overstates applications. Fix during the Applications rebuild.
  3. CareerOps History classifies by `ev.jobTitle`, but rows are snake_case `job_title`.
  4. Local `.env` `VITE_SUPABASE_ANON_KEY` is the legacy JWT key, which Supabase disabled on 2026-04-27. Local dev sign-in fails until it's swapped for the `sb_publishable_` key prod uses.
- **Deployed:** frontend `76373e4` on Vercel; backend fix on the VM as `ea82d8e` (backend file only). E2E against prod: 37 passed / 4 skipped. Note that main commit `1edc33d` also carries the frontend file deletions/rename that were staged at the time (harmless; both commits shipped together).
- **VM:** the uncommitted HR-filter diff in `backend/routes/jobs.js` is still there. Backup at `~/jobs-hr-filter-wip-2026-10-12.patch`.
- **Next phases:** Jobs (roles + companies + find + alerts) → Applications (one status model, board/table, auto-apply queue) → Outreach (contacts with draft/edit/mark sent + templates) → Company/Role detail pages → delete legacy.

### 2026-10-12 — Full data wipe (user-requested)

- **What:** User asked to delete all data for every account, including maneeshreddy28@gmail.com's (1,480 jobs, 74 evaluations, 39 contacts) and the shared `scraped_roles` catalog (~10k rows). `TRUNCATE ... RESTART IDENTITY CASCADE` on all 14 `public` tables in one transaction. All rows are now 0.
- **Kept:** all 5 `auth.users` (lakshmisravyar, maneeshreddy28, rsatyashreyas, 2× e2e), the Supabase storage `resume-library` (9 objects), and `~/outreach/resumes/` on the VM.
- **Backup:** CSV export of every table at `~/outreach-backups/db-backup-2026-10-12.tgz` (Mac) and `~/db-backup-2026-10-12.tgz` (VM). To restore, `\copy public.<t> from '<t>.csv' with csv header`. Note that VM `pg_dump` is v14 and can't dump the v17 server.
- **Note:** The "Accounts" section above is stale. There are 5 users, and before the wipe most data belonged to maneeshreddy28.
- **Next:** Full frontend rebuild (user: UI dated, cluttered, confusing nav, feels buggy).

### 2026-10-12 — Resume after 4-month gap: health check (read-only)

- **What:** Checked the live stack. No code changed.
- **Live:** Vercel frontend 200; backend `/api/health` 200 (`auth_mode: enforce`, all keys present); pm2 `outreach-backend` online, uptime 3 months, 28 restarts; disk 25%; Let's Encrypt cert valid until 2026-11-20 (should auto-renew; verify certbot timer if unsure).
- **Broken:** Apify `Monthly usage hard limit exceeded` → LinkedIn / Wellfound actors fail on every scheduled run (falls back to Greenhouse direct scan); Indeed `all attempts failed`. This is account/quota, not code.
- **Drift:** VM `~/outreach` sits at `76dbb10` (= main `327b4d7`) with the HR-contacts filter (`fc5ca6e`) hand-applied as an uncommitted diff to `backend/routes/jobs.js`. Main is 2 commits ahead (`c572eda`, `91bfe3a`, both frontend-only), so the backend is functionally current.
- **Stale WIP:** `outreach-local` (phase-4-pg) has ~1.1k lines of uncommitted changes across 12 files (frontend + `jobs.js` careersUrl override + `multiSourceScraper.js`). Untouched. Need to decide whether any of it is still wanted or was superseded on main.
- **Follow-up:** User to pick next task.

### 2026-05-13 — Include HR / recruiter contacts in Outreach decision-maker list

- **What:** Outreach panel was hiding HR contacts (e.g. recruiters, talent partners, people-ops leads) behind the "non-tech filtered" message. `isEngineeringContact()` in [backend/routes/jobs.js:1266](backend/routes/jobs.js#L1266) is a two-stage filter: SKIP_TITLES blocklist, then ENGINEERING_TITLES allowlist. HR was being killed at BOTH stages — explicitly in SKIP_TITLES and implicitly by absence from ENGINEERING_TITLES.
- **Fix:** Removed `'human resources'`, `'hr'`, `'recruiter'`, `'talent'` from SKIP_TITLES so HR-style titles pass the first gate; added `'human resources'`, `'hr manager'`, `'hr director'`, `'hr business'`, `'chief people'`, `'head of people'`, `'people operations'`, `'people ops'`, `'recruiter'`, `'recruiting'`, `'talent acquisition'`, `'talent partner'`, `'talent lead'`, `'hiring manager'` to ENGINEERING_TITLES so they pass the second gate. The remaining SKIP_TITLES (office manager, insurance, legal, accounting, copywriter, customer success, etc.) are genuine noise and stay filtered.
- **Status:** Local edit done; committed and pushed; needs VM deploy via `sudo bash ~/outreach/deploy/update.sh` to take effect on https://outreach-jt.duckdns.org.
- **Follow-up:** After VM deploy, re-run "Find Emails" on a company in Outreach and verify HR/recruiter contacts now appear alongside engineering contacts.

### 2026-05-12 — VM backend DB auth fix (Supabase password rotated)

- **What:** Backend on Mumbai VM was crash-looping on startup with `[db] Failed to connect: password authentication failed for user "postgres"`. Root cause: the `DATABASE_URL` password in `~/outreach/.env` no longer matched what Supabase had on file. Direct `psql` against the pooler with the .env password also failed, confirming the credential — not the URL encoding — was the problem. (The error message `user "postgres"` is the Supabase pooler stripping `.PROJECT_REF` from `postgres.dkifhfqgoremdjhkcojc` before authing the underlying role; reaching that error means we *did* reach Supabase.)
- **Fix:** Reset the Supabase database password via Dashboard → Project Settings → Database → Reset database password. New password is symbol-free (letters/digits only) to avoid URL-encoding pitfalls — `@` in the old password had to be `%40` in the URL, which is the kind of thing that bites again later. Updated `DATABASE_URL` in `/home/ubuntu/outreach/.env`, restarted via `pm2 restart outreach-backend --update-env`. The `--update-env` flag is required; without it pm2 keeps the old env. The pm2 app name is `outreach-backend` (not `outreach`).
- **Status:** Backend live again. `out.log` shows `[db] Connected to postgres @ 2026-05-12T23:33:44`, `PostgreSQL 17.6`, `Backend on port 3001`. New password stored only in `~/outreach/.env` on the VM (and in user's password manager) — not committed, not in memory.
- **Gotchas captured for next time:**
  - When picking a Supabase password, **use letters/digits only**. Any `@`/`#`/`?`/`&`/`/` in the password must be percent-encoded in `DATABASE_URL` and re-encoded every place the URL appears.
  - Always restart pm2 with `--update-env` after editing `.env`. pm2 caches the original env from process start.
  - The "password authentication failed for user `postgres`" error from the Supabase pooler is **post-routing** — it means the connection string is being parsed correctly and you reached Supabase. The fix is the credential, not the URL.

### 2026-04-28 — Daily multi-source role scraper + resume-storage bug fix

- **What:** Two changes shipped today.

  **1. Resume bug fix** (`3067212` on main, `936983a` on phase-4-pg, both pushed). `scanResumes()` only read from local FS at `profile.resume_dir`, so when a non-founder user uploaded an archetype PDF via the CareerOps Library UI (which writes to Supabase Storage `resume-library/<userId>/`), the nightly auto-apply worker never saw it. Added `scanResumesFromStorage(userId)` in [resumeRegistry.js](backend/services/resumeRegistry.js) that lists the bucket via `resumeStorage.listLibrary()`, downloads each PDF to `/tmp`, and returns the same shape so `pickResumeForRole()` works unchanged. [autoApplier.js](backend/services/autoApplier.js) now prefers storage in both the `useLibraryResume=true` (nightly) path and the bottom-of-function fallback; FS is the second choice. `finally` block unlinks temp files when `resume.source === 'storage'`. Tailored mode was already correct — it tailors from `meta.user_resume_text` which CareerOps does keep updated.

  **2. New feature: daily multi-source scraped-roles catalog** (`88a2bd2` on main, `8b04339` backend mirror on phase-4-pg, plus levels.fyi link follow-up `bd118f1` on main). At 06:15 UTC every day a new cron hits Greenhouse / Lever / Ashby / LinkedIn / Wellfound / ai-jobs.net / Jobspresso / Remote Rocketship / InternshipDaily and upserts every fresh intern + new-grad role into `public.scraped_roles` (shared across all users, deduped by `apply_url`, US-only filter, stale rows >14 days flipped to `is_active=0`). The Dashboard's Intern Roles + New Grad Roles cards now navigate to dedicated `/apply/intern-roles` + `/apply/new-grad-roles` pages that list those roles sorted by date posted, with **Track** (creates a per-user manual evaluation) and **Auto Apply** (creates a queued auto evaluation that the existing worker picks up — gated on `auto_apply_consent` and `auto_apply_paused`, mirrors `/auto-apply/run`) per row. Levels.fyi + Glassdoor salary deep-links added on CompanyDetail and as a 💰 icon on each RolesPage row (no public API + active anti-scraping = pragmatic v1 is deep-link, not scrape).

- **Files:** [supabase/migrations/011_scraped_roles.sql](supabase/migrations/011_scraped_roles.sql), [backend/services/multiSourceScraper.js](backend/services/multiSourceScraper.js), [backend/routes/scrapedRoles.js](backend/routes/scrapedRoles.js), [backend/server.js:445-475](backend/server.js#L445-L475) (new cron + `MULTI_SCRAPE_DISABLED` kill switch — separate from `NIGHTLY_CRON_DISABLED` so you can pause auto-apply without losing role discovery), [backend/services/resumeRegistry.js](backend/services/resumeRegistry.js), [backend/services/autoApplier.js:280-330](backend/services/autoApplier.js#L280-L330), [frontend/src/api.js](frontend/src/api.js) (`api.scrapedRoles.{list,sources,track,autoApply,refresh}`), [frontend/src/components/RolesPage.jsx](frontend/src/components/RolesPage.jsx), [frontend/src/App.jsx](frontend/src/App.jsx) (lazy route), [frontend/src/components/DashboardPage.jsx:226-227](frontend/src/components/DashboardPage.jsx#L226-L227), [frontend/src/components/CompanyDetail.jsx:855-861](frontend/src/components/CompanyDetail.jsx#L855-L861).

- **Status:** typecheck clean (75 files), lint clean, root tests 10/10, build clean (RolesPage is its own 8.4 KB lazy chunk; main 235 KB unchanged). All commits pushed: main `bd118f1`, phase-4-pg `8b04339`. **Migration 011 NOT yet applied to Supabase** and **VM not yet redeployed** — both blocked on user action.

- **Follow-up:** (1) **Apply migration 011 in Supabase SQL editor** — it creates `public.scraped_roles` + indexes + a read-only RLS policy. Without it the new endpoints will 500. (2) **Deploy the VM** — `ssh -t ubuntu@140.245.15.56 'sudo bash /home/ubuntu/outreach/deploy/update.sh'` brings in the resume-storage fix + the new scraped-roles backend. The 06:15 UTC cron will start running on the next deploy, but won't have data until you trigger it manually via `POST /api/scraped-roles/refresh` (or a "🔄 Refresh now" button on the new pages) or just wait for tomorrow's cron. (3) **Apify quota:** LinkedIn + Wellfound scrapers will return [] until the quota burn is resolved — handoff already notes this; user said they'll pay $5/mo. The other 7 sources (Greenhouse / Lever / Ashby / ai-jobs / Jobspresso / Remote Rocketship / InternshipDaily) work without Apify. (4) Browser-test the new pages once VM + migration are live: navigate to /apply/intern-roles and /apply/new-grad-roles, hit Refresh, click Track on one row, click Auto-Apply on another, verify the Auto Apply queue picks them up. (5) The 💰 levels.fyi slug for company names with multiple words / non-alpha chars may not match levels.fyi's actual URL (some companies have custom slugs). The link will 404 in those cases; user can use the Glassdoor link as fallback or click into the company on levels.fyi search.

### 2026-04-27 — Autonomous follow-up sweep while user slept
- **What:** Closed 4 of the 6 launch-runbook follow-ups end-to-end without user input, and gathered evidence on the 2 that need their hands.
  1. **Pause-toggle code-verify (✅ no change needed):** Re-read [backend/routes/careerOps.js:457-458](backend/routes/careerOps.js#L457-L458). `auto_apply_paused` returns HTTP 409 with `'Auto Apply is paused. Resume it from the profile to run the worker.'` exactly as the runbook expected. Logic already lives on prod since this morning's deploy.
  2. **Phase-4-pg push to GitHub (✅ done, no SSH to VM needed):** Avoided the VM-side cherry-pick path (which needed SSH-key plumbing) by re-applying the same backend changes from `9692e11` onto local `outreach-local` and pushing. Edited `requireAuth.js` (default → `enforce`, prod boot guard, `req.user.id` defense, email-strip), `server.js` (auth_mode default + `nightly_cron_disabled` in `/api/health`, `NIGHTLY_CRON_DISABLED` short-circuit on both crons), `routes/careerOps.js` (auto_apply_paused 409 + 100/24h `AUTO_APPLY_DAILY_CAP` + remaining-aware limit + `auto_apply_paused` in profile ALLOWED list), `services/nightlyPipeline.js` (consent + pause gate matching `/auto-apply/run`). Added migrations `008_storage_buckets.sql` (was already applied to prod, just absent from this branch), `009_evaluations_unique_submitted.sql`, `010_auto_apply_paused.sql`. `node --check` clean across all four edits. Committed as `5d83ed9` `feat(launch): mirror pre-launch hardening from main onto phase-4-pg` and pushed to `origin/phase-4-pg`. **Result:** the next `update.sh` on the VM will fast-forward instead of rolling the hardening off.
  3. **Service-role-key audit (⚠️ needs human verification on VM):** Backend uses `SUPABASE_SERVICE_ROLE_KEY` at runtime in exactly one place — [backend/services/resumeStorage.js:18](backend/services/resumeStorage.js#L18) — for `/storage/v1/object/*` calls (resume library, single resume, tailored PDFs). The code is key-format-agnostic (just sends whatever's in the env as a Bearer token), so it works with both legacy `eyJ…` JWT and new `sb_secret_…` keys. `scripts/seed-e2e-fixtures.mjs`, `scripts/create-e2e-user.mjs`, `scripts/migrate-resumes-to-storage.mjs` also use it but only run from CI/manual, not from the VM. Verified no other Supabase admin/SDK paths in the runtime backend. **Risk:** if the VM's `/home/ubuntu/outreach/.env` still has the old `eyJ…` key, the *first* resume upload after Supabase's 2026-04-27 legacy-key cutoff will fail silently. Sandbox blocked me from reading the value to confirm.
  4. **Long-tail mobile code-audit (✅ low risk):** Grepped `gridTemplateColumns`, hardcoded widths, and minWidths across `CompanyDetail.jsx` (2173 LOC), `ApplicationPipeline.jsx`, `TemplatesPage.jsx`, `OutreachPage.jsx`. Every grid template found (`1fr 1fr`, `280px 1fr`, `2fr 1.5fr 2fr 1fr 80px`) is in the [index.css:241](frontend/src/index.css#L241) collapse list. Zero hardcoded widths over 600px. Mobile drawer chrome is sound; internal contents *should* collapse correctly. Real-device QA still warranted for touch-target sizes and modal overlays — code can't certify those.
  5. **E2E re-run (✅ green):** `gh workflow run e2e --ref main` → run [24986898770](https://github.com/Sravya1802/outreach-os/actions/runs/24986898770) → **27 passed / 2 intentional skips** in 27s. Includes the previously-flaky deep-audit specs: combined filters, privacy export + sensitive-profile dry run, application-tracking Save, and **the seeded Auto Apply dry run is now passing** (the captcha-needsReview fix `39b8992` is live and the seed-board reorder picks non-Cloudflare boards). Two-user isolation + real-Apify remain skipped per prior decisions.
  6. **VM stray-file cleanup (⏸ skipped, needs SSH):** `/home/ubuntu/outreach/git cherry-pick 9692e11 08d86cb` directory still exists. Trivial `rm -rf` once you SSH in next.
- **Files:** [backend/middleware/requireAuth.js](backend/middleware/requireAuth.js), [backend/server.js](backend/server.js), [backend/routes/careerOps.js:443-497](backend/routes/careerOps.js#L443-L497), [backend/services/nightlyPipeline.js:28-46](backend/services/nightlyPipeline.js#L28-L46) (all in `/Users/lakshmisravyarachakonda/VS CODE/outreach-local`), [supabase/migrations/008_storage_buckets.sql](../outreach-local/supabase/migrations/008_storage_buckets.sql), [supabase/migrations/009_evaluations_unique_submitted.sql](../outreach-local/supabase/migrations/009_evaluations_unique_submitted.sql), [supabase/migrations/010_auto_apply_paused.sql](../outreach-local/supabase/migrations/010_auto_apply_paused.sql).
- **Status:** `outreach-local/phase-4-pg` at `5d83ed9` and pushed to GitHub. `email tracker/main` unchanged this session. Live VM still on backend `8005128` per the prior session's note (the captcha-needsReview fix `39b8992` and now `5d83ed9` are sitting on `origin/phase-4-pg` waiting for the next deploy). Production health: still `auth_mode:"enforce"`, `nightly_cron_disabled:false`. E2E green on prod main.
- **Follow-up:** (1) **Browser-test the pause toggle** on prod when you're awake — Auto Apply → Setup → tick "Pause Auto Apply" → Save → "Run Auto-Apply Queue" → expect a 409 toast saying "Auto Apply is paused." Untick + Save and confirm normal runs work. (2) **Verify VM service-role key:** `ssh ubuntu@140.245.15.56 'grep -c sb_secret_ /home/ubuntu/outreach/.env'` — if this returns 0, the resume-upload path will silently 401 on first use; rotate the key in the VM `.env` to the value already in your laptop's `.env` and `pm2 restart outreach-backend`. (3) **Optional VM redeploy** to ship the captcha-needsReview fix `39b8992` and the freshly-pushed `5d83ed9` parity commit: `ssh -t ubuntu@140.245.15.56 'sudo bash /home/ubuntu/outreach/deploy/update.sh'`. Backend is identical to what's already running, but this brings remote tracking branch + local VM checkout into alignment. (4) Real-device mobile QA on long-tail routes (CompanyDetail, Pipeline, Templates, Outreach). (5) `rm -rf "/home/ubuntu/outreach/git cherry-pick 9692e11 08d86cb"` accidental shell-paste artifact.

### 2026-04-27 — Pre-launch hardening deployed + verified, mobile drawer shipped
- **What:** Took the launch-blocker hardening from "code on `main`" to "live on prod + verified." Migrations 009 (`evaluations_submitted_unique` partial unique index) and 010 (`auto_apply_paused` column) applied via Supabase SQL editor — `auto_apply_paused` confirmed in `information_schema.columns` and `verify-migrations` reports all 7 expected unique indexes. Cherry-picked `9692e11` + `08d86cb` from `main` onto `phase-4-pg` on the VM; conflicts resolved by taking phase-4-pg's frontend versions (App.jsx, CareerOps.jsx) and `git rm`'ing files phase-4-pg never had (Login.jsx, scripts/verify-migrations.mjs handled separately, DEPLOYMENT.md kept phase-4-pg's). Backend code on disk now has the boot guard, daily cap, kill switch, pause check, and email-strip — all four `grep` checks passed. Edited `/home/ubuntu/outreach/.env` (loaded via `node --env-file=`) to confirm `NODE_ENV=production` + `AUTH_MODE=enforce`; `pm2 restart all` came up clean (`[auth] middleware ready — mode=enforce`). `/api/health` now returns `nightly_cron_disabled:false` — that field only exists in the new server.js, so it doubles as proof the new code shipped. After deploy, `pg-pool` tripped `ECIRCUITBREAKER` because the user reset the DB password to run `verify-migrations` but didn't update `/home/ubuntu/outreach/.env`; updated the `DATABASE_URL` password (URL-encoded), restarted, breaker reset. E2E suite ran 23/29 — all 12 unauth specs (auth-enforcement on every protected endpoint), all 7 page-rendering specs, all 3 mobile-responsive specs, and 1 routing edge case all pass; the 3 deep-audit failures were caused by the breaker-trip mid-run, not regressions; 3 specs intentionally skipped (two-user isolation + opt-in Apify). Forgot-password flow verified end-to-end in browser (Login → Forgot link → email → /reset-password → set new pw → sign-in works). Mobile drawer landed: replaced the existing `@media (max-width: 900px)` rule that made `.app-sidebar` width:100% + height:42vh (the actual cause of the half-screen-of-sidebar bug on phones) with an off-canvas drawer pattern — sidebar `position: fixed` with `translateX(-100%)`, hamburger button at top-left (40×40, only renders <900px via CSS), translucent backdrop, `useLocation` effect auto-closes drawer on route change. Mobile-warning banner removed since the layout is now properly responsive. User confirmed both the drawer and the deeper-route mobile pass.
- **Files:** [supabase/migrations/009_evaluations_unique_submitted.sql](supabase/migrations/009_evaluations_unique_submitted.sql), [supabase/migrations/010_auto_apply_paused.sql](supabase/migrations/010_auto_apply_paused.sql), [backend/middleware/requireAuth.js](backend/middleware/requireAuth.js), [backend/routes/careerOps.js:443](backend/routes/careerOps.js#L443), [backend/server.js:445](backend/server.js#L445), [backend/services/nightlyPipeline.js:28](backend/services/nightlyPipeline.js#L28), [scripts/verify-migrations.mjs:46](scripts/verify-migrations.mjs#L46), [frontend/src/App.jsx](frontend/src/App.jsx), [frontend/src/components/Login.jsx](frontend/src/components/Login.jsx), [frontend/src/components/ResetPassword.jsx](frontend/src/components/ResetPassword.jsx), [frontend/src/components/CareerOps.jsx:670](frontend/src/components/CareerOps.jsx#L670), [frontend/src/index.css:241](frontend/src/index.css#L241), [DEPLOYMENT.md](DEPLOYMENT.md), [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md), `/home/ubuntu/outreach/.env` on VM (DATABASE_URL password rotated; `NODE_ENV` + `AUTH_MODE` confirmed).
- **Status:** frontend `main` at `028ad46` (mobile drawer) on top of `08d86cb` (runbook) on top of `9692e11` (hardening); backend `phase-4-pg` on the VM has the cherry-pick applied locally as commit 1 ahead of `origin/phase-4-pg`, **unpushed** — VM's GitHub HTTPS creds rejected the push, fix is to switch the VM remote to SSH. `pm2` `outreach-backend` at restart count 43, online, 17.6 MB. `/api/health` returns `auth_mode:"enforce"` and `nightly_cron_disabled:false`. `npm run verify-migrations` (laptop) all 4 invariants green including the new `evaluations_submitted_unique`. E2E: 12/12 unauth pass; authed run with `sb_publishable_…` key + new test user passed 23/29 (3 transient breaker failures pre-fix; 3 intentional skips).
- **Follow-up:** (1) **Browser-test the pause toggle**: Auto Apply → Setup → tick "Pause Auto Apply" → save → click "Run Auto-Apply Queue", expect 409 with "Auto Apply is paused." Untick + save and confirm runs work. (2) **Push the VM cherry-pick to GitHub** by switching the remote to SSH (`git remote set-url origin git@github.com:Sravya1802/outreach-os.git`) and adding the VM's `~/.ssh/id_ed25519.pub` to github.com/settings/keys, then `git push origin phase-4-pg`. Until done, the new daily cap / pause / kill-switch lives only on the VM disk and on the laptop. (3) Clean up `rm -rf "/home/ubuntu/outreach/git cherry-pick 9692e11 08d86cb"` (accidental shell paste created a stray file). (4) Audit backend for any code path that hits Supabase admin/storage with the legacy `service_role` JWT (Supabase disabled legacy keys 2026-04-27T01:47Z); the `verify-migrations` + e2e green pass implies pg-pool is fine, but `services/resumeStorage.js` and similar may still use the old key and start failing on next storage upload. (5) Real-device QA on the long-tail routes (CompanyDetail, Pipeline, Templates, Outreach) — drawer chrome works, internal page contents may still overflow on phones. (6) E2E creds for next time: `E2E_TEST_EMAIL=e2e+launch-1777279679@outreach-os.local`, `E2E_TEST_PASSWORD=VerifyOK_1777279679_xY7qZ`, `E2E_REFRESH_TOKEN=kehpo3ywzq4g` (rotates on use).

### 2026-04-27 — Deep-audit fixtures executing in CI: 26/29 passing, captcha fix pending VM deploy
- **What:** Wired the new fixture-seeding pipeline through end-to-end and ran it twice. Steps in this pass:
  1. Set GitHub secrets `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (piped from local `.env` via `gh secret set`, never echoed). First e2e run (`24981729769`) failed at the seed step with `Legacy API keys are disabled` — Supabase had disabled the legacy `eyJ…` `service_role` JWT earlier today (same rotation that broke frontend login). User pasted the new `sb_secret_…` key; Python script rewrote `SUPABASE_SERVICE_ROLE_KEY` in both [/Users/lakshmisravyarachakonda/VS CODE/email tracker/.env](.env) and [/Users/lakshmisravyarachakonda/VS CODE/outreach-local/.env](../outreach-local/.env), then re-set the GitHub secret.
  2. Run `24981938858`: seed step's first PostgREST upsert hit `42P10` (`there is no unique or exclusion constraint matching the ON CONFLICT specification`) on `user_profile?on_conflict=user_id` because the unique index is partial (`WHERE user_id IS NOT NULL`) — same constraint PR #15 worked around in the backend. Patched the seed script to GET-then-PATCH-or-INSERT the profile manually; jobs/evaluations upserts still use `on_conflict` because their indexes aren't partial.
  3. Run `24982011166`: seed succeeded (`user_id=7f3bbd9b-…`, profile patched, jobs upserted, evaluations row inserted against an Anthropic Greenhouse posting). 26/29 passed; **application-tracking Save flipped from skipped to passing**; the seeded Auto Apply dry-run failed three times with `{ok:false, platform:"greenhouse", error:"Captcha present"}` because the Anthropic board sits behind Cloudflare. Real Apify still skipped (intentional).
  4. Two-pronged fix for the captcha case: backend semantic fix (`autoApplier.js` now returns `needsReview: true` on both captcha and login walls — they're user-fixable states, parallel to profile-incomplete and unfilled-required) and seed script reorders the default boards list so it tries `gitlab,1password,duolingo,instacart,dropbox,robinhood` before Cloudflare-fronted boards.
- **Files:** [scripts/seed-e2e-fixtures.mjs:55](scripts/seed-e2e-fixtures.mjs#L55), [scripts/seed-e2e-fixtures.mjs:107](scripts/seed-e2e-fixtures.mjs#L107), [.env:1](.env#L1), [../outreach-local/.env:1](../outreach-local/.env#L1), [../outreach-local/backend/services/autoApplier.js:355](../outreach-local/backend/services/autoApplier.js#L355), GitHub Actions secrets `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (set 2026-04-27 07:17:14Z and 07:17:18Z, then `SUPABASE_SERVICE_ROLE_KEY` rotated again 07:24Z to the `sb_secret_…` value).
- **Status:** frontend `main` at `fa6e4c0` (seed picker reorder); backend `phase-4-pg` at `39b8992` (captcha/login `needsReview`); **VM still on backend `8005128`** — sandbox blocks SSH deploy without explicit auth, so the captcha fix is not live yet. With current prod code, the dry-run will keep failing whenever the picked Greenhouse URL gates with a captcha; the seed picker reorder should make that less frequent but doesn't eliminate it.
- **Follow-up:** (1) **User runs `ssh -t ubuntu@140.245.15.56 'sudo bash /home/ubuntu/outreach/deploy/update.sh'`** to ship `39b8992`. (2) Re-trigger e2e via `gh workflow run e2e` (or paste "deployed" in chat and I'll trigger + watch). Expected: 27/29 passing — the seeded Auto Apply dry-run flips to passing whenever it hits a captcha (now reported as `needsReview`) or actually fills the form (`dryRun + readyToSubmit`). (3) `E2E_RUN_REAL_APIFY` stays opt-in; flip via `gh workflow run e2e --field run_real_apify=true` when you want to spend Apify quota. (4) Two-user isolation still skipped on purpose.

### 2026-04-27 — Auto-seeded deep-audit fixtures + opt-in real-Apify
- **What:** Closed the three remaining optional deep-audit skips that the user asked to complete (two-user isolation stays skipped per prior decision). Added `scripts/seed-e2e-fixtures.mjs` — an idempotent service-role seeder that, before each Playwright run, picks a fresh Greenhouse posting from a list of stable public boards and upserts: a `user_profile` row with auto_apply_consent + valid first/last/email/phone + `resume_dir` (defaults to the VM's `/home/ubuntu/outreach/resumes`); a per-user `jobs` row for the application-tracking Save gate; and an `evaluations` row with `apply_mode='auto'`, `apply_status='queued'`, `source='e2e_seed'` for the Auto Apply dry-run gate. The seed step writes `eval_id` to `$GITHUB_OUTPUT`; the workflow now wires that into `E2E_AUTO_APPLY_EVAL_ID` (with `vars.E2E_AUTO_APPLY_EVAL_ID` as fallback) and the real-Apify gate is opt-in via a new `workflow_dispatch.run_real_apify` boolean (or `vars.E2E_RUN_REAL_APIFY=1`). Skips silently when the new secrets aren't configured so local Playwright runs still work.
- **Files:** [scripts/seed-e2e-fixtures.mjs:1](scripts/seed-e2e-fixtures.mjs#L1), [.github/workflows/e2e.yml:1](.github/workflows/e2e.yml#L1), [.env.example:38](.env.example#L38), [HANDOFF.md:70](HANDOFF.md#L70)
- **Status:** uncommitted on `main`; typecheck clean (74 files), root tests 10/10, workflow YAML parses. Seed runs as a no-op without env (verified locally).
- **Follow-up:** (1) Add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to GitHub Actions repository secrets (the same values used by `scripts/create-e2e-user.mjs`). (2) Trigger a manual `e2e` run via Actions UI; with the new secrets present, the deep-audit Save + Auto Apply dry-run rows should flip from skipped to passing. (3) When you intentionally want to spend Apify quota, run the workflow with `run_real_apify=true`; otherwise it stays skipped. (4) If the picked Greenhouse URL has many custom required fields, the dry-run will report `needsReview` rather than `dryRun:true` — both satisfy the test assertion. (5) Two-user isolation is still skipped on purpose; reverse only if you decide to run it.

### 2026-04-27 — Deep audit coverage + privacy controls deployed
- **What:** Deepened the remaining production-audit coverage. Auto Apply dry-run now fills supported ATS forms and runs the required-field scan before skipping submit. Bulk queue filters were extracted and unit-tested, Settings gained authenticated export/erase privacy controls, and the prod e2e suite now covers combined filters + privacy export plus optional gates for app-tracking Save, two-user isolation, full Auto Apply dry-run, and real Apify scraping.
- **Files:** [backend/services/autoApplier.js:364](backend/services/autoApplier.js#L364), [backend/services/bulkQueueFilter.js:1](backend/services/bulkQueueFilter.js#L1), [backend/routes/careerOps.js:1146](backend/routes/careerOps.js#L1146), [frontend/src/App.jsx:24](frontend/src/App.jsx#L24), [tests/e2e/deep-audit.spec.js:1](tests/e2e/deep-audit.spec.js#L1), [.github/workflows/e2e.yml:12](.github/workflows/e2e.yml#L12)
- **Status:** frontend/main committed + pushed as `cbdb5cf`; VM backend branch committed + pushed as `8005128`; VM fast-forwarded and PM2 manually restarted after the deploy script hit a `git log` pager; public health OK; unauth `/api/career/privacy/export` correctly returns 401; GitHub e2e run `24980521017` green with 25 passed / 4 intentional skips.
- **Follow-up:** To mark the last partial audit rows as fully verified, add the optional CI inputs named in Known gaps item 6, then rerun `e2e`. Real Apify remains intentionally opt-in because it spends quota.

### 2026-04-27 — Second-user e2e marked non-blocking
- **What:** User chose to skip the second-user write/read isolation e2e path. The test remains available behind optional `E2E_SECOND_TEST_EMAIL` / `E2E_SECOND_TEST_PASSWORD`, but it should be treated as intentionally skipped and non-blocking for the current deployment-readiness checklist.
- **Files:** [HANDOFF.md:70](HANDOFF.md#L70), [HANDOFF.md:100](HANDOFF.md#L100)
- **Status:** documentation-only update on `main`.
- **Follow-up:** Remaining optional verification gates are seeded application-tracking Save, seeded full Auto Apply dry-run, and real Apify scrape under quota.

### 2026-04-27 — GitHub e2e green: 23/23 passing on current main
- **What:** Resolved the `invalid_credentials` block. Recreated the e2e Supabase user `e2e@outreach-os.local` (id `7f3bbd9b-…`) with auto-confirm on, verified password grant works locally with `sb_publishable_…` key (`HTTP/2 200` + `access_token`). CI was still failing with the same creds because the GitHub web-UI paste introduced trailing whitespace into `E2E_TEST_PASSWORD`. Re-set both secrets via `printf '%s' … | gh secret set` for byte-exact values; re-ran e2e — `gh run` `24979149149` finished in 1m9s with **23/23 passed**.
- **Files:** GitHub Actions secrets `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD` (re-set 2026-04-27 06:02:43Z and 06:02:44Z respectively); no code changes.
- **Status:** main e2e workflow green; all 23 specs (incl. authenticated + mobile) now run and pass.
- **Follow-up:** (a) Rotate the e2e test password because it was disclosed in chat while diagnosing; reset password in Supabase + re-run `gh secret set E2E_TEST_PASSWORD`. (b) Whenever editing GitHub secrets, use `printf '%s' '<value>' | gh secret set <NAME>` instead of the web UI to avoid trailing-newline regressions. (c) Optional cleanup: bump the Node 20 actions (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`) before the June 2026 deprecation.

### ~~2026-04-27 — GitHub e2e current-main run now blocked on invalid test credentials~~ (resolved above)
- **What:** Triggered current-main e2e run `24977765259` after the password-auth workflow fix. The run is on the latest code and `E2E_SUPABASE_PUBLISHABLE_KEY` is accepted, but setup fails with Supabase `invalid_credentials`, meaning `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` are wrong, missing from the target project, or the auth user has no matching password.
- **Files:** GitHub Actions secrets `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, `E2E_SUPABASE_PUBLISHABLE_KEY`; [tests/e2e/auth.setup.js](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/tests/e2e/auth.setup.js:32)
- **Status:** no code change; e2e run result: 12 unauth/public tests passed, setup failed, 10 authenticated/mobile specs did not run.
- **Follow-up:** In Supabase Auth users, create or reset the e2e user password, then update GitHub repository secrets `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` exactly; rerun `e2e` on latest `main`.

### 2026-04-27 — E2E CI auth switched from refresh token to password grant
- **What:** Fresh GitHub e2e run `24976916697` reached Supabase with the publishable key but failed because `E2E_REFRESH_TOKEN` was invalid/rotated (`refresh_token_not_found`). Updated Playwright setup to prefer `E2E_TEST_EMAIL` + `E2E_TEST_PASSWORD` password grant for CI so each run mints a fresh session; refresh token remains only as local fallback.
- **Files:** [tests/e2e/auth.setup.js](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/tests/e2e/auth.setup.js:32), [tests/e2e/auth-env.js](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/tests/e2e/auth-env.js:8), [.github/workflows/e2e.yml](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/.github/workflows/e2e.yml:6), [.env.example](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/.env.example:35)
- **Status:** committed and pushed to `main` as `698f40a`; local checks pass: root tests 8/8, typecheck/lint clean, local e2e 12 passed / 11 skipped without auth env.
- **Follow-up:** Add GitHub repo secrets `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` for the e2e user, keep `E2E_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`, then rerun e2e. `E2E_REFRESH_TOKEN` is no longer needed for CI.

### 2026-04-26 — E2E publishable-key secret validation clarified
- **What:** GitHub e2e run failed with `Legacy API keys are disabled`, which means `E2E_SUPABASE_PUBLISHABLE_KEY` was missing or set to the old `eyJ...` anon key. Hardened Playwright auth setup to require a trimmed key starting with `sb_publishable_` before calling Supabase, so future failures point directly at the bad secret.
- **Files:** [tests/e2e/auth.setup.js](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/tests/e2e/auth.setup.js:21), [tests/e2e/auth-env.js](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/tests/e2e/auth-env.js:3)
- **Status:** committed and pushed to `main` as `8f147a1`; local checks pass: root tests 8/8, typecheck/lint clean, local e2e 12 passed / 11 skipped without auth env.
- **Follow-up:** In GitHub repository secrets, edit `E2E_SUPABASE_PUBLISHABLE_KEY` so the value is the Supabase publishable key beginning `sb_publishable_`, not the legacy anon JWT beginning `eyJ...`; rerun e2e.

### 2026-04-26 — E2E auth harness migrated off legacy Supabase anon JWT
- **What:** Removed the hardcoded legacy JWT anon key from Playwright auth setup and switched e2e session refresh to `E2E_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_ANON_KEY`. Added a guard so authenticated specs skip cleanly when local auth env is missing, plus a regression test that fails if source/test config hardcodes JWT-looking API keys.
- **Files:** [tests/e2e/auth.setup.js](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/tests/e2e/auth.setup.js:18), [tests/e2e/auth-env.js](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/tests/e2e/auth-env.js:1), [tests/security-hygiene.test.mjs](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/tests/security-hygiene.test.mjs:1), [.github/workflows/e2e.yml](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/.github/workflows/e2e.yml:11), [.env.example](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/.env.example:32)
- **Status:** committed and pushed to `main` as `0356a4c`; local checks pass: root tests 8/8, backend tests 12/12, typecheck/lint clean, frontend build clean. `npm run test:e2e` outside sandbox passes 12 unauth/public checks and skips 11 authenticated/mobile specs because this machine lacks `E2E_REFRESH_TOKEN` + `E2E_SUPABASE_PUBLISHABLE_KEY`.
- **Follow-up:** Add `E2E_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` to GitHub repo secrets alongside `E2E_REFRESH_TOKEN`, then rerun full e2e to convert authenticated/mobile rows from skipped/unverified to verified.

### 2026-04-26 — Supabase legacy API-key disable broke login; publishable-key migration started
- **What:** After legacy JWT-based Supabase API keys were disabled, OutreachOS login showed `Legacy API keys are disabled` because Vercel still had `VITE_SUPABASE_ANON_KEY` set to the old JWT `anon` key. User updated Vercel to use the new `sb_publishable_...` key.
- **Files:** [frontend/src/supabaseClient.js](/Users/lakshmisravyarachakonda/VS%20CODE/email%20tracker/frontend/src/supabaseClient.js:6), Vercel env var `VITE_SUPABASE_ANON_KEY`, Supabase Settings → API Keys
- **Status:** dashboard/env change by user; repo unchanged except this handoff entry; browser verification pending after Vercel redeploy/hard refresh.
- **Follow-up:** Verify login works after redeploy. If storage/resume operations fail, migrate backend VM `SUPABASE_SERVICE_ROLE_KEY` from legacy JWT `service_role` to a new `sb_secret_...` key and restart pm2.

### 2026-04-26 — Production-readiness audit closed (9/9 + 1 latent bug) + e2e harness shipped
- **What:** End-to-end pass through the production-readiness audit. All 9 section-N recommendations addressed:
  1. **#1–3 Cross-user backend fixes** (PR #9) — `runReclassifyUnclassified` now requires + scopes by `userId`; `/career/tracker` reads per-user `evaluations` (not the global file); `/career/tracker/raw`, `/career/reports`, `/career/reports/:filename`, and the legacy `/automations/auto-apply` return 410.
  2. **#4 JWT in URLs** (PR #10) — replaced `withAuthQuery`-wrapped report/download URLs with `fetch + blob URL`. Frontend bundle no longer contains JWT-in-URL pattern for download/report flows; SSE helpers (`findPeopleStream`, `scoreFitUrl`) intentionally retain `?access_token=` since EventSource can't send headers.
  3. **#5 Drop founder DEFAULTs** (PR #11 + manual SQL) — migration 007 dropped `DEFAULT '70df2946-…'` on the 11 per-user tables; applied to Supabase via dashboard.
  4. **#6 Playwright e2e suite** (PRs #13/#17/#18/#19, four-PR ladder) — harness, 6 happy paths, mobile viewport, auth-required regression, edge-case routing. **23/23 pass in CI** (run 24971336579, 1m1s). Nightly cron at 09:00 UTC. Two-user cross-isolation + write-path tests deferred (PR-E).
  5. **#7 Typecheck + verify-migrations scripts** (`0bb272d` on main) — `npm run typecheck` (node --check sweep + ESLint) and `npm run verify-migrations` (schema-invariant queries, optional DATABASE_URL).
  6. **#8 Privacy: demographic_consent gate** (PR #12) — `PUT /api/career/profile` now 403s on demographic writes without consent; consent withdrawal force-nulls the demographic fields. GDPR export/delete + encryption deferred until a real second user.
  7. **#9 USA-only decision** (`bc898ca` on main) — documented as intentional in README "Geographic scope"; hardcoded US filters retained as design choices.
  8. **Hygiene** — VM-side `.env.bak` and `.env.save` deleted; `.gitignore` patched (`c1793b1`) to block ad-hoc `.env.bak`/`.env.save`/`.env.swp`/`.env.orig`.
  - **Post-audit bug surfaced + fixed:** profile UPSERT was returning 500 ("ON CONFLICT specification") because migration 003's unique index is partial (`WHERE user_id IS NOT NULL`). Issue #14 + PR #15 added the predicate to the ON CONFLICT clause. Live-verified end-to-end: gate works, withdrawal erases, UPSERT returns 200.
  - **Branch unification:** PR #16 merged `phase-4-pg` (3 weeks of backend work) into `main`. Resolved `.gitignore` conflict, renamed colliding `005_storage_buckets.sql` → `008_storage_buckets.sql`, added the previously-untracked `003_per_user_isolation.sql`. Long-running PR #3 closed as superseded. `main` is now the single canonical branch.
  - **Tooling on main:** `scripts/verify-baseline.mjs` (`12f8f2a`) probes prod for audit-fix endpoints; `scripts/typecheck.mjs` + `scripts/verify-migrations.mjs` (`0bb272d`); `scripts/create-e2e-user.mjs` (PR #17) for one-time test-user provisioning via Supabase admin API.
- **Files:** see PRs #9, #10, #11, #12, #13, #15, #16, #17, #18, #19 + commits `12f8f2a`, `c1793b1`, `0bb272d`, `bc898ca`, `4894728` on main.
- **Status:** all PRs merged to `main` (`main` head: `48fbc1c`). VM fast-forwarded through `8ac20b6` post-#15; pm2 restart count 39, online. Migration 007 applied to Supabase. Vercel auto-deployed all main pushes. Nightly e2e workflow on GitHub Actions: green (run 24971336579, 23/23). Local + CI verification matrix: backend tests 12/12; frontend tests 7/7; e2e 23/23; typecheck clean (54 files); lint clean; e2e baseline endpoints flipped from `pre-fix` to `FIXED` per `scripts/verify-baseline.mjs`.
- **Follow-up:**
  1. **Rotate the JWT now** — multiple valid Supabase access_tokens (founder account) were pasted in chat transcripts during live verification. Sign out + back in on `outreach-jt.vercel.app` to invalidate.
  2. **Add `E2E_REFRESH_TOKEN` to GitHub repo secrets** — already done via `scripts/create-e2e-user.mjs`; `E2E_TEST_EMAIL` + `E2E_TEST_PASSWORD` should be saved locally (password manager) for manual rotation if the refresh token is ever invalidated.
  3. **PR-E (deferred e2e items):** two-user cross-isolation tests + write-path tests. Two-user setup needs a second admin-API user + `E2E_REFRESH_TOKEN_USER_B` secret. Write-path tests need either a staging Supabase project or in-test cleanup using the admin API.
  4. **GDPR export/delete + field-level encryption** — defer until a non-founder user is actually onboarded.
  5. **README "Known gaps" section is stale** — still lists "backend is unauthenticated" + "every user sees every other user's data". Both are resolved as of this session. Worth a docs-only follow-up PR.
  6. **`HANDOFF.md`** known-gaps list at the top hasn't been updated either; same staleness.

### 2026-04-26 — Production hardening fixes deployed
- **What:** Shipped the final audit fix pass: per-user DB uniqueness migrations, expanded Auto Apply profile + explicit consent gate, safer Auto Apply preview/queue filters, Ranked Roles visible error state, scraper failure/status refresh, mobile/tablet layout safeguards, and lint cleanup.
- **Files:** [frontend/src/App.jsx:1](frontend/src/App.jsx#L1), [frontend/src/api.js:1](frontend/src/api.js#L1), [frontend/src/components/AutoApplyPage.jsx:1](frontend/src/components/AutoApplyPage.jsx#L1), [frontend/src/components/CareerOps.jsx:1](frontend/src/components/CareerOps.jsx#L1), [frontend/src/components/CareerOpsPage.jsx:1](frontend/src/components/CareerOpsPage.jsx#L1), [frontend/src/components/ScraperPage.jsx:1](frontend/src/components/ScraperPage.jsx#L1), [frontend/src/index.css:1](frontend/src/index.css#L1), [../outreach-local/backend/routes/careerOps.js:1](../outreach-local/backend/routes/careerOps.js#L1), [../outreach-local/backend/services/autoApplier.js:1](../outreach-local/backend/services/autoApplier.js#L1), [../outreach-local/supabase/migrations/005_per_user_uniqueness.sql:1](../outreach-local/supabase/migrations/005_per_user_uniqueness.sql#L1), [../outreach-local/supabase/migrations/006_auto_apply_safety_profile.sql:1](../outreach-local/supabase/migrations/006_auto_apply_safety_profile.sql#L1)
- **Status:** committed/pushed and deployed. Frontend `main`: `6f84fda`; backend `phase-4-pg`: `5cce7a7`. Vercel routes `/apply/auto-apply` and `/apply/ranked` return HTTP 200 with the new deployment. VM fast-forwarded to `5cce7a7`, PM2 is online, public backend health is OK, and Supabase migrations 005/006 were applied. Checks passed: frontend tests 7/7, backend tests 12/12, frontend lint clean, frontend build passes with only the existing large-bundle warning, frontend/backend audits clean, backend JS syntax sweep passes.
- **Follow-up:** User should hard-refresh, save Auto Apply consent/preferences before queueing, and browser-verify `/apply/ranked`, `/apply/auto-apply`, `/discover/scraper`, `/discover/companies`, `/outreach`, and mobile layout while logged in. Apify actors may still fail if account quota/actor limits are exhausted; the app now surfaces that faster, but quota itself is external.

### 2026-04-26 — Auto-apply from Companies + Portal Scanner US-only + Resume Library cleanup
- **What:**
  - **Auto-Apply from any company (option C, both placements):** New backend endpoints `POST /api/career/auto-apply-company/:id/queue` (queue all known scraped roles) and `POST /api/career/auto-apply-company/:id/scrape-and-queue` (scrape careers page first, then queue). Both create `evaluations` rows with `apply_mode='auto'` + `apply_status='queued'`, idempotent (skip URLs already in flight, re-queue failed ones). Frontend: small `🤖 Apply` pill on every Companies list row + a full "Auto-Apply this company" panel on Company Detail with both actions and inline status.
  - **Portal Scanner US-only (Career Ops):** Career Ops Portal Scanner has its own scrape path (`scanGreenhouse/Lever/Ashby` in `routes/careerOps.js`) that didn't apply our `isUSLocation()` filter, so users kept seeing Toronto / Sydney / Bangalore. Added `isUSLocationPortal()` + `greenhouseUsLocation()` (prefers `job.offices[]` over the freeform `job.location.name`) and applied to all three scan functions.
  - **Resume Library cleanup:** Auto-Apply Setup tab was showing TWO Resume Library cards (per-user storage + legacy folder fallback). Dropped the legacy card entirely along with its `resumes`/`resumeDir` state, the `api.career.resumesLibrary()` fetch, the re-scan after Save Profile, and the now-useless "Resume folder (local path)" profile field. Auto-Apply Setup now shows one Resume Library section.
- **Files:** [frontend/src/api.js:248](frontend/src/api.js#L248), [frontend/src/components/CategoryView.jsx:394](frontend/src/components/CategoryView.jsx#L394), [frontend/src/components/CompanyDetail.jsx:521](frontend/src/components/CompanyDetail.jsx#L521), [frontend/src/components/CompanyDetail.jsx:649](frontend/src/components/CompanyDetail.jsx#L649), [frontend/src/components/CareerOps.jsx:436](frontend/src/components/CareerOps.jsx#L436), [../outreach-local/backend/routes/careerOps.js:299](../outreach-local/backend/routes/careerOps.js#L299), [../outreach-local/backend/routes/careerOps.js:696](../outreach-local/backend/routes/careerOps.js#L696)
- **Status:** committed/pushed. Frontend `main`: `06aac98` (resume library cleanup) + `4857bd9` (auto-apply UI). Backend `phase-4-pg`: `8ad6716` (US-only Portal Scanner) + `d0dfa5b` (auto-apply endpoints). Frontend build passes. **VM deploy pending** to ship `d0dfa5b` (run `ssh -t ubuntu@140.245.15.56 'sudo bash /home/ubuntu/outreach/deploy/update.sh'`). Backend audit + tests still 12/12.
- **Apify status:** `/api/health` shows `has_apify: true` which only proves the token is configured, not the credit balance. To check actual quota: open https://console.apify.com → top-right shows monthly credit balance ($5/mo on FREE) + actor-specific usage. Symptom of exhaustion is actors returning SUCCEEDED with 0 items or `Monthly usage hard limit exceeded` errors. Career Ops Portal Scanner does **not** depend on Apify (uses direct Greenhouse/Lever/Ashby APIs) so it stays alive even when Apify is broken — only the general Job Scraper at `/discover/scraper` needs Apify for LinkedIn/Wellfound/Indeed/Google Jobs.
- **Follow-up:** (1) **Deploy `d0dfa5b` to VM**. (2) Browser-verify: Companies list → click `🤖 Apply` on a company that has scraped roles → expect "Queued N role(s)" alert. Company Detail → click both Auto-Apply buttons. Portal Scanner → confirm Toronto/Sydney rows are gone. (3) Check Apify console for actual credit balance.

### 2026-04-25 — User asks #2/#5/#6/#7 shipped (full second-user enablement pass)
- **What:**
  - **#2 (Evaluate-tab resume picker, option A):** Backend gained `POST /api/career/parse-resume` (multer, parses PDF text without writing anything to DB) and `POST /api/career/evaluate` now accepts an optional `resumeText` in the body that overrides the saved default. Falls back to saved when body is empty (backward compat). Frontend Evaluate tab has a 3-pill picker (Use saved / Upload PDF / Paste text) with **no preselection** — Evaluate button is disabled until the user explicitly picks a mode and provides content. Upload runs through the new parse endpoint so the user's saved default is never overwritten.
  - **#5 (auto-apply pre-flight + form-completeness, option B + the extra ask):** Pulled `validateProfileForApply()` into a dependency-free module `services/applyValidation.js`. Adds checks for email format, phone format, and visa-sponsorship mismatch (when the JD explicitly denies sponsorship). On every apply, **after fill but before submit**, `detectUnfilledRequired()` walks the form for required-but-empty inputs/selects/textareas/radio groups/checkbox groups; if any exist, the worker flags `needs_review` with the field labels found and never clicks Submit. This addresses "few applications ask more information" — the worker now refuses to submit when custom required questions weren't auto-filled. Refactored Greenhouse/Lever/Ashby fillers to fill-only; submit selectors live in `SUBMIT_SELECTORS` so the main flow can scan in between. 7 new unit tests in `auto-apply-validation.test.mjs`.
  - **#6 (Handshake scraper, option A):** New `scrapeHandshake()` reads `HANDSHAKE_SESSION_COOKIE` from env, drives a Playwright browser with the cookie injected on the configurable `HANDSHAKE_BASE_URL` (default `app.joinhandshake.com`, user is on `https://uic.joinhandshake.com`), scrapes job cards from the search page, and applies the existing `INTERN_RE` + `isUSLocation` filters. Bounces with a clear log if redirected to `/login` (cookie expired). Registered in SOURCES; frontend ScraperPage shows it with an HS badge. **Action required from user:** paste cookie into VM `.env` as `HANDSHAKE_SESSION_COOKIE` + `HANDSHAKE_BASE_URL=https://uic.joinhandshake.com`, then `pm2 restart outreach-backend`.
  - **#7 (resume library → Supabase Storage, option B):** New `services/resumeStorage.js` wraps Supabase Storage REST API with the service-role key — no new npm dep. Three buckets (`resume-library`, `resumes`, `tailored-pdfs`), all per-user paths `<user_id>/...`. New endpoints `GET/POST/DELETE /api/career/library`. Migration `005_storage_buckets.sql` creates buckets + per-user RLS policies (`storage.foldername(name)[1] = auth.uid()::text`). Frontend Auto-Apply Setup gains a "Resume Library — per-user (cloud storage)" card above the legacy folder card with per-archetype upload buttons (aiml/ds/swe/devops/fullstack/startup/misc), file list, delete. Legacy `scanResumes()` filesystem path stays in place for backward compat — Phase 2 will switch the auto-apply worker to read from storage. Migration script `scripts/migrate-resumes-to-storage.mjs` uploads existing PDFs idempotently.
- **Files:** [frontend/src/api.js:213](frontend/src/api.js#L213), [frontend/src/components/CareerOps.jsx:1100](frontend/src/components/CareerOps.jsx#L1100), [frontend/src/components/ScraperPage.jsx:5](frontend/src/components/ScraperPage.jsx#L5), [supabase/migrations/005_storage_buckets.sql:1](supabase/migrations/005_storage_buckets.sql#L1), [../outreach-local/backend/services/applyValidation.js:1](../outreach-local/backend/services/applyValidation.js#L1), [../outreach-local/backend/services/resumeStorage.js:1](../outreach-local/backend/services/resumeStorage.js#L1), [../outreach-local/backend/services/scraper.js:725](../outreach-local/backend/services/scraper.js#L725), [../outreach-local/backend/services/autoApplier.js:107](../outreach-local/backend/services/autoApplier.js#L107), [../outreach-local/backend/routes/careerOps.js:93](../outreach-local/backend/routes/careerOps.js#L93), [../outreach-local/backend/routes/careerOps.js:259](../outreach-local/backend/routes/careerOps.js#L259), [../outreach-local/backend/tests/auto-apply-validation.test.mjs:1](../outreach-local/backend/tests/auto-apply-validation.test.mjs#L1), [../outreach-local/scripts/migrate-resumes-to-storage.mjs:1](../outreach-local/scripts/migrate-resumes-to-storage.mjs#L1)
- **Status:** committed/pushed. Frontend `main`: `f87cf27`. Backend `phase-4-pg`: `d096d3e`. Frontend tests 7/7, backend tests 12/12 (5 templates + 7 apply validation), frontend build passes, backend audit clean. **VM deploy still pending** + **Supabase migration 005 pending** (creates buckets + RLS).
- **Follow-up:** **User actions required** (in order):
  1. **Apply migration 005 in Supabase SQL Editor** — paste `supabase/migrations/005_storage_buckets.sql`. Creates 3 buckets + RLS policies. Idempotent.
  2. **VM deploy:** `ssh -t ubuntu@140.245.15.56 'sudo bash /home/ubuntu/outreach/deploy/update.sh'` ships `d096d3e`.
  3. **Add Handshake env vars to VM `.env`:** `HANDSHAKE_SESSION_COOKIE=<paste from DevTools>` + `HANDSHAKE_BASE_URL=https://uic.joinhandshake.com`, then `pm2 restart outreach-backend`.
  4. **One-time migration of existing 6 PDFs to storage:** `set -a; source /home/ubuntu/outreach/.env; set +a; USER_ID=70df2946-a46e-4b63-832c-2822cda4cf4b LOCAL_DIR=/home/ubuntu/outreach/resumes node /home/ubuntu/outreach/scripts/migrate-resumes-to-storage.mjs`. Idempotent.
  5. **Browser-verify:** (a) `/discover/evaluate` Evaluate tab — pick each of the three pills, evaluate something. (b) Auto-Apply Setup → upload a PDF to a per-user archetype slot, confirm it lists. (c) Job Scraper → click Handshake (after cookie set). (d) Queue an evaluation with profile email broken — auto-apply should flag needs_review with the bad-email reason.
  6. **Phase 2 (later):** flip `services/resumeRegistry.scanResumes()` to read from Supabase Storage instead of filesystem; route `POST /api/career/resume` to storage; thread storage download into autoApplier so Playwright reads from a temp file pulled out of the cloud bucket. Then delete on-disk PDFs.
  7. **You accidentally pasted into `.env.example`** during Handshake cookie collection — remove the `HANDSHAKE_SESSION_COOKIE =1.1.57293952.1770171320` line from `email tracker/.env.example` (it's tracked).

### 2026-04-25 — User asks #1/#3/#8 + production-readiness audit
- **What:**
  - **#1 Career Ops UX:** reordered tabs so 🔍 Portal Scanner is the default landing tab (was Evaluate). Added a **+ Auto-Apply** button on every History row (`EvalCard`); the button is disabled and shows ✓ Queued once the row's `apply_mode='auto'` and `apply_status='queued'`. Backend `GET /career/evaluations` now returns `apply_mode + apply_status` so the initial state is correct.
  - **#3 USA-only scrape filter:** added `isUSLocation()` helper in `services/scraper.js` with a comprehensive non-US country/city blocklist (Toronto/London/Bangalore/Dublin/Berlin/Paris/Sydney/etc.). Applied to LinkedIn/Wellfound/Indeed/Dice/GoogleJobs/AIJobs/RemoteAI/Hiring.cafe/Greenhouse/Lever/Ashby paths. 16/16 unit cases pass; "Remote"/"USA"/empty kept by design.
  - **#8 Multi-template support:** `normalizeOutreachTemplates()` now accepts `variants: [{ id, kind: email|linkedin, name, body }]` capped at 20, IDs auto-generated. `templateGuidance()` in `services/ai.js` appends matching variants as additional style examples so saved variants actually shape generated outreach. `TemplatesPage.jsx` gains "+ Add email variant" / "+ Add LinkedIn variant" with edit/delete + per-variant char counter. Outreach CRM header now has a ✏ Manage templates button. 5/5 backend template tests + 7/7 frontend tests pass.
  - **Audit fixes shipped:** (a) Tailor PDF was passing hardcoded `'Sravya Rachakonda'` as the candidate name even though the route loaded one from meta — fixed to pull from `user_profile.first_name + last_name` first, filename second, generic third. Same fix in `autoApplier.js`. (b) `resumeGenerator.generateResumePDF` used `waitUntil: 'networkidle0'` which can hang on stalled subresource requests; switched to `'load'` + explicit timeouts on launch / setContent / pdf so PDF failures surface fast instead of timing out. The VM had `_tmp-*.html` files written but no matching PDFs, confirming Puppeteer was the failure point.
- **Files:** [frontend/src/components/CareerOps.jsx:798](frontend/src/components/CareerOps.jsx#L798), [frontend/src/components/CareerOps.jsx:1088](frontend/src/components/CareerOps.jsx#L1088), [frontend/src/components/TemplatesPage.jsx:1](frontend/src/components/TemplatesPage.jsx#L1), [frontend/src/components/OutreachPage.jsx:75](frontend/src/components/OutreachPage.jsx#L75), [../outreach-local/backend/services/scraper.js:51](../outreach-local/backend/services/scraper.js#L51), [../outreach-local/backend/services/outreachTemplates.js:14](../outreach-local/backend/services/outreachTemplates.js#L14), [../outreach-local/backend/services/ai.js:245](../outreach-local/backend/services/ai.js#L245), [../outreach-local/backend/routes/careerOps.js:158](../outreach-local/backend/routes/careerOps.js#L158), [../outreach-local/backend/routes/careerOps.js:546](../outreach-local/backend/routes/careerOps.js#L546), [../outreach-local/backend/services/resumeGenerator.js:255](../outreach-local/backend/services/resumeGenerator.js#L255), [../outreach-local/backend/services/autoApplier.js:233](../outreach-local/backend/services/autoApplier.js#L233), [../outreach-local/backend/tests/ai-templates.test.mjs:1](../outreach-local/backend/tests/ai-templates.test.mjs#L1)
- **Status:** committed/pushed. Frontend `main`: `9e61e4e`. Backend `phase-4-pg`: `d49c6f2` + `b2d7c92` (tailor-pdf fix). Backend tests 5/5, frontend tests 7/7, frontend build passes (705KB bundle, 184KB gzipped), frontend audit clean, backend audit clean, lint exits 0 with 4 pre-existing exhaustive-deps warnings. **VM deploy still pending** — sandbox blocks per-deploy without explicit auth.
- **Follow-up:** User runs `ssh -t ubuntu@140.245.15.56 'sudo bash /home/ubuntu/outreach/deploy/update.sh'` to ship `b2d7c92`. After deploy: (a) retry Tailor PDF on an evaluation — expect a real `cv-*.pdf` to appear, no 500. (b) Browser-verify Career Ops tabs default to Portal Scanner, and History rows show the ✓ Queued state correctly. (c) Add an extra template variant on `/outreach/templates`, generate copy, confirm AI uses it. (d) Re-run a US-only scrape and check that no Toronto/London/Bangalore rows appear. **Open user-asks still requiring answers:** #2 (Evaluate-tab resume picker A/B/C), #5 (auto-apply conservative-mode A/B/C), #6 (Handshake auth A/B/C), #7 (resume library per-user A/B). The audit report below documents what already exists in each area.

### 2026-04-25 — Diagnosed + fixed LinkedIn scrape returning 0
- **What:** User clicked LinkedIn → "no companies found" even though LinkedIn had hundreds of roles. VM logs showed `valig/linkedin-jobs-scraper → 100 items` but `[linkedin] returned 0 results`. Inspected the actor's dataset directly (`mCyre4ZwR4MkGjz0F`) — actor returned 100 unrelated full-time roles ("Director, Customer Success", "HR Assistant", …); `valig` ignored the `intern 2026` keyword. The post-fetch `INTERN_RE` filter correctly dropped them all, but the for-loop then `return [] `'d instead of falling through to the next actor (`curious_coder`, which uses LinkedIn's own search URL and would honor the keyword) or to the Greenhouse fallback. Same trap in indeed + google_jobs handlers. Fixed: when `items.length > 0 && results.length === 0`, log sample title and `continue` to next attempt.
- **Files:** [../outreach-local/backend/services/scraper.js:495](../outreach-local/backend/services/scraper.js#L495), [../outreach-local/backend/services/scraper.js:594](../outreach-local/backend/services/scraper.js#L594), [../outreach-local/backend/services/scraper.js:697](../outreach-local/backend/services/scraper.js#L697)
- **Status:** committed + pushed on `phase-4-pg`: `675c4cc`. `node --check` passes. **VM deploy blocked by sandbox (auth needed per deploy).**
- **Follow-up:** User runs `ssh -t ubuntu@140.245.15.56 'sudo bash /home/ubuntu/outreach/deploy/update.sh'`, then retries the LinkedIn scrape from `/discover/scraper`. Expected: either `curious_coder` returns intern roles via LinkedIn's keyword-honoring search URL, or all actors fall through to the Greenhouse direct-fetch fallback (which already works — earlier logs showed it returning 19 results). If `curious_coder` also produces non-intern items, we have a deeper "actors don't honor keyword on LinkedIn" problem and should consider switching to LinkedIn's public job-search RSS feed.

### 2026-04-25 — VM backend deploy of stabilization pass
- **What:** User ran `sudo bash /home/ubuntu/outreach/deploy/update.sh` over SSH on the Oracle VM. Fast-forwarded `phase-4-pg` from the previously deployed tip up to `43d9124` (templates + audit stabilization). pm2 restarted, deploy script's health-check loop reported healthy on attempt 2, and public `https://outreach-jt.duckdns.org/api/health` returns `{"status":"ok","auth_mode":"enforce"}`.
- **Files:** [../outreach-local/deploy/update.sh:1](../outreach-local/deploy/update.sh#L1)
- **Status:** live on VM at commit `43d9124`. The Templates feature backend (`/api/generate/templates`, `meta.outreach_templates`, AI prompt style anchors) and the Company Detail `meta` upsert conflict-target fix are now active in prod.
- **Follow-up:** Browser-verify as `lakshmisravyar@gmail.com`: (a) save email + LinkedIn templates on `/outreach/templates`, then generate copy and confirm saved style is used; (b) Company Detail score-fit + per-company resume upload/delete; (c) `/apply/ranked` (ErrorBoundary will now surface stack if it crashes); (d) Outreach CRM shows 36 contacts.

### 2026-04-25 — Production-readiness audit pass + narrow fixes
- **What:** Ran repository/feature audit checks across frontend and deployed backend worktree. Fixed root `npm test` script, Vite ESM lint issue, Company Detail authenticated fetch bypasses for score-fit + per-company resume upload/delete, mounted the existing ErrorBoundary to avoid blank page crashes, and fixed backend `meta` upsert conflict target for company resume PDF parsing.
- **Files:** [package.json:16](package.json#L16), [frontend/vite.config.js:5](frontend/vite.config.js#L5), [frontend/src/components/CompanyDetail.jsx:1144](frontend/src/components/CompanyDetail.jsx#L1144), [frontend/src/main.jsx:5](frontend/src/main.jsx#L5), [tests/api-client.test.mjs:67](tests/api-client.test.mjs#L67), [../outreach-local/backend/routes/companies.js:59](../outreach-local/backend/routes/companies.js#L59)
- **Status:** committed/pushed with the stabilization commits: frontend `main` `329715c`, backend `phase-4-pg` `43d9124`; tests/build/audits now pass as recorded below. Backend deploy to Oracle VM was attempted but blocked by the tool approval layer, so VM is still on pre-`43d9124` until user runs deploy manually.
- **Follow-up:** Run `sudo bash /home/ubuntu/outreach/deploy/update.sh` on the VM to ship backend changes, then browser-verify `/apply/ranked`, Company Detail Career Ops score-fit/resume upload/delete, and scraper/status flows. Plan follow-up migration for per-user UNIQUE constraints before relying on clean second-user imports.

### 2026-04-25 — Stabilization pass: templates, login tabs, audits
- **What:** Completed the Templates feature end-to-end and turned the login form into Sign in / Sign up tabs. `/outreach/templates` now loads/saves per-user email + LinkedIn templates via `/api/generate/templates`, stores them in `meta`, and generation routes pass saved templates into the AI prompt as style anchors. Added frontend API tests and backend template normalization tests. Generated/tracked backend and frontend lockfiles so audits are reproducible.
- **Files:** [frontend/src/components/TemplatesPage.jsx:1](frontend/src/components/TemplatesPage.jsx#L1), [frontend/src/components/Login.jsx:41](frontend/src/components/Login.jsx#L41), [frontend/src/api.js:134](frontend/src/api.js#L134), [tests/api-client.test.mjs:77](tests/api-client.test.mjs#L77), [../outreach-local/backend/routes/generate.js:18](../outreach-local/backend/routes/generate.js#L18), [../outreach-local/backend/services/outreachTemplates.js:1](../outreach-local/backend/services/outreachTemplates.js#L1), [../outreach-local/backend/tests/ai-templates.test.mjs:1](../outreach-local/backend/tests/ai-templates.test.mjs#L1)
- **Status:** committed/pushed. Frontend `main`: `329715c`. Backend `phase-4-pg`: `43d9124`. `npm test` passes 7/7, `npm test --prefix backend` passes 2/2, frontend build passes, frontend lint exits 0 with 4 warnings, frontend audit passes, backend audit passes, backend changed files pass `node --check`. Local Vite preview served `/apply/ranked`, `/outreach/templates`, `/discover/scraper`, and `/discover/companies` with HTTP 200. Backend deploy to VM was blocked by tool approval, not by code.
- **Follow-up:** Backend deploy still required: `sudo bash /home/ubuntu/outreach/deploy/update.sh` on the VM. Browser-verify saving templates as a logged-in user and generating email/LinkedIn copy uses the saved style after Vercel deploy + VM deploy.

### 2026-04-25 — Companies counts render from cache
- **What:** Removed the visible loading/dash pass on `/discover/companies` by caching stats + category counts per user in `sessionStorage`, seeding from the parent App stats snapshot, and refreshing counts in the background.
- **Files:** [frontend/src/components/CompanyDashboard.jsx:44](frontend/src/components/CompanyDashboard.jsx#L44), [frontend/src/components/CompanyDashboard.jsx:69](frontend/src/components/CompanyDashboard.jsx#L69), [frontend/src/App.jsx:341](frontend/src/App.jsx#L341)
- **Status:** committed on `main`: `0b59c6d`; `npm run build --prefix frontend` passed; not browser-verified after Vercel deploy.
- **Follow-up:** After Vercel deploy, visit `/discover/companies` once to seed the cache, then navigate away/back or refresh in the same tab and confirm the page does not show the intermediate loading/dash state.

### 2026-04-25 — Companies flicker + Job Scraper source fix
- **What:** Prevented the Companies page from briefly rendering real-looking zero counts by tracking stats/category loaded flags. Routed Job Scraper per-source buttons through canonical `/jobs/scrape` so results land in the main `jobs` table, added selected-source backend support, added a LinkedIn direct Greenhouse fallback when Apify actors fail, and kept legacy `/companies/scrape/:src` from dropping `name`-shaped results.
- **Files:** [frontend/src/components/CompanyDashboard.jsx:48](frontend/src/components/CompanyDashboard.jsx#L48), [frontend/src/components/ScraperPage.jsx:43](frontend/src/components/ScraperPage.jsx#L43), [frontend/src/api.js:106](frontend/src/api.js#L106), [../outreach-local/backend/routes/jobs.js:19](../outreach-local/backend/routes/jobs.js#L19), [../outreach-local/backend/services/scraper.js:519](../outreach-local/backend/services/scraper.js#L519), [../outreach-local/backend/services/scraper.js:1172](../outreach-local/backend/services/scraper.js#L1172), [../outreach-local/backend/routes/companies.js:293](../outreach-local/backend/routes/companies.js#L293)
- **Status:** frontend committed/pushed on `main`: `4584276`; backend committed/pushed/deployed on `phase-4-pg`: `d0016ee`; `npm run build --prefix frontend` passed; `node --check` passed for changed backend files; VM deploy completed and public health returned `ok`.
- **Follow-up:** Wait for Vercel deploy, hard-refresh `/discover/companies` and `/discover/scraper`, then retry LinkedIn/GitHub/Google source buttons while logged in.

### 2026-04-25 — Dashboard surfaces auto-apply queue counts
- **What:** Compact card above the "Last scrape" widget on the Dashboard now shows queue counts (Needs Review / Queued / Submitted / Failed / Unsupported). Border + label flip red when `needs_review > 0` so profile-incomplete items are visible without navigating into Career Ops. Hidden entirely when nothing is in flight. Click → `/career-ops`.
- **Files:** [frontend/src/components/DashboardPage.jsx:48](frontend/src/components/DashboardPage.jsx#L48)
- **Status:** committed and pushed `main`: `8d87bf2`. Build passes. No backend changes — reads from the existing `/api/career/auto-apply-queue` endpoint.

### 2026-04-25 — Nightly auto-apply pipeline + visible queue (DEPLOYED)
- **What:** End-to-end nightly automation. Cron at 07:00 UTC iterates over every user with `nightly_pipeline_settings.enabled=true` and runs the orchestrator: scan Greenhouse/Lever/Ashby (per `roleType`) → skip URLs already evaluated → evaluate new ones via OpenAI → if `score >= minScore` → set apply_mode=auto + apply_status=queued → run Playwright worker against up to `maxApps` queued items. Worker uses **library resume** (no per-role tailoring) when `useLibraryResume=true` so the pipeline runs fast and unattended. Profile-incomplete items now flag `needs_review` instead of `failed` so the user can fix and retry.
- **New endpoints:** GET `/api/career/auto-apply-queue` (queue + counts), GET/PUT `/api/career/nightly-settings`, POST `/api/career/nightly-pipeline`, GET `/api/career/nightly-pipeline/last-run`. Orchestrator extracted to [services/nightlyPipeline.js](../outreach-local/backend/services/nightlyPipeline.js) so route + cron share code. `scanGreenhouse/Lever/Ashby` were promoted from file-local to exported in `routes/careerOps.js`.
- **autoApplier extensions:** new `STATUS.needs_review`; `useLibraryResume` flag on `processOneEvaluation` skips tailored PDF gen and picks straight from the resume library by archetype; `runQueueOnce` accepts both positional `userId` and `{userId}` object forms (backward-compat); summary now includes `needsReview` count.
- **Settings (per-user):** enabled (default off), roleType (intern/fulltime/all, default intern), minScore (0–100, default 85), maxApps (1–200, default 50), useLibraryResume (default true). Stored in `meta.nightly_pipeline_settings`.
- **UI:** Auto-Apply Setup tab now leads with two new cards. (1) "Queue & Status" — every flagged role grouped by status (Needs Review / Queued / Submitted / Failed / Unsupported), each item shows company, role, grade, score, source (Manual eval / Bulk eval / 🌙 Nightly / Portal Scanner), platform, and date; needs_review items show their error inline. (2) "🌙 Nightly Pipeline" — enable toggle, role-type selector, min-score / max-apps inputs, Save Settings, and "Run Pipeline Now" button for immediate manual trigger; shows last run summary inline.
- **Files:** [../outreach-local/backend/routes/careerOps.js:626](../outreach-local/backend/routes/careerOps.js#L626), [../outreach-local/backend/services/autoApplier.js:30](../outreach-local/backend/services/autoApplier.js#L30), [../outreach-local/backend/services/nightlyPipeline.js:1](../outreach-local/backend/services/nightlyPipeline.js#L1), [../outreach-local/backend/server.js:434](../outreach-local/backend/server.js#L434), [frontend/src/components/CareerOps.jsx:435](frontend/src/components/CareerOps.jsx#L435)
- **Status:** committed `phase-4-pg`: `2890bf0`; `main`: `3682c1b`. Deployed to VM (healthy attempt 2). Build passes.
- **Follow-up:** **User must enable** the toggle from Auto-Apply Setup before the cron will fire — defaults to off for safety. After enabling, first cron run is at 07:00 UTC (≈2am Central). Manual "Run Pipeline Now" works immediately. Monitor `pm2 logs` for `[nightly-cron]` and `[nightly]` lines to confirm scheduled execution.

### 2026-04-25 — Portal Scanner role-type filter + persistence + bulk evaluate + Add-to-Queue button
- **What:** Career Ops UX bundle responding to four user asks at once.
  1. **Portal Scanner role-type filter** — segmented control (🎓 Internship / 💼 Full-Time / 📋 All) drives the existing backend `roleType` param. Backend already supported `intern|fulltime|all`; frontend just exposed it. Changing the toggle auto-rescans.
  2. **Portal Scanner persistence** — sessionStorage cache keyed `careerOps:portalScan:v2` (1h TTL) preserves jobs/bySource/roleType across tab switches. Header shows "last scanned 5m ago" and the button label flips to "↻ Re-scan" when cached results exist.
  3. **Bulk evaluate scanned roles** — "Evaluate N roles" button on the Portal Scanner triggers `api.career.batchEvaluate` against the visible filtered list (capped at 10 per backend limit). Inline progress banner reports outcome and points the user to History.
  4. **"Add to Auto-Apply Queue" button on EvaluationReport** — queue-without-running path. Sets `apply_mode='auto'` + `apply_status='queued'` via existing PATCH endpoints. Hidden once queued/submitted. Resume archetype matching still happens at run-time inside the worker (`pickResumeForRole` in `services/resumeRegistry.js`) — picks from the user's 6 archetype PDFs based on the role archetype detected by the evaluator.
- **Files:** [frontend/src/api.js:227](frontend/src/api.js#L227), [frontend/src/components/CareerOps.jsx:628](frontend/src/components/CareerOps.jsx#L628), [frontend/src/components/CareerOps.jsx:123](frontend/src/components/CareerOps.jsx#L123)
- **Status:** committed and pushed on `main`: `a415306` + `b6e2030`. Build passes. **No backend changes** — all reuses existing endpoints, so no VM deploy needed; Vercel auto-deploys.
- **Follow-up:** After Vercel deploys, verify (a) Portal Scanner filter works, (b) cache persists across History/Evaluate tab navigation, (c) bulk evaluate routes to History, (d) "Add to Auto-Apply Queue" button shows up when status is not_started.

### 2026-04-25 — Broader role queries + per-source breakdown + new-company names (DEPLOYED)
- **What:** Three things the user asked for in one pass.
  1. **Broadened ALL scraper default queries** so internships outside CS get returned. `getSearchTerms` defaults to `['intern 2026', 'internship 2026', 'new grad 2026']` instead of `'software engineer intern 2026'`. Subcategory + category branches drop the SWE prefix too — e.g. picking "Marketing & Creative" now searches `Marketing intern 2026`, not `Marketing software engineer intern`. scraper.js linkedin/wellfound/indeed/dice/google_jobs and apify.js linkedin/google_jobs/wellfound/yc-Serper-fallback all role-agnostic now. SEARCH_TERMS_MAP role-specific entries (Quant, IB, etc.) intentionally untouched.
  2. **Persist newCompanyNames (top 25) + errors** into `meta.last_scrape_summary` alongside the count fields.
  3. **Dashboard "Last scrape" card now answers two questions** at a glance: (a) per-source pills `linkedin: 100, wellfound: 12, github: 50` with red pills for failed sources (so user sees which scrapers actually work), (b) first 8 newly-added company names as clickable links to `/companies?search=<name>` with `+N more` for the rest.
- **Files:** [../outreach-local/backend/services/scraper.js:114](../outreach-local/backend/services/scraper.js#L114), [../outreach-local/backend/services/apify.js:212](../outreach-local/backend/services/apify.js#L212), [../outreach-local/backend/routes/jobs.js:144](../outreach-local/backend/routes/jobs.js#L144), [frontend/src/components/DashboardPage.jsx:117](frontend/src/components/DashboardPage.jsx#L117)
- **Status:** committed `phase-4-pg`: `60615c5`; `main`: `5503dab`. Deployed to VM (healthy attempt 2). Build passes.
- **Follow-up:** User runs an all-sources scrape; Dashboard card will show per-source breakdown so any silently-broken scraper is visible. Names of new companies surfaced inline. If LinkedIn now returns 1000 results because the broader query catches all intern types (could be too noisy), revisit — may want to add a role-type selector in the Job Scraper UI.

### 2026-04-25 — Honest scrape feedback + Last-scrape Dashboard widget (DEPLOYED)
- **What:** "+0 companies added" was misleading — scrapers actually return 100 results that all dedupe against the user's existing 1,499-company DB. Now backend `/api/jobs/scrape` returns `found` (total returned by all scrapers this run) + `alreadyInDb` (found - added) and persists the summary into `meta.last_scrape_summary`. Frontend ScraperPage reads normalized fields and shows: `found 100 (+5 new, 95 already in DB)` / `found 100 — all already in DB` / `+5 companies added` / `no companies found` instead of always `+0`. Dashboard gained a "Last scrape" card under the stats row showing age + found/added/inDb counts, fed by `stats.lastScrape` from `/api/stats`.
- **Files:** [../outreach-local/backend/routes/jobs.js:133](../outreach-local/backend/routes/jobs.js#L133), [../outreach-local/backend/server.js:160](../outreach-local/backend/server.js#L160), [frontend/src/components/ScraperPage.jsx:39](frontend/src/components/ScraperPage.jsx#L39), [frontend/src/components/DashboardPage.jsx:117](frontend/src/components/DashboardPage.jsx#L117)
- **Status:** committed `phase-4-pg`: `ee4b6e2`; `main`: `e214c80`. Deployed to VM (healthy attempt 2). Build passes.
- **Follow-up:** After Vercel auto-deploys frontend, run a scrape — Activity Log will read honestly and the Dashboard will get a "Last scrape · just now · Found 100 · 100 already in DB" card.

### 2026-04-25 — LinkedIn scraper actor schema realigned + burn detection extended (DEPLOYED)
- **What:** After the user's Apify key swap (`marbled_geothermal` → `charitable_raisin`), the burn errors stopped but every LinkedIn scrape still returned 0 — Apify changed two things on their side: (1) `bebity/linkedin-jobs-scraper` flipped from free-trial to paid-only, (2) `curious_coder/linkedin-jobs-scraper` changed input schema to require `urls: [...]` instead of `keyword`. The Job Scraper page calls `services/scraper.js` (separate from `services/apify.js`), and only `apify.js` had been updated to the new schemas. Patched `scraper.js`: primary actor → `valig` (free, keyword schema, was working pre-burn), fallback → `curious_coder` with new `urls` schema, dropped `bebity`. Also wired `noteApifyError` into all 4 actor catches in `scraper.js` (linkedin/wellfound/indeed/google_jobs) plus the central `runApifyActor` wrapper, so the sidebar burn indicator now covers BOTH scraper paths. Required adding `export` to `noteApifyError` in `apify.js` (forgot in `5660817`; first deploy crashed with `does not provide an export`).
- **Files:** [../outreach-local/backend/services/scraper.js:1](../outreach-local/backend/services/scraper.js#L1), [../outreach-local/backend/services/scraper.js:469](../outreach-local/backend/services/scraper.js#L469), [../outreach-local/backend/services/apify.js:30](../outreach-local/backend/services/apify.js#L30)
- **Status:** committed `phase-4-pg`: `d8bf3b4` + `fa28694`; live on VM (deploy script polled health check successfully on attempt 2 — proving the deploy-script polling fix from `c8c6d06` works in practice). Backend stable, pm2 PID 42411.
- **Follow-up:** User should retry LinkedIn scrape from the Job Scraper page. If valig works on the new account, expect new companies. If it still 0s, the new account may already be quota-limited (Apify FREE tier's $5 monthly cap is small) — the sidebar Apify dot will go red within seconds and we know the burn detection now covers `scraper.js` too.

### 2026-04-25 — VM Apify token swap (user-side)
- **What:** User pasted the new `apify_api_kzd...` token (`charitable_raisin` account) and the VM .env was updated (likely user-side; my SSH sed was sandbox-blocked but the VM logs subsequently showed the new account responding). Old `marbled_geothermal` quota-burn errors stopped appearing.
- **Status:** verified live — pm2 on `5660817` then later `fa28694`, Apify auth no longer 403s.
- **Follow-up:** New account is also FREE plan; will burn through actor credits eventually. Burn-detection sentinel will now flip the sidebar dot red the moment that happens (covers both apify.js and scraper.js paths).

### 2026-04-25 — Apify quota-burn surfaces in /credits/status (DEPLOYED)
- **What:** Apify's `/v2/users/me` reports the *account's* platform credit balance (reliably 0/0 on FREE accounts) — it doesn't expose the actor-side monthly limits that actually trip with `Monthly usage hard limit exceeded`. So `checkApify()` couldn't detect a burn and the sidebar Apify dot stayed green while every scrape failed silently. Fixed: module-level `apifyQuotaBurn` sentinel in `services/apify.js` is bumped by `noteApifyError(actor, err)` whenever an actor catch fires with a quota-shaped error (regex matches `hard limit|monthly usage|quota|exhausted|insufficient.*credit|402|payment required`). `creditChecker.checkAllCredits()` overlays this on top of the cached result every read — recent burns (<6h) flip `apify.critical = true` regardless of the 30-min result cache. Wired into all actor catch paths (linkedin, wellfound, people/linkedin, profile-scrape) plus `runActor()` itself as defense in depth.
- **Files:** [../outreach-local/backend/services/apify.js:13](../outreach-local/backend/services/apify.js#L13), [../outreach-local/backend/services/creditChecker.js:7](../outreach-local/backend/services/creditChecker.js#L7)
- **Status:** committed `phase-4-pg`: `5660817`; live on VM (verified `noteApifyError` × 7 in deployed apify.js, pm2 stable, `/api/health` ok).
- **Follow-up:** Sidebar Apify dot will turn red within seconds of the next quota-failed scrape. Stays red 6h post-burn (or until pm2 restart). No manual monitoring needed.

### 2026-04-25 — Sidebar rename + Apify scrape diagnosis
- **What:** User asked to rename sidebar "Evaluate a Role" to "Career Ops" since `/discover/evaluate` already houses the full Career Ops tab UI (Evaluate / Portal Scanner / Batch / History / Auto-Apply Setup). Single label change, route untouched.
- **Files:** [frontend/src/App.jsx:258](frontend/src/App.jsx#L258)
- **Status:** committed and pushed on `main`: `3e570ef`. Build passes.
- **Apify finding (open issue):** User reported "no jobs are getting scraped". Backend stderr shows `Monthly usage hard limit exceeded` on every Apify actor — LinkedIn (valig, bebity, curious_coder) AND Wellfound (curious_coder, clearpath, apify/rag-web-browser). New Apify token rotated to fresh `marbled_geothermal` FREE account validates against Apify API but `monthlyUsageLimitUsd` reports 0 — free tier credits insufficient for these actors. Greenhouse fallback IS working (returned 92 roles per logs at 03:11/03:13), so portal-scan paths still surface jobs. Real fix: upgrade Apify to a paid plan, switch to cheaper actors, or accept Greenhouse-only coverage. Not a code bug.
- **Follow-up:** Decision needed on Apify spend vs scrape coverage — if you want LinkedIn + Wellfound back, we need a paid plan or different actors.

### 2026-04-25 — Deploy script health-check race fixed
- **What:** User ran `update.sh` and got "Backend not healthy — connection refused" on localhost:3001 after pm2 restart. Backend was actually live (`/api/health` returned ok within seconds; pm2 process stable), so it was a script race: pm2 restart returns before Node binds the port. Replaced the one-shot `curl` with a 15-attempt × 2s poll (30s budget).
- **Files:** [../outreach-local/deploy/update.sh:59-71](../outreach-local/deploy/update.sh#L59-L71)
- **Status:** committed and pushed on `phase-4-pg`: `c8c6d06`. `bash -n deploy/update.sh` passed.
- **Follow-up:** The fix only applies to the deploy **after** the next one (since `update.sh` git-pulls into itself mid-run and the active shell already loaded the old script). The next run may still print the race error; the run after that will be clean.

### 2026-04-25 — VM redeploy with security fix
- **What:** User authorized + ran `update.sh` on VM. Fast-forwarded `phase-4-pg` from `86eaeed` → `54ddf62`, pm2 restarted. Script's localhost health check raced the boot (false alarm), but public `/api/health` returned ok and pm2 was stable at 34s.
- **Files:** [../outreach-local/backend/routes/careerOps.js:823](../outreach-local/backend/routes/careerOps.js#L823), [../outreach-local/backend/routes/careerOps.js:837](../outreach-local/backend/routes/careerOps.js#L837), [../outreach-local/backend/routes/jobs.js:1409](../outreach-local/backend/routes/jobs.js#L1409)
- **Status:** live on VM at commit `54ddf62`. The 3 JOIN scoping defenses are now in prod.
- **Follow-up:** Browser-verify `/apply/ranked` and Job Dashboard "Recent Evaluations" links still work as `lakshmisravyar`.

### 2026-04-25 — Full-app audit + 4 fixes
- **What:** End-to-end audit of repo state, builds, JWT coverage, per-user isolation, frontend↔backend contract, secret hygiene, and live VM. Fixed 4 issues uncovered.
  1. **JWT bypass** in [JobDashboard.jsx:192](frontend/src/components/JobDashboard.jsx#L192) — Recent Evaluations links rendered raw `<a href="/api/career/evaluations/X/report.html">` which 401s in enforce mode. Swapped to `api.career.reportHtmlUrl(e.id)` (same `withAuthQuery` helper used by CareerOps/Pipeline/CompanyDetail).
  2. **Per-user isolation** (defense-in-depth) — 3 queries JOIN'd `jobs` without `AND j.user_id = $X`. The driving table's user_id was scoped, so leakage required cross-user FK rows that shouldn't exist, but DB-level defense-in-depth was missing. Fixed in:
     - `GET /api/career/stats` — top-pick subquery
     - `GET /api/career/ranked` — ranked applications
     - `POST /api/jobs/contacts/:id/generate` — contact + company lookup
  3. Apify key on VM **validated** against `https://api.apify.com/v2/users/me`: length 46, prefix `apify_api_`, account `marbled_geothermal` (FREE plan). User did rotate the VM-side key (auto-generated username = fresh account). pm2 logs from earlier today still show "Monthly usage hard limit exceeded" on LinkedIn actors, but those pre-date the rotation; not yet retried post-restart.
  4. Lint debt unchanged — 47 errors are pre-existing `react-hooks/set-state-in-effect`, unused vars, `vite.config.js __dirname`. Documented as architectural follow-up, not addressed.
- **Audit clean:**
  - Frontend↔backend API contract: 80+ method/path pairs, zero mismatches.
  - Secret scan: `.env` properly gitignored in both repos. No tracked credentials, only documented test-account UUID `459b9b5b...` in HANDOFF (intentional). `deploy/env.template` uses placeholders.
  - Backend syntax sweep: every `.js` under `backend/` passes `node --check`.
  - Frontend build: passes (677kb bundle, gzipped 178kb — could be code-split, low priority).
  - Live VM: `pm2` stable, `/api/health` ok, `auth_mode=enforce`.
- **Files:** [frontend/src/components/JobDashboard.jsx:192](frontend/src/components/JobDashboard.jsx#L192), [../outreach-local/backend/routes/careerOps.js:823](../outreach-local/backend/routes/careerOps.js#L823), [../outreach-local/backend/routes/careerOps.js:837](../outreach-local/backend/routes/careerOps.js#L837), [../outreach-local/backend/routes/jobs.js:1409](../outreach-local/backend/routes/jobs.js#L1409)
- **Status:** committed and pushed. Frontend on `main`: `45128da`. Backend on `phase-4-pg`: `54ddf62`. Builds + node --check pass. **Backend NOT yet redeployed** — sandbox blocked the auto-deploy for newly-committed security changes; needs explicit user authorization.
- **Follow-up:** Run `sudo bash /home/ubuntu/outreach/deploy/update.sh` on VM to ship the 3 isolation fixes. After that, browser-verify (a) Job Dashboard "Recent Evaluations" links open the report instead of 401-ing, (b) `/apply/ranked` still loads as `lakshmisravyar`. Apify scraping: if it still fails, check Apify dashboard for actor-specific monthly limits (key itself is valid).

### 2026-04-25 — VM backend deploy for sort/filter fix
- **What:** Ran `sudo bash /home/ubuntu/outreach/deploy/update.sh` on the Mumbai VM (user-authorized SSH). Fast-forwarded `phase-4-pg` from `53f0767` → `86eaeed`, pm2 restarted `outreach-backend`. The in-script localhost health check raced the boot (connection-refused at 2s uptime), but the public `https://outreach-jt.duckdns.org/api/health` returned `{"status":"ok","auth_mode":"enforce"}` four seconds later and pm2 was stable at 22s/247mb.
- **Files:** [../outreach-local/backend/routes/unified.js:50](../outreach-local/backend/routes/unified.js#L50)
- **Status:** live on VM at commit `86eaeed`. Top Companies sort + source/status filters now active in prod.
- **Follow-up:** Note the deploy script's localhost-health-check still races boot — could bump to a 5s sleep + retry loop, or trust the public health check that runs separately. Low priority. Browser-verify `/companies/[category]` sort dropdown works across all pages.

### 2026-04-25 — Quick-wins sweep (4 deferred items)
- **What:** Cleared the four deferred green-pile items in one pass.
  1. **Top Companies filter** — sort dropdown only re-ordered the loaded 50 rows and `source`/`status` filter dropdowns were silently dropped by the backend. Added `sort` (hiring|contacts|recent|az|za) + `source` + `status` query params to `/api/unified/companies`, frontend now passes them and refetches via useEffect dep on `sortBy`.
  2. **Companies page 0-flicker** — initial render showed "0 companies" + every category card at "0" before stats/categoryCounts resolved. Switched `catCounts` initial state from `{}` to `null` so the renderer can distinguish "still loading" from "loaded empty"; show "Loading…" / "—" placeholders during load.
  3. **Career Ops resume preload** — "Your Resume" section was always visible at the top of every tab including Evaluate. Now only renders on Auto-Apply Setup tab or when user has no resume yet.
  4. **Job Dashboard perf** — first paint blocked on `/dashboard/job-metrics`. Added sessionStorage SWR cache (5min TTL): instant first paint on revisit, background refresh shown by spinner in Refresh button.
- **Files:** [../outreach-local/backend/routes/unified.js:50-95](../outreach-local/backend/routes/unified.js#L50-L95), [frontend/src/api.js:151](frontend/src/api.js#L151), [frontend/src/components/CategoryView.jsx:247](frontend/src/components/CategoryView.jsx#L247), [frontend/src/components/CompanyDashboard.jsx:47](frontend/src/components/CompanyDashboard.jsx#L47), [frontend/src/components/CareerOps.jsx:936](frontend/src/components/CareerOps.jsx#L936), [frontend/src/components/JobDashboard.jsx:48](frontend/src/components/JobDashboard.jsx#L48)
- **Status:** committed and pushed. Frontend on `main`: `463f756`, `7f42c6d`, `6cf20ad`, `c2eabdb`. Backend on `phase-4-pg`: `86eaeed`. `npm run build --prefix frontend` and `node --check backend/routes/unified.js` both passed. Not browser-tested.
- **Follow-up:** **VM backend deploy required** for Top Companies filter to actually work — `sudo bash /home/ubuntu/outreach/deploy/update.sh` on the Mumbai VM. Frontend already pushed; Vercel will auto-deploy. After both, browser-verify on `/companies/[category]` (sort dropdown should reshuffle results across all pages, not just current page) and on `/dashboard` (no "0 companies" flash before counts load).

### 2026-04-25 — VM backend deployed for stats + Apify status
- **What:** Fast-forwarded the Oracle VM checkout from the accidental `origin/local-backup` reset back to `origin/phase-4-pg`, restarted `pm2` app `outreach-backend`, and confirmed public backend health is `ok`.
- **Files:** [../outreach-local/backend/server.js:133](../outreach-local/backend/server.js#L133), [../outreach-local/backend/services/creditChecker.js:44](../outreach-local/backend/services/creditChecker.js#L44)
- **Status:** live VM is on `phase-4-pg` commit `f929862` for runtime code; `https://outreach-jt.duckdns.org/api/health` returned `{"status":"ok",...,"auth_mode":"enforce"}`.
- **Follow-up:** User should hard-refresh Vercel app and verify Companies contacts show total contact count/subtext and API Status marks Apify red or amber when quota/API failure is reported.

### 2026-04-25 — Backend deploy script corrected
- **What:** Fixed `deploy/update.sh` so future VM deploys fast-forward `origin/phase-4-pg` instead of resetting to `origin/local-backup`; dependency install now runs only when backend package files change and uses legacy peer handling for the existing OpenAI/Zod peer conflict.
- **Files:** [../outreach-local/deploy/update.sh:19](../outreach-local/deploy/update.sh#L19)
- **Status:** committed and pushed on `phase-4-pg`: `53f0767`; VM checkout also fast-forwarded to `53f0767`; `bash -n deploy/update.sh` passed; VM no-op deploy script run returned `Already up to date`.
- **Follow-up:** Future backend deploys can use `sudo bash /home/ubuntu/outreach/deploy/update.sh` again without rolling the VM back to `local-backup`.

### 2026-04-25 — Companies contacts count + Apify status
- **What:** Fixed misleading Companies/Dashboard contact stats by enriching frontend stats from job metrics and patched backend `/api/stats` to return total contacts plus email/LinkedIn counts. Wired API Status to `/api/credits/status` so Apify turns red on quota/error instead of green just because a token exists.
- **Files:** [frontend/src/api.js:70](frontend/src/api.js#L70), [frontend/src/components/CompanyDashboard.jsx:151](frontend/src/components/CompanyDashboard.jsx#L151), [frontend/src/App.jsx:130](frontend/src/App.jsx#L130), [../outreach-local/backend/server.js:133](../outreach-local/backend/server.js#L133), [../outreach-local/backend/services/creditChecker.js:44](../outreach-local/backend/services/creditChecker.js#L44)
- **Status:** frontend committed on `main`: `346c0b2`; backend committed on `phase-4-pg`: `f929862`; `npm run build --prefix frontend`, `node --check backend/server.js`, and `node --check backend/services/creditChecker.js` passed.
- **Follow-up:** Branches were pushed and VM backend was deployed later on 2026-04-25. Browser-verify after Vercel deploy.

### 2026-04-27 — Pre-launch hardening pushed (deployed and verified later — see top of log)
- **What:** Phase 1–3 + 5 launch-blocker fixes per `PLAN-B.txt` walkthrough. Auth boot guard (refuses prod start without `AUTH_MODE=enforce`), 100/24h daily cap on `/auto-apply/run`, partial unique index on submitted evaluations, `auto_apply_paused` soft-pause flag, forgot-password flow + `/reset-password` route, US-only banner on Login, mobile-warning banner under 900px (later removed in favor of a real drawer), `NIGHTLY_CRON_DISABLED` kill-switch on both crons, email stripped from auth logs, frontend code-split (728 KB → 235 KB main).
- **Files:** [backend/middleware/requireAuth.js](backend/middleware/requireAuth.js), [backend/routes/careerOps.js:443](backend/routes/careerOps.js#L443), [backend/server.js:445](backend/server.js#L445), [backend/services/nightlyPipeline.js:28](backend/services/nightlyPipeline.js#L28), [supabase/migrations/009_evaluations_unique_submitted.sql](supabase/migrations/009_evaluations_unique_submitted.sql), [supabase/migrations/010_auto_apply_paused.sql](supabase/migrations/010_auto_apply_paused.sql), [frontend/src/App.jsx](frontend/src/App.jsx), [frontend/src/components/Login.jsx](frontend/src/components/Login.jsx), [frontend/src/components/ResetPassword.jsx](frontend/src/components/ResetPassword.jsx), [frontend/src/components/CareerOps.jsx:670](frontend/src/components/CareerOps.jsx#L670), [DEPLOYMENT.md](DEPLOYMENT.md), [scripts/verify-migrations.mjs](scripts/verify-migrations.mjs)
- **Status:** **superseded.** Code committed + pushed as `9692e11` on `main` and later cherry-picked onto `phase-4-pg` on the VM. See the 2026-04-27 *"Pre-launch hardening deployed + verified, mobile drawer shipped"* entry at the top of the session log for the deployment, verification, and follow-up actions. The mobile-warning banner referenced here was removed by `028ad46` and replaced with an off-canvas drawer.
- **Follow-up:** Resolved — see top entry.

### 2026-04-25 — Ranked Roles blank page + Completed tab order
- **What:** Moved Auto Apply `Completed` tab after `History`. Hardened `/apply/ranked` against backend score values arriving as strings by normalizing `fit_score`, response shape, average score, best-match, and score rendering.
- **Files:** [frontend/src/components/AutoApplyPage.jsx:5](frontend/src/components/AutoApplyPage.jsx#L5), [frontend/src/components/CareerOpsPage.jsx:19](frontend/src/components/CareerOpsPage.jsx#L19)
- **Status:** committed and pushed on `main`: `0d0e534`; `npm run build --prefix frontend` passed; not yet browser-confirmed by user.
- **Follow-up:** After Vercel deploy, hard-refresh and verify `/apply/ranked` plus Auto Apply tab ordering.

### 2026-04-25 — Apply nav overlay fix pushed
- **What:** Pushed the sidebar overlay fix and handoff update to `origin/main`.
- **Files:** [frontend/src/App.jsx:210](frontend/src/App.jsx#L210), [HANDOFF.md:116](HANDOFF.md#L116)
- **Status:** pushed to `origin/main`; local branch matches remote except unrelated untracked files.
- **Follow-up:** Wait for Vercel deploy, hard-refresh the app, and retry the Apply nav items.

### 2026-04-25 — Apply sidebar clicks blocked by overlay
- **What:** User reported Apply nav items were not opening. Live Vercel routes returned 200 and the deployed JS contained the Apply routes, so patched the sidebar to sit above non-modal content overlays that can intercept clicks.
- **Files:** [frontend/src/App.jsx:210](frontend/src/App.jsx#L210)
- **Status:** committed and pushed on `main`: `fcb908b`; `npm run build --prefix frontend` passed; not yet browser-confirmed by user.
- **Follow-up:** After Vercel deploy, user should hard-refresh and retry `/apply/auto-apply`, `/apply/pipeline`, and `/apply/ranked`.

### 2026-04-25 — Push state revalidated
- **What:** Rechecked `git status`, `git log --oneline -6`, and `git push origin main` after a stale handoff said `main` was still 4 commits ahead. GitHub was already up to date.
- **Files:** [HANDOFF.md:38](HANDOFF.md#L38)
- **Status:** committed on `main` as a handoff-only update; unrelated untracked files remain: `PLAN-B.txt`, `supabase/migrations/002_backend_schema.sql`, `supabase/migrations/003_per_user_isolation.sql`.
- **Follow-up:** Browser-verify `/outreach` and `/apply/auto-apply` after Vercel deployment.

### 2026-04-25 — Main pushed after Auto Apply work
- **What:** Pushed `main` to GitHub after rebasing local Outreach/Completed/HANDOFF commits on top of the remote Phase C commit (`bfcea63`).
- **Files:** [HANDOFF.md:38](HANDOFF.md#L38)
- **Status:** pushed to `origin/main` through `bc996ce`; local worktree still has unrelated untracked files `PLAN-B.txt`, `supabase/migrations/002_backend_schema.sql`, and `supabase/migrations/003_per_user_isolation.sql`.
- **Follow-up:** Wait for Vercel deployment, then verify `/outreach` and `/apply/auto-apply` in browser.

### 2026-05-01 — Big bug-bash: prompt overhaul + multi-select + ranked-roles + outreach AI
**CareerOps prompt overhaul** to fix "Claude.ai gives better output":
- `jobEvaluator.js`: switched from Haiku 4.5 → Sonnet 4.6 with system-message prompt caching (~90% cost cut on the static rubric across calls). Temperature 0.3, max_tokens 8192, 90s budget.
- New top-level fields in evaluation JSON: `verdict { headline, oneLineWhy, buriedMatch, interviewOdds.{asIs,properlyTailored,reasoning} }` and `topGaps[3]` — modeled on the user's Claude.ai sample (decisive verdict, buried-match callout, calibrated probability ranges).
- System prompt rewritten with explicit DO/DO-NOT lists, banned hedging phrases, "every reasoning field must quote evidence" rule.
- Input limits raised: CV 4500 → 8000 chars, JD 3500 → 6000 chars.
- Frontend renders the new verdict card + top-3 gaps prominently above Block A; per-row `JustifyToggle` (Why?) on Block B requirements, archetype reasoning, demand trend.

**History tab cleanup:** filtered out tracked-but-unevaluated rows (NULL grade) from `loadHistory`. The "Score: /100" entries the user surfaced via screenshot are gone.

**Multi-select for auto-apply queue:**
- New `POST /career/queue-by-ids` endpoint takes `{ ids }`, flips evaluations to `apply_mode='auto', apply_status='queued'`.
- Batch tab: checkbox per result row + Select-all / Clear / "⚡ Queue N for Auto-Apply" buttons.
- History tab: same checkbox pattern, only enabled on rows with grades; shared queue header.

**Apply → Ranked Roles fixes:**
- `/career/ranked` now UNIONs `company_applications` with `evaluations` (score normalized 0-100 → 0-5). Evaluations no longer disappear from the ranked view just because they aren't in `company_applications`.
- Frontend adds Refresh button + auto-reloads on visibility/focus change.
- Ranked cards now show role title (when from evaluation), grade badge, "From CareerOps" tag, and "See evaluation →" / "Open Posting ↗" deep-links.

**Queue/Unsupported filter pills:** always render in Auto-Apply Setup (previously hidden when count=0). Disabled state when 0 items, but visible.

**Job Dashboard Recent Evaluations dedup:** SQL `DISTINCT ON (job_url)` keeps only the most-recent evaluation per posting.

**Outreach templates → AI personalization always:**
- `generateOutreach` no longer short-circuits to static high-response templates for cold email — AI is the primary path; statics are emergency fallback only.
- `buildEmailPrompt` / `buildLinkedInPrompt` now consume `hasApplied`, `rolesAvailable`, `isRecruiter`, `specificAchievement` to pick audience-aware tone, scenario-aware ask, and angle (data/infra vs AI/healthtech vs quant vs startup) based on the company.
- Default outreach template body rewritten as a **slot-structure** anchor (specific_hook + credential + clear_ask) so the AI sees the structure to follow per recipient instead of substituting placeholders literally.

### 2026-05-01 — Block G "Why?" justify button
- **What:** Added collapsible per-signal breakdown to the legitimacy assessment card in CareerOps evaluation reports. Assessment badge (`High Confidence` / `Proceed with Caution` / `Suspicious`) now shows a "▼ Why?" button when signals exist; clicking expands the full signal/finding/weight table inline beneath the badge. Table collapses with "▲ Hide signals". `contextNotes` still shows below in both states.
- **Files:** [frontend/src/components/CareerOps.jsx:122](frontend/src/components/CareerOps.jsx#L122)
- **Status:** committed and pushed; Vercel deploying.
- **Remaining queue:** multi-select roles for auto-apply, show role names in Evaluate tab, Companies 2-section layout (scraped vs yet-to-check), Outreach templates improvement.

### 2026-05-01 — Multi-bug fix pass (7 bugs squashed)
- **Puppeteer ARM64 fix:** `resumeGenerator.js` now uses `PUPPETEER_EXECUTABLE_PATH` env var when set. On VM: added `PUPPETEER_EXECUTABLE_PATH=/home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux/chrome` to `/home/ubuntu/outreach/.env`; pm2 restarted; ARM64 Chromium `147.0.7727.0` confirmed working. PDF generation should no longer throw "Syntax error: redirection unexpected".
- **Chinese/non-English titles filtered:** `multiSourceScraper.js` adds `isEnglishTitle()` check (CJK/Arabic/Cyrillic detection) before upserting to `scraped_roles`. Stops ai-jobs.net Chinese listings from appearing in the catalog.
- **Recent Evaluations "Not Found" fixed:** `careerOps.js` `/evaluations/:id/report.html` now returns 200 with a minimal summary page when `report_json` is null (tracked-but-unevaluated rows) instead of 404. Job Dashboard "Recent Evaluations" open button no longer throws "Not Found".
- **Queue & Status filter pills:** Converted from static `<span>` to clickable `<button>` elements with an "All" pill; toggling a status pill filters the queue list to that status. (`CareerOps.jsx`)
- **History tab duplicates:** `loadHistory()` now deduplicates by `job_url`, keeping only the most recent evaluation per URL. Eliminates ×3 duplicate rows like "Intern as Software Developer". (`CareerOps.jsx`)
- **CategoryView filters explicit:** Removed the useless source filter (backend hardcodes `'job'` for all rows); `status` and `sortBy` onChange now call `load()` directly to avoid any stale-closure timing issue.
- **Manual careers URL input:** New text input + "💾 Set URL" button below scrape buttons in `CompanyDetail` roles tab. Saves to `jobs.url` via new `PUT /api/jobs/:id/url` backend route. Subsequent scrapes use the saved URL. (`CompanyDetail.jsx`, `jobs.js`, `api.js`)
- **Commits:** `9661482` (7 fixes), `3cbec8e` (manual URL feature), pushed to main + Vercel deployed.
- **VM:** backend on `3cbec8e` after `git reset --hard origin/main` (divergence from cherry-pick history); PUPPETEER env set; pm2 restarted.

### 2026-04-25 — Outreach fix committed + Phase C linearized onto main
- **What:** Committed the Outreach CRM JWT-fetch fix, then replayed local work on top of remote `main` after GitHub advanced to Phase C (`bfcea63`) during the session.
- **Files:** [frontend/src/components/OutreachPage.jsx:34](frontend/src/components/OutreachPage.jsx#L34), [HANDOFF.md:38](HANDOFF.md#L38)
- **Status:** committed and pushed on `main`: `8a55549`; Phase C is now in `main` via `bfcea63`; not browser-tested.
- **Follow-up:** Verify `/outreach` on the deployed Vercel app after deployment.

### 2026-04-25 — Auto Apply Completed tab
- **What:** Added a `Completed` tab to `/apply/auto-apply`. It reads `api.career.pipeline()`, filters `apply_status === 'submitted'`, and shows submitted roles sorted by applied date.
- **Files:** [frontend/src/components/AutoApplyPage.jsx:5](frontend/src/components/AutoApplyPage.jsx#L5), [frontend/src/components/AutoApplyPage.jsx:177](frontend/src/components/AutoApplyPage.jsx#L177)
- **Status:** committed and pushed on `main`: `b3bc61c`; `npm run build --prefix frontend` passed. Full `npm run lint --prefix frontend` still fails on pre-existing repo lint debt (`react-hooks/set-state-in-effect`, unused vars, empty catches, `vite.config.js` `__dirname`).
- **Follow-up:** Verify the Completed tab in browser after Vercel deploy.

### 2026-04-25 — Context refresh + memory confirmation
- **What:** Read `HANDOFF.md`, confirmed `MEMORY.md` and `feedback_keep_handoff_updated.md` are accessible, and checked frontend/backend worktree state.
- **Files:** [HANDOFF.md:1](HANDOFF.md#L1), `/Users/lakshmisravyarachakonda/.claude/projects/-Users-lakshmisravyarachakonda-VS-CODE-email-tracker/memory/MEMORY.md`, `/Users/lakshmisravyarachakonda/.claude/projects/-Users-lakshmisravyarachakonda-VS-CODE-email-tracker/memory/feedback_keep_handoff_updated.md`
- **Status:** included in `8a55549` after `HANDOFF.md` was added to git; backend worktree is on `phase-4-pg`.
- **Follow-up:** Keep appending dated entries before ending each unit of work.

### 2026-04-24 — Outreach CRM "0 contacts" root cause + fix
- **What:** `OutreachPage.jsx` was calling raw `fetch('/api/unified/all-contacts?…')` which bypassed the JWT-attaching `api.js` wrapper. Backend in `AUTH_MODE=enforce` returned 401; the `.then(r => r.ok ? r.json() : { contacts: [] })` handler silently swallowed it → empty list, no error UI. Swapped to `api.unified.allContacts(params)` which attaches `Authorization: Bearer <jwt>` from the current Supabase session. Added `console.error` on failure so the next silent-empty case isn't silent. Swept the rest of `frontend/src` — this was the only naked `/api/` fetch.
- **Files:** [frontend/src/components/OutreachPage.jsx:34-44](frontend/src/components/OutreachPage.jsx#L34-L44)
- **Status:** uncommitted on `main`; NOT browser-tested yet; backend endpoint at [backend/routes/unified.js:285](../outreach-local/backend/routes/unified.js#L285) confirmed to accept `limit`/`hasEmail`/`noEmail` and scope by `req.user.id`.
- **Follow-up:** User to deploy and confirm `/outreach` as `lakshmisravyar@gmail.com` shows 36 contacts (14 with email). Then commit + push.

### 2026-04-24 — Branch-state discovery (blocker for Completed tab work)
- **What:** User asked to add a "Completed" tab to the Auto Apply page at `/apply/auto-apply`. Investigation revealed that page **does not exist on `main`** — it was introduced by commit `cbadab2` "Phase C: IA refactor — DISCOVER / APPLY / OUTREACH sections + Auto Apply page" which lives on remote branch `feat/ia-discover-apply-outreach`, not yet merged. The handoff's listed commit `bfcea63` for Phase C is not present in `git log --all`; handoff commit hashes for Phase C appear aspirational/stale.
- **Files:** n/a — investigation only. `git log main` tops at `3c5be1b`. `feat/ia-discover-apply-outreach` tip: `cbadab2`.
- **Status:** Blocked awaiting user decision: add Completed tab on `feat/ia-discover-apply-outreach` directly, or merge Phase C → main first then add on main. Also unclear what Vercel (`outreach-jt.vercel.app`) is tracking — screenshot shows Phase C live in prod, so either the feature branch is deployed or Phase C was rebased/pushed to main under a different hash.
- **Follow-up:** Next session — ask user which branch to land the Completed tab on. Per memory rule, do NOT switch branches with the OutreachPage.jsx fix still uncommitted without stashing first.
