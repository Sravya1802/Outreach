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

### 2026-10-16 — Referral emails wait for your OK, with the role's resume attached
- **Why:** the user's vision: the AI writes the email, attaches that role's tailored resume, and nothing goes out until they read the draft and approve it; contacts' emails are found for the roles being applied to. They chose **approve in the app** (not "press Send in Gmail").
- **What** (`f4acf33`, fix `5f8133b`):
  - **Drafts:** `email_outbox.status = 'draft'` (migration 029: also `attachment_file_id`, `body_html`, `gmail_draft_hash`, `approved_at`; `referral_asks.status` gains `draft`). `referralFlow.askForReferral` now creates drafts via `scheduleEmail(..., { draft: true, attachmentFileId })`, using the tailoring's `file_id` (else `evaluations.resume_file_id`). The AI prompt and template say "My resume is attached", with paragraphs and a name sign-off.
  - **Gmail Drafts copy:** `gmail.js` `appendDraft`/`putDraft` uses IMAP APPEND to the `\Drafts` special-use folder with the PDF attached. Drafts are found **by recipient address**, dated from the row's `created_at` (Gmail rewrites a draft on every edit, so Message-ID can't be used). An app-side edit replaces the Gmail copy.
  - **Approve** (`POST /api/gmail/outbox/:id/approve`): reads the Gmail copy back. If its hash differs from `gmail_draft_hash`, it was edited there and that text/HTML is used. The row then becomes `scheduled` at the recipient's next 8–11 AM slot and the Gmail copy is deleted, so it can't be sent twice. The attachment is fetched from storage at send time. Discard is `DELETE` (it also removes the Gmail copy).
  - **Sent/deleted in Gmail:** `outbox.syncDrafts` runs at the end of each `checkInbox` (every 10 min). Gone from Drafts and found in Sent means `sent` (Gmail's Message-ID, follow-ups as usual). Gone from both means `cancelled` ("You deleted it from Gmail Drafts").
  - **Referral wait:** `referralEmailMoved` restarts `apply_after` from when the email actually goes and rewrites the role's status line; discarded asks drop out of it.
  - **Auto email lookup:** when nobody known at the company has an email (and Gmail is connected), `findEmailsAt` runs `contactFinder.findCompanyEmails` (Hunter → website → Prospeo → Serper, shared 30-day domain cache, the user's monthly allowance) and saves the contacts.
  - **UI:** People → Outbox has a "Waiting for your OK" section (email preview, PDF chip that downloads, Gmail-copy status, Approve / Edit / Discard). Drafts also show in Home Today ("N emails are waiting for your OK"), How it works (new "Approve the drafts" step, updated referral and Find people text), the referral panel line, and the morning summary.
- **Verified:**
  - Draft IMAP logic against a local IMAP server (hoodiecrow, scratchpad script): PDF attached, edit detection, replace, delete only ours, Sent detection with Message-ID.
  - Live on the e2e account: the real `askForReferral` made 2 drafts with the tailored PDF; UI Edit → Approve (toast "It goes Fri 9:26 AM Chicago time") → Discard; the referral ask became `scheduled`, `apply_after` moved Mon → Tue, and the status line was correct after the discard. 0 console errors, no sideways scroll at 1400/390. Seed rows deleted.
  - Tests: backend 160, frontend 94.
- **Not yet verified:** the copy in a **real Gmail** Drafts folder (the e2e account has no real Gmail). It needs the user's connected Gmail: after the next approved role reaches the referral step, check that Gmail Drafts shows the email with the PDF, then edit there → approve → the sent mail has the edits.
- **Note:** lookup allowance per user per month is Hunter 15 / Prospeo 25 / Apollo 40 / Serper 150, so auto lookups cover roughly 10–15 new companies a month (repeat companies hit the cache).

### 2026-10-15 — Evening list: agencies left out, scores spread out
- **staffing.js (8786068, aeb0d9f):** `looksLikeAgency(company, jd)` checks a known-agency list, name words (staffing, recruiting, talent solutions…) and JD phrases ("our client", C2C, contract-to-hire). It needs 2 phrases, or 1 phrase plus an agency-ish name. It runs on the company name before scoring and on the posting text after the JD fetch, and agencies go to `excluded`. The first version wrongly caught BAE Systems through "systems inc", so that pattern and the consulting patterns were removed. Tests now cover BAE Systems, Apple Inc, Cisco Systems, Oracle Consulting and Palantir Technologies.
- **blendScore:** the scorer now returns counts of required and preferred qualifications met plus a level fit. The final score is `0.5*model + 0.5*10*(0.65*req + 0.2*pref + 0.15*level)`, and a role at the wrong level is capped at 6.5. `refreshPlan(userId, planId)` drops agencies and rescores pending top and worth items from the stored JD, then re-tiers them.
- **User's list (2026-10-15) refreshed:** 9 agency postings removed, 100 rescored ($0.04). Result: **20 top** scored 9.4–9.8 (Whatnot, Caselle, Google, American Express, Vagaro, CoreWeave, Instacart, VAST Data, Valon…), 72 worth, 57 excluded. BAE was restored to worth.
- **Sent:** WhatsApp (free text, inside the 24-hour window) and email. The cron had already emailed the old 18-role list at 02:00 UTC, before the refresh, so I cleared `emailed_at` and sent the refreshed list again. The user got two list emails tonight; the second one is correct.

### 2026-10-15 — Evening list: more roles scored; minimum of 10; LinkedIn → company board; ASCII headers fix
- **Bug fix (974f866):** the rename put the curly apostrophe of "Scout’n’Jobs" into `User-Agent` headers, and fetch throws on non-ASCII header values, so posting fetch, GitHub sync, SpeedyApply and pay lookups failed for ~45 min (23:24–00:08 UTC). No scheduled job ran in that window. Headers now say `ScoutnJobs`; `tests/ascii-headers.test.mjs` guards it.
- **boardResolver.js:** before applying, a LinkedIn/unknown-site role is looked up on the company's own Greenhouse/Lever/Ashby board (public APIs, 1-day cache) and applied there if the title matches. Measured ~9% of LinkedIn-only US roles (49 of 528).
- **Daily plan (e10e06c):** scores up to 150 roles a night (`DAILY_PLAN_MAX_SCORED`, was 40), 3 at a time, most title-relevant to the resume first. New setting `minPerDay` (default 10): when fewer reach the bar, the best 8.0+ roles fill the list, marked "Close match · ". Rebuilds add to the same plan and re-tier it as a whole.
- **User's list rebuilt:** 744 considered, 145 scored ($0.04, 14 min), **18 top** (all 9.2), 91 worth, 48 excluded (visa). Watch: the scorer clusters at 9.2, and several top roles are staffing agencies (TalentHop, Employia, Divine Talent, Aavalar). Consider a staffing-agency filter and a scoring prompt that spreads scores more.

### 2026-10-15 — WhatsApp templates reformatted (snj_*)
- The user wanted a friendlier format. Each template now has a bold **header** (one variable), a body starting "Hello," and ending "Good luck! ;)", a footer "Scout’n’Jobs", and a **URL button** to the site instead of a long link. `templateDefinition(kind)` builds Meta's component list; `sendTemplate` sends header + body params (`{ header, body: [] }`). The in-window free-text versions use the same shape with WhatsApp bold/italics.
- Submitted via the API as `snj_daily_list`, `snj_reply_alert`, `snj_needs_you`, `snj_morning_summary` (en_US, UTILITY); all PENDING. The old `oos_*` ones were deleted. `WHATSAPP_TEMPLATE_NEEDS` override removed from the VM .env.
- Sent the user a free-text preview of the new list format. Tests: backend 149, frontend 79.

### 2026-10-15 — WhatsApp templates submitted; Meta/Google renamed
- The user renamed the Meta app, the business portfolio and the Google consent screen to Scout’n’Jobs, and deleted the old templates.
- I submitted the 4 templates through the API (language **en_US**; `WHATSAPP_TEMPLATE_LANG=en_US` on the VM): `oos_daily_list`, `oos_reply_alert`, `oos_morning_summary`, and `oos_needs_you_v2` (Meta blocks a deleted name for a while, so the needs template is renamed via `WHATSAPP_TEMPLATE_NEEDS=oos_needs_you_v2`). All PENDING at submit time. `/api/whatsapp/templates` now reports the effective names.
- Until they're APPROVED, WhatsApp notifications only go out inside the 24-hour window after the user last messaged the number.

### 2026-10-15 — Site moved to scoutnjobs.vercel.app
- **What:** the Vercel project was renamed `scoutnjobs`; `outreach-jt.vercel.app` 307-redirects to `scoutnjobs.vercel.app` (path kept). The backend reads one `FRONTEND_URL` for every link it writes (emails, WhatsApp, GitHub OAuth return), falling back to `FRONTEND_ORIGIN`. VM .env: `FRONTEND_URL=https://scoutnjobs.vercel.app`, `CORS_ORIGINS` allows both addresses. Supabase Site URL/redirects and the Google OAuth client origins + consent-screen links were updated by the user.
- **Unchanged:** the backend URL (outreach-jt.duckdns.org), so Meta's WhatsApp webhook and the GitHub OAuth callback still work. Repo and env names unchanged.
- **Verified live:** new address sign-in page, Google sign-in starts without a redirect_uri error, signed-in pages load (CORS), old links redirect. Tests: backend 150/150.

### 2026-10-15 — App renamed: Scout’n’Jobs
- **What:** every user-facing "OutreachOS" is now **Scout’n’Jobs** (curly apostrophes, so it's safe inside quoted strings): top bar, sidebar, sign-in, tab title, legal pages, Gmail/GitHub/WhatsApp/Details copy, email subjects and footers, WhatsApp texts and template wording, README, e2e specs. The replyWatcher footer link now points to /people/outbox.
- **Unchanged:** the URL (outreach-jt.vercel.app), the repo, code identifiers, env names, WhatsApp template names (`oos_*`), and old setup scripts under deploy/.
- **Naming research:** JobScout, JobQuest, Jobleap, HireQuest and JobLoop are all existing products or trademarks; most short two-word .coms are taken. Free domains for the new name: scoutnjobs.com, scoutajob.com, jobscoutnhire.com.
- **Status:** 2b1ce2b live on Vercel and the VM. Verified: tab title, sign-in heading, top bar. WhatsApp test sent with the new name.
- **Still to do for the name:** rename in Meta (app name, business portfolio "Outreachos", WhatsApp display name when an own number is added), Google OAuth consent screen app name, and the WhatsApp template bodies if Meta has already approved the old wording.

### 2026-10-15 — How it works: WhatsApp, LinkedIn, accurate apply step
- **What** (`d7972dd`):
  - **On your phone with WhatsApp** is a new section with 6 cards. The link card shows linked / not linked / not available (from `configured`). There's one card each for list approve-by-reply, reply alerts, needs-you and morning summary, showing on/off from prefs. The last card covers STOP/START/HELP.
  - **Outreach** is now 8 steps and includes LinkedIn connections (`api.connections`), People → Messages, and notes sent by hand.
  - **Referral step:** connections first, email or a LinkedIn note, and the user reports link / submitted / no.
  - **Apply step:** only Greenhouse/Lever/Ashby are auto-submitted; others become "apply yourself".
  - The logic is in `whatsappSteps` / `emailSteps` in queueFlow.ts, with tests.
- **Status:** verified live. **WhatsApp shows "not available yet" because none of WHATSAPP_TOKEN / PHONE_NUMBER_ID / BUSINESS_NUMBER / VERIFY_TOKEN / APP_SECRET are in the VM .env.** The owner's Meta setup is still pending.

### 2026-10-15 — WhatsApp (Meta Cloud API)
- **What:** one OutreachOS business number, [whatsapp.js](backend/services/whatsapp.js).
  - **Linking:** Integrations → WhatsApp gives a 6-digit code (30 minutes). The user sends `JOIN <code>` to the number, which proves it's theirs and opts them in.
  - **Outbound,** per-user prefs: the 10 PM list (daily_plans.whatsapp_at), reply alerts (replyWatcher.notify), "needs you" (plan_items.whatsapp_needs_at, batched per tick) and the morning summary (maybeSendSummary).
  - Inside Meta's 24-hour window it sends free text with full detail; outside it, the approved templates `oos_daily_list`, `oos_reply_alert`, `oos_needs_you` and `oos_morning_summary`. The exact text is in `WHATSAPP_TEMPLATES` and shown in the page's owner setup.
  - **Inbound commands:** YES, YES 1 3 (numbered like the list), SKIP 2, LIST, STOP, START, HELP.
  - **Public webhook:** `/api/whatsapp/webhook` (GET handshake, POST deliveries). The X-Hub-Signature-256 check is required; with no app secret configured, POSTs are refused. The raw body is captured in express.json verify. Deliveries are deduped by message id.
  - **Env:** WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_NUMBER, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, plus WHATSAPP_API_VERSION (default v25.0, supported to July 2028; v26.0 is the latest).
- **Files:** [028_whatsapp.sql](supabase/migrations/028_whatsapp.sql), [routes/whatsapp.js](backend/routes/whatsapp.js), [WhatsAppPage.tsx](frontend/src/features/integrations/WhatsAppPage.tsx).
- **Status:** see the next entry for the deploy and test results. It needs the owner's Meta setup (the steps are on the page) before anything is sent.

2026-10-15 — List builds now survive restarts: on boot, server.js marks daily_plans still on 'building' as failed (so the page shows Rebuild again) and rebuilds today's (8ce217d). Before this, every pm2 restart left the list stuck on 'building', with no Rebuild button and no cron retry. (From the other session; my 07:03 deploy had interrupted the user's build, and it resumed on its own.)

### 2026-10-15 — Tracker moved to the Dashboard; Referrals panel; needs_reason fix
- **What:**
  - "After you apply" (Tracker) is removed from Auto-apply and now sits at the bottom of the Dashboard. Every `/applications/auto-apply…#tracker` link now goes to `/dashboard…#tracker` (Home, today.ts, queueFlow, the old Pipeline/Board/Ranked redirects). The page scrolls to it after the charts load.
  - New **Referrals** panel on the Dashboard (`GET /api/daily-plan/referral-stats`): roles asked, referrals got (and rate), emails sent/scheduled, LinkedIn notes sent/to send, replies, connections imported, and an outcomes bar list.
  - **Bug fix (027 `plan_items.needs_reason`):** advanceUser re-advanced every `needs_you` row whose resume had passed. A role waiting on the user for a referral code was sent back to `asking_referral` and asked again. Now only `needs_reason = 'resume'` rows auto-advance, and `askForReferral` never re-asks when asks exist. The e2e Garmin row was repaired.
- **Status:** live (bf7d647, VM too). The browser test passed (the tracker isn't on Auto-apply, the tracker and Referrals are on the Dashboard with real numbers, `/applications/pipeline` → `/dashboard#tracker`). Tests: backend 143/143, frontend 75/75.

### 2026-10-15 — People → Messages
- **What:** a new tab, [MessagesPage.tsx](frontend/src/features/outreach/MessagesPage.tsx), backed by [messages.js](backend/services/messages.js) and `/api/messages/*`.
  - Lists every company where the user has people: LinkedIn connections, merged with saved contacts by `companyKey`. Each shows open roles (catalog, 30 days, the user's region), connections, contacts with email, and how many were contacted.
  - Sorted: open roles first, then connections, then emails. Search and filters (All / Open roles / Connections / Has email), 25 per page.
  - Opening a company lists its people (connections first, then recruiters, engineers, others). Connections and found contacts are merged by LinkedIn URL or name.
  - "Write message" (or "Write messages for everyone", run sequentially with progress) drafts a LinkedIn note (≤ 300) plus an email via Groq. It's personalized to the person's title, connection or not, and the best open role for the user there (top or worth plan item, else the newest listing); with no role, it asks for a short chat.
  - Drafts are saved on `job_contacts.generated_*`. A connection without a contact row gets one (`contactFor`).
  - Buttons: Copy & open LinkedIn, Mark sent (→ dm_sent), Send at the best time (outbox) or Open in Gmail, Copy email, Mark emailed, Rewrite.
- **Status:** live and tested on the e2e account (Stripe and Garmin from sample connections). The draft, copy (toast confirmed), opening the profile, Mark sent and the filter all work; no sideways scroll on phone.
  - The prompt was tightened after the first draft invented "senior" and what the other person works on.
- **Note:** the other session's commit c40dfc9 swept in my App.tsx/nav.ts edits before MessagesPage.tsx was pushed (a brief broken build window); it's fixed by 257196e.

### 2026-10-15 — "How it works" tab; top bar fits 8 sections
- **What:** the user asked for the queue explainers in their own tab next to Usage. `/how-it-works` ([HowItWorksPage.tsx](frontend/src/features/howitworks/HowItWorksPage.tsx)) holds both flows (job queue, 8 stages; outreach email, 6 stages), with logic still in `features/home/queueFlow.ts`. Home is back to setup, Today, Top picks and So far (`c40dfc9`).
- **Top bar** (`119f215`): the main bar is now Home · Dashboard · Jobs · Applications · People · Integrations · Usage · How it works.
  - Spacing is tighter below xl, and the search button is icon-only below 1280px.
  - The phone drawer now takes over **below 1024px** (it was 768); AppShell uses `lg:`.
  - The active sub-tab underline uses `border-accent`, since the soft Ocean rule colour barely showed.
- **Status:** verified live at 900 (drawer lists all 8 + Profile/Settings), 1024, 1100 and 1280. One line, no horizontal scroll.

### 2026-10-15 — Home explains both queues; new Dashboard tab
- **Home → "How your job queue works"** (`129df34`, [queueFlow.ts](frontend/src/features/home/queueFlow.ts) with tests). It shows 8 stages (find, score, evening list, tailor, referral, apply, track, follow up). Each stage is explained with the user's own daily-plan settings (list hour/tz, min score, per-day cap, referral wait) and a live count. States are idle, busy, you (accent) and stuck (danger). A settings line says whether the evening list is on.
- **Home → "How your outreach emails go out"** (`7ecfe83`). It shows 6 stages (connect Gmail, find people, write & schedule, send 8–11 AM recipient tz at the daily cap, follow-ups at days 4/10, replies), counted from the outbox and replies. This answers the user's "where is the Gmail automatic sending".
- **Dashboard** (`4dd69c1`, `cea7fd2`, [DashboardPage.tsx](frontend/src/features/dashboard/DashboardPage.tsx)). It's a new top-bar tab after Home, at `/dashboard`; the old /dashboard→/home redirect is gone and `/home/analytics` points here. It shows 6 stat tiles (applied, heard back %, interviews, offers, emails sent, email reply %), applications per week (8 weeks, from tracker `applied_at`), where applications are (funnel bars), fit-score bands, outreach emails per week (outbox `sent_at`; asks to connect Gmail otherwise), and This month (new roles, auto vs by hand, AI spend, lookups). The charts are in-house HTML: one accent hue, hover/focus tooltip, and an sr-only table. Bucketing is in [metrics.ts](frontend/src/features/dashboard/metrics.ts) with tests. dashboard.spec was updated.
- **Status:** all verified live with seeded rows (since deleted), in light, dark and 390px.

### 2026-10-15 — Step 4b: referral first, then apply
- **What:** [referralFlow.js](backend/services/referralFlow.js), driven by the daily-plan tick.
  - **`asking_referral` → ask.** Who: LinkedIn connections at the company first (recruiters, then engineers, then managers), then saved contacts; at most 2.
  - Each ask is drafted by Groq (`email` task, JSON), with a template fallback.
  - With an email address it goes out as an outbox email (`purpose = 'referral'`: no generic follow-ups) at the recipient's 8–11 AM slot. Otherwise it's a LinkedIn note: the user clicks "Copy note & open profile" and then "I sent it".
  - Nobody known → a LinkedIn people search (company + school) plus a note.
  - **`waiting_referral`.** apply_after = `businessDaysLater(now, referralWaitDays, company tz)` at 6–10 AM. Email replies are flagged ("X replied, tell us what happened"). Buttons:
    - Got a link or code: a Greenhouse/Lever/Ashby link → apply through it next morning; otherwise, or a code → needs_you with instructions.
    - They submitted me → `referred`, and the evaluation is marked submitted.
    - They said no → apply next morning.
    - Apply now.
    - I applied.
  - **`ready_to_apply`.** One application per tick through `processOneEvaluation` (it needs `auto_apply_consent`, which turning on the evening list now records). Other sites → needs_you "apply yourself". After applying, an "I've applied" note goes in each referral email thread (`scheduleThreadNote`).
  - **Morning summary** at 11 AM user time, once a day, when something was applied, needs the user, or has a note to send.
  - **LinkedIn connections** (Integrations → LinkedIn): upload Connections.csv. `companyKey` drops legal and region suffixes (Garmin International = Garmin, but WorkRamp ≠ Ramp). Plan rows show "You know N people here".
- **Files:** [026_referrals.sql](supabase/migrations/026_referrals.sql), [referralFlow.js](backend/services/referralFlow.js), [linkedinConnections.js](backend/services/linkedinConnections.js), outbox `purpose` + `scheduleThreadNote`, [Referrals.tsx](frontend/src/features/applications/Referrals.tsx), [LinkedInPage.tsx](frontend/src/features/integrations/LinkedInPage.tsx).
- **Status:** live and tested on the e2e account.
  - Garmin (2 known people): 2 drafted notes, recruiter first, apply set for Mon 9:54 AM company time.
  - Fidelity (nobody known): search link plus note. Said no → apply next morning. Apply now → LinkedIn URL → needs_you. I applied → the tracker shows submitted.
  - Browser test passed: copy and open profile, I sent it, referral code, said no.
  - No real application was submitted; both test roles were LinkedIn URLs. Tests: backend 145/145.
- **Big gap:** only about 8% of fresh US roles are Greenhouse/Lever/Ashby (102 of 1,349). The rest are LinkedIn 39%, Workday 23% and other sites 28%, so most approved roles end as "apply yourself". Next options: resolve LinkedIn and Indeed links to the company's own posting (JobSpy `job_url_direct`), prefer roles on supported sites in the list, and Workday support (needs per-company accounts).
- **Coordination:** another session is editing the frontend in parallel (theme, Home Top picks, `/usage`, People section). Commit only your own files.

### 2026-10-15 — Light theme is now "Ocean"
- **What:** the user picked **B Ocean** from the palette sheet (`8627d8d`, [app.css](frontend/src/styles/app.css)): page #eef4fa, white cards, lines #d9e4ef / #c3d3e3, text #0f2236, accent #0b6bcb, success #0f7a55, danger #c8321f. Dark (Graphite) is unchanged. This replaces the Clean white entry below.
- **Status:** verified live on Home and Roles. No console errors.

### 2026-10-15 — Home: Top picks for you; palette picker sent
- **What:** the user asked where the top role recommendations are. Home now has **Top picks for you** under Today (`c05faf2`). It shows the best 5 items from today's daily plan (top tier, then worth a look; skipped and expired are hidden), using the shared `ItemRow` (now exported from DailyPlan.tsx) with Approve / Skip. With no plan it offers "Build today's list". Today dropped its "worth a look" line.
- **Colours:** the user still dislikes the colours after Clean white. A palette picker artifact was sent (https://claude.ai/artifact/8rJgWbtMwUt3hKGQgZVwxK): A Clean white (current), B Ocean, C Sage, D Lavender, E Slate & coral, F Graphite (current dark), G Midnight, H Forest night. **Waiting for the user's letter**; then update the `--ui-*` tokens in app.css.
- **Status:** Top picks verified live with the e2e user's real plan (25 picks, Approve/Skip shown).

### 2026-10-15 — "Clean white" light theme; Newest roles off Home
- **What:** the user disliked the cream background and the Home roles list.
  - Home no longer shows Newest roles (`6367535`): Today on the left, So far on the right.
  - The light theme is now **Clean white** (`8f6f8c8`, [app.css](frontend/src/styles/app.css)). The page is #f7f8fa with white cards, soft grey lines #e4e7ec / #d0d5dd, text #101828 and indigo accent #4f46e5. The heavy black section rules (`--ui-rule`) are now soft grey.
  - Dark keeps its palette, but its rule moved from bright #ece9e2 to #3d3e44.
- **Status:** verified live on Home, Roles, Auto-apply and Usage in light and dark. No console errors.

### 2026-10-15 — Step 4a: the evening list (daily plan)
- **What:** opt-in per user (meta `daily_plan_settings`). Defaults: 10 PM America/Chicago, score ≥ 9.0, max 15 a day, referral first, 2-day wait.
  - **Build:** the cron runs every 5 min and starts building an hour before list time; "Build now" runs in the background.
    - Picks fresh roles (≤ 4 days old) in the user's region and role types that aren't already evaluated or considered.
    - Hard filters: one company per 30 days, and sponsorship (catalog label, plus a deterministic classifier on the posting).
    - Reads up to 40 postings a night and scores each with Groq (`score` task, 0–10 with a one-line reason) from the parsed master.
    - Tiers: top (≥ bar, one per company, capped), worth (7 to the bar), low, excluded.
  - **Email:** at list time, from the user's own Gmail (sendToSelf), as text plus HTML. It's skipped when the list has nothing to show.
  - **Approve:** creates an evaluation row (source `daily_plan`), and resumeEngine starts right away (at most 2 at once per user).
    - ATS 90+, or "Send anyway" → stage `asking_referral` (or `ready_to_apply` at a 6–10 AM company-time slot when referral first is off).
    - Under 90 → `needs_you`. Unapproved roles expire when the next list is built.
  - **UI (Auto-apply):** evening-list settings with Turn on/off, tonight's list (Approve / Skip / Undo / Approve all, with worth-a-look collapsed), and approved roles with their stage and an ATS link. The old lock banner and nightly Rules were removed.
- **Files:** [025_daily_plan.sql](supabase/migrations/025_daily_plan.sql), [dailyPlan.js](backend/services/dailyPlan.js), [routes/dailyPlan.js](backend/routes/dailyPlan.js), [DailyPlan.tsx](frontend/src/features/applications/DailyPlan.tsx), [plan.ts](frontend/src/features/applications/plan.ts).
- **Status:** live and tested on the e2e account.
  - Built a real list: 300 considered, 40 scored for $0.009; 0 top (thin test resume), 25 worth, 21 low.
  - Approve → tailoring started → needs_you (ATS 39% / 23%, $0.054 each). "Send anyway" → `asking_referral`.
  - Browser test passed (settings save, turn on/off, approve from the page, Gmail hint, phone width).
  - Bugs fixed: the synchronous build timed out, and the cron skipped users who had never saved settings.
- **Next (4b):** referral ask (existing contacts with email go through the outbox; otherwise a LinkedIn search link plus a drafted note), referral buttons, the wait, apply at a 6–10 AM company-time slot via autoApplier, the "I've applied" note, the morning summary, and LinkedIn connections upload.
- **Watch:** the quick fit score (8.5) and ATS keyword coverage (23–39%) can disagree a lot on thin resumes, so many approvals may land in needs_you. Revisit once the user's real resume is in.

### 2026-10-15 — Home rebuilt "Today first"; AI card removed
- **What:** the user asked to remove "AI this month" from Home (`60763cf`, it's on Usage) and then to rework Home. They picked the "Today first" layout (`64aef0f`):
  - **Header:** "N things need you" counts the Today items that aren't informational, and links to #today-h.
  - **Setup:** a slim "Finish setting up" bar showing a progress bar, X of 6, and a **Next: <step>** button. "All steps" expands the six-step grid. It still hides once everything is done.
  - **Today** (left), built by [today.ts](frontend/src/features/home/today.ts) with tests. Order: Gmail rejected, services down, needs you (plan `needs_you` plus queue `needs_review`), couldn't send, roles waiting for your OK (top tier pending), follow-ups (7+ days quiet), next steps due today or overdue, new replies (72h, real replies only), approved roles on the way (with a referral-wait note), emails going out in 24h, and worth-a-look. It folds in the old "Waiting on you".
  - **Right column:** **So far** (the old "Your applications" funnel) and the newest roles (3 intern plus 3 new grad).
  - Replies and outbox are fetched only when Gmail is connected.
- **Status:** verified live with the e2e user (seeded tracker rows, since deleted, plus their real daily-plan data). The All steps toggle shows 6 and the header link jumps to Today. Checked light, dark and 390px. dashboard.spec updated (Today / So far).

### 2026-10-15 — Home: Connect Gmail is a setup step
- **What:** the Home checklist now has 6 steps, with **Connect Gmail** after GitHub (`2f616c6`). The step links to Integrations → Gmail and counts as done when it's connected and the status isn't `error`. The heading now reads "Before the app can apply and email for you". The grid is 3 columns on tablet and 6 on desktop.
- **Also:** "Waiting on you" shows a red item when Gmail is connected but Google rejected the app password (emails on hold), linking to the reconnect page.
- **Status:** verified live with the e2e user (light, dark, 390px). Unit tests were updated ([onboarding.ts](frontend/src/features/home/onboarding.ts), home.test.ts).

### 2026-10-15 — Decision: keep the Gmail app-password page
- The user asked to remove Integrations → Gmail, thinking "Continue with Google" already covered it. It doesn't: the sign-in requests no Gmail scopes (`LoginPage.tsx` signInWithOAuth has no `scopes`), and sending, follow-ups, reply tracking and daily emails all use the app password.
- Explained, and the user chose to **keep the app-password page as is**. Moving Gmail onto Google sign-in (gmail.send/readonly scopes, unverified-app warning, 100-user cap until review) was offered and declined for now.

### 2026-10-15 — Usage: its own top-bar item next to Integrations
- **What:** the user asked for Services to sit next to Integrations under a better name, with the AI spend added. The page is now **Usage** at `/usage` (`3047d44`), at [features/usage/UsagePage.tsx](frontend/src/features/usage/UsagePage.tsx).
  - It shows **AI spending this month** (you vs site, per-task breakdown). The card moved from Settings → Account into [AiSpendCard.tsx](frontend/src/features/usage/AiSpendCard.tsx).
  - It also shows your lookups this month, and **Service status** (formerly titled "Integrations").
  - Integrations now has only Gmail and GitHub.
  - `/integrations/services` and `/settings/integrations` redirect to `/usage`. The top-bar status dot, Home's attention items, and Home's AI "Details" link all point to it.
  - The command palette no longer shows "Usage › Usage".
  - Every AI task gets a readable label (resume_parse, keywords added), with a fallback for new ones.
- **Status:** verified live (redirect, light/dark, 390px). Settings → Account no longer shows AI spend.

### 2026-10-15 — Google sign-in: button + public legal pages
- **What:**
  - "Continue with Google/GitHub" is on the sign-in and sign-up pages ([providers.ts](frontend/src/features/auth/providers.ts) reads Supabase `/auth/v1/settings`). It appears only once the provider is enabled in Supabase, with no redeploy. New OAuth users get the market question from MarketGate.
  - Public `/privacy` and `/terms` pages ([features/legal/](frontend/src/features/legal/)), rendered without a session, for the Google consent screen. The privacy policy includes the Google API Limited Use statement. Contact email: lakshmisravyar@gmail.com (in LegalLayout). AuthLayout links to both.
- **User setup in progress:**
  - Google Auth Platform, project "Resume Builder". Branding needs home `https://outreach-jt.vercel.app`, privacy `/privacy`, terms `/terms`, and authorized domains `outreach-jt.vercel.app` (vercel.app alone is rejected as a public suffix).
  - Then Audience → Publish, Clients → Web client (origin `https://outreach-jt.vercel.app`, redirect `https://dkifhfqgoremdjhkcojc.supabase.co/auth/v1/callback`), then Supabase → Auth → Providers → Google.
- **Note:** another session renamed Outreach to **People** (`/people/*`, bb49694). The app rename is still pending; when it happens, update APP_NAME in LegalLayout too.

### 2026-10-15 — Roles: Visa column
- **What:** Jobs → Roles now has its own **Visa** column between Pay and Location (`429fc3e`, `93a972e`). It shows Sponsors visas / No sponsorship / US citizens only / Visa not stated, or "Not checked" when the description was never read. Hovering shows the quoted sentence. Phones keep the badge under the title. The actions column now has a fixed 176px width, so rows with "Tracking" line up.
- **Status:** verified live (light theme, 1400px and 390px, no horizontal scroll).
- **Follow-up:** many big-company rows (NVIDIA, Meta…) show "Not checked" because their descriptions sit on Workday, which returns 403 (see the sponsorship entry).

### 2026-10-14 — Outreach section renamed People
- **What:** the top-bar "Outreach" is now **People** (`bb49694`). Contacts, Templates and Outbox moved to `/people/*`, and every `/outreach*` URL redirects (LEGACY_REDIRECTS). Section id is `people`. The `features/outreach/` folder name is unchanged.
- **Also fixed:** two stale e2e specs (outreach.spec expected "Outreach CRM"; shell.spec expected `/outreach/contacts`).
- **Status:** verified live. `/outreach/templates` lands on `/people/templates`, the top bar shows People, and the phone layout is fine.
- **Pending:** the user also wants to **rename the app (OutreachOS)**. The name is not chosen yet. When it is, update: TopBar, Sidebar, AppShell, AuthLayout, LoginPage, index.html title, and the Gmail/GitHub/Details/Services copy. Also `backend/services/replyWatcher.js` (its email footer says "OutreachOS sent this" and links `${SITE}/outreach/outbox`, which redirects but should become `/people/outbox`).

### 2026-10-14 — Navigation: account menu + Integrations
- **What:**
  - Clicking the avatar opens a menu with the name and email, **Profile**, **Settings** and **Sign out** (there was no sign-out in the bar before). It closes on Escape or a click outside. The phone drawer has the same items plus Sign out.
  - The main bar is now Home · Jobs · Applications · Outreach · **Integrations**.
  - Integrations has Gmail (moved from Settings), GitHub (moved from Profile → GitHub projects) and Services (status + lookup allowance, moved from Settings → Integrations).
  - Profile = Details, Resume, Application answers. Settings = Account, Privacy.
  - Old URLs redirect: `/profile/github`, `/settings/gmail`, `/settings/integrations`. Server messages now say "Integrations → Gmail".
- **Files:** [AccountMenu.tsx](frontend/src/app/AccountMenu.tsx), [nav.ts](frontend/src/app/nav.ts) (`inAccountMenu`, `ACCOUNT_SECTIONS`), [TopBar.tsx](frontend/src/app/TopBar.tsx), [Sidebar.tsx](frontend/src/app/Sidebar.tsx), [features/integrations/](frontend/src/features/integrations/).
- **Status:** aaf2afa is live. The browser test passed: bar order, menu items, Escape, Profile tabs, Integrations tabs, all 3 redirects, phone drawer Sign out, and Sign out → sign-in screen that survives a reload.

### 2026-10-14 — Step 3: Gmail (each user's own account)
- **Decision:** every user connects their OWN Gmail with an app password. "Sign in with Google" may come later; the restricted scopes need Google's CASA review. Each user's Gmail also emails them their own list, summary and reply alerts. There's no shared site sender; the old `GMAIL_USER` mailer stays only as a fallback.
- **What:**
  - **gmail_connections:** the sealed app password, verified against both SMTP and IMAP before it's saved.
  - **Outbox** (`email_outbox`):
    - The first email goes at the next 8–11 AM weekday slot in the recipient's time zone. The zone comes from the company's location (`sendWindow.timezoneFor`), else from the user's market. "Send now" is also available.
    - Daily cap per user is 20 by default (settable 1–40), with a gap of at least 3 minutes between sends.
    - Two follow-ups go in the same thread (In-Reply-To), 4 and 10 business days after the first send, with the original quoted.
    - One first email per contact. Edit or cancel any scheduled email; cancelling the first email cancels its follow-ups.
    - When Google rejects the password, the connection is flagged `error` and sends are held until reconnect, with no repeated logins.
  - **replyWatcher** (IMAP, read-only, every 10 min, `status = 'ok'` users only):
    - A reply is matched by thread headers or by an address we emailed. It marks the contact `replied`, cancels follow-ups, and emails the user about it.
    - Out-of-office auto-replies are noted but don't stop follow-ups.
    - A bounce marks the address invalid and cancels follow-ups.
    - LinkedIn "X messaged you" / "X accepted your invitation" emails mark the contact `replied` / `connected`, matched by unique name.
  - Alert digests are sent from the user's Gmail when it's connected.
  - **UI:**
    - Settings → Gmail: connect steps, status, test email, sender name, daily cap, disconnect.
    - Company composer: "Send at the best time" / "Send now". Without Gmail, the old Open in Gmail button stays, plus a connect hint.
    - New Outreach → Outbox page: replies feed, threads with each step's status and time in the recipient's zone, Edit/Cancel, and "Check for replies".
- **Files:** [024_gmail.sql](supabase/migrations/024_gmail.sql), [gmail.js](backend/services/gmail.js), [outbox.js](backend/services/outbox.js), [replyWatcher.js](backend/services/replyWatcher.js), [sendWindow.js](backend/services/sendWindow.js), [routes/gmail.js](backend/routes/gmail.js), crons in [server.js](backend/server.js) (`*/2` outbox, `*/10` replies), [GmailTab.tsx](frontend/src/features/settings/GmailTab.tsx), [OutboxPage.tsx](frontend/src/features/outreach/OutboxPage.tsx), [outbox.ts](frontend/src/features/outreach/outbox.ts). New dependencies: imapflow, mailparser (also installed on the VM).
- **Status:** live; migration 024 applied.
  - Tests: backend 133/133, frontend 60/60.
  - Live checks passed:
    - Google really rejects a bad app password, and the user sees the plain-language message.
    - A scheduled email landed Thu 8:42 AM Chicago for an Austin company.
    - A second email to the same person is refused. Edit and cancel work.
    - "Send now" with a rejected password is held, the connection is flagged, and the reply check returns a friendly 502.
    - Browser checks pass for Settings → Gmail, Outbox and the company page, desktop and phone.
  - The test data was removed.
  - **Not yet verified:** a real send, a real reply and LinkedIn detection. That needs a real app password; the user connects theirs, then do a live send-to-self and reply test.

### 2026-10-14 — Step 2: the resume engine (tailor, fact check, ATS, LaTeX PDF, cover letter)
- **What:** One tailored resume per evaluation, run in the background, polled by the UI.
  - The master resume is read into sections once per upload (Opus, low effort, structured outputs) and cached in `resume_files.parsed`. It starts on upload.
  - ATS keywords come from the job description via Groq (`keywords` task). A different model from the writer, so the writer never grades itself.
  - Opus (`resume`, effort from `RESUME_EFFORT`, default high) gets the rules, the master and up to 12 included repos (system prompt, cacheable) plus the job description and keywords. It returns chosen bullets and projects, skills, a change list and notes.
  - **resumeGuard** rebuilds the draft from the real material:
    - Contact, education and extras are copied from the master.
    - Every job is kept, with its real title and dates.
    - Bullets whose numbers aren't in that job's original are dropped.
    - Projects must be a master project or an included repo, with tech and numbers found in that project's own text.
    - Skills must appear in the background.
    - Every removal is reported.
  - Skills the candidate has but the draft left out are added (only those found in the background).
  - **latex.js** uses no extra packages (geometry/hyperref/lmodern only), with `\pdfgentounicode`. Escaping blocks command injection, and pdflatex runs with `-no-shell-escape`. Content is shortened step by step until it fits one page.
  - **ats.js** scores the text pulled back out of the PDF: 85% weighted keyword coverage (required 3, preferred 1.5, soft half) plus 15% for 7 format checks. 90 or above is `ready`; under 90 is `needs_review` ("Waiting on you"), with the missing keywords split into ones you have vs ones you don't.
  - The PDF is saved via `saveForEvaluation` (becomes `resume_file_id`). Auto-apply calls `resumeGate` and holds under-90 resumes until "Send it anyway" (`approved_at`).
  - Cover letter: Opus, 3 paragraphs. Sentences whose numbers aren't in the resume, job title or job description are dropped. LaTeX PDF saved as `resume_files.kind = 'cover_letter'`.
  - The UI is a Tailored resume panel on Evaluate: score, badge, download, missing keywords, keywords on the page, failed checks, projects chosen, changes, removed by the fact check, and the cover letter. It replaced the "suggestions only" box.
- **Files:** [023_resume_engine.sql](supabase/migrations/023_resume_engine.sql), [resumeEngine.js](backend/services/resumeEngine.js), [resumeGuard.js](backend/services/resumeGuard.js), [ats.js](backend/services/ats.js), [latex.js](backend/services/latex.js), [routes/resumeEngine.js](backend/routes/resumeEngine.js) (`/api/resume-engine/...`), [llm.js](backend/services/llm.js) (`schema` → Claude `output_config.format`; tasks `keywords`, `resume_parse`), [TailoredResume.tsx](frontend/src/features/applications/TailoredResume.tsx), [tailoring.ts](frontend/src/features/applications/tailoring.ts).
- **VM:** installed texlive (latex-base/recommended/extra, fonts-recommended, lmodern) via apt. Migration 023 applied. Backend at 2606975 plus the cover-letter title fix.
- **Status:** live and tested on the e2e account against Robinhood Backend Intern (eval 11).
  - 49 s per run. ATS 41% → `needs_review`, which is correct for a thin test resume. 13 missing keywords were listed, none invented. Clean one-page PDF.
  - Browser test passed (panel, download, cover letter, Send anyway, phone width).
  - Tests: backend 121/121, frontend 57/57.
  - Real costs: tailor $0.057, master parse $0.018 (once), keywords $0.0005, cover letter $0.038.
- **Follow-up:**
  - A real resume plus repos will cost more per run (~$0.10). 15 a day could exceed the $30/user monthly cap. Use the Batches API (50% off) for the nightly approved list in step 4.
  - The master-parse → Profile "What we read" view isn't built yet.
  - Step 3 is Gmail.

### 2026-10-14 — Pipeline tab removed; it's now the tracker on Auto-apply
- **What:** the user saw no point in a separate Pipeline tab (it duplicated Auto-apply and sat empty), so it was folded in (`583e9bc`, `b22cc44`).
  - Auto-apply now ends with an **"After you apply"** section ([Tracker.tsx](frontend/src/features/applications/Tracker.tsx), formerly PipelinePage). It has the funnel, follow-up nudges, notes, search, and List/Board.
  - It shows **sent applications only**, plus roles Closed after applying. Scored-but-unsent roles stay on Evaluate, whose recent list gained "Show all N". Auto-apply's old "Sent" list was dropped as a duplicate.
  - `/applications/pipeline`, `/board`, `/ranked` and the legacy `/pipeline` and `/apply/*` URLs redirect to `/applications/auto-apply#tracker`. `Redirect` in App.tsx now merges query strings into targets that already carry a `?`/`#`.
  - Home's link now reads "Track them". `/career-ops` now goes to Evaluate.
  - The e2e `dashboard.spec.js` was checking a stale "Pipeline" heading; it's fixed, and a redirect test was added.
- **Status:** verified live as the e2e user with seeded rows (since deleted): the redirect and scroll, the never-sent role excluded, board, and phone width.
- **Follow-up:** none. Applications only reach this tracker once auto-apply or "I applied" sends them. Stage changes are manual until Gmail reply detection exists.

### 2026-10-14 — Pipeline page: follow-up nudges, notes, funnel + search, board
- **What:** `/applications/pipeline` gained four things, each shipped and checked live:
  - **Follow-up nudges:** applied roles quiet 7+ days get a banner, a "Follow up · N" filter, and a "Find someone at X" link (company page) or "Track X" (Companies search).
  - **Notes + next step:** a dialog per row. An overdue step shows red, today's shows amber.
  - **Funnel + search:** Applied, heard-back %, interview %, offers. Search covers company, role, notes and next step (`?q=`). Each row says auto-applied or applied by hand, or why auto-apply stopped.
  - **Board view (`?view=board`):** drag cards between stage columns. A "Move to…" menu covers touch and keyboard, and moves are optimistic.
  - **Also fixed:** the sort menu no longer stretches full width.
- **Backend** (`49c0aed`, VM `7ff3a6a`):
  - Migration **023_pipeline_notes** (applied) adds `notes`, `next_step`, `next_step_at`, `stage_changed_at`.
  - `PATCH /api/career/evaluations/:id/notes` is validated by `services/pipelineNotes.js`.
  - Moving to an applied stage stamps `applied_at` and `stage_changed_at`.
  - `/pipeline` now also returns `company_id` (jobs matched by name), apply mode, and the error.
- **Gotcha:** evaluation ids come back from pg as **strings**. Compare with `String(id)`. The first board drop silently did nothing because of this (`1821fa2`).
- **Files:** [PipelinePage.tsx](frontend/src/features/applications/PipelinePage.tsx), [PipelineBoard.tsx](frontend/src/features/applications/PipelineBoard.tsx), [NotesDialog.tsx](frontend/src/features/applications/NotesDialog.tsx), [pipeline.ts](frontend/src/features/applications/pipeline.ts), [careerOps.js](backend/routes/careerOps.js).
- **Status:** verified on prod as the e2e user, with 8 seeded rows (since deleted):
  - Drag, Move to…, and notes all save to the DB.
  - Checked in dark and light themes and at 390px. No console errors.
  - `npm run check` passes (55 tests), and backend tests pass (110).
- **Follow-up:** a parallel session has an uncommitted `supabase/migrations/023_resume_engine.sql`. **Renumber it to 024**, because 023 is taken.

### 2026-10-14 — Resumes live in cloud storage; every application records its file
- **What:**
  - Migration 022 adds `resume_files`: kind master/tailored/uploaded/library, bucket + path, size, sha256, the account's market at creation, and `is_current` (one current master per user). It also adds `evaluations.resume_file_id` (the file that will go) and `applied_resume_file_id` (the exact file sent).
  - Master uploads go to `resumes/<user>/master/<stamp>-<name>.pdf`, and every version is kept. Tailored and per-role uploads go to `tailored-pdfs/<user>/<eval>/…`.
  - The server no longer keeps resumes on disk: the global `data/resume/original.pdf` path is gone, and uploads use the OS temp dir until copied.
  - Auto-apply prefers `resume_file_id`, indexes library picks, records `applied_resume_file_id` on submit, and deletes every temp copy on every exit. It used to leak the archetypes it didn't pick.
  - Profile → Resume shows "Saved in the cloud", Download, Earlier versions, and **Which resume went where** (company/role, country + location, file, kind, Sent/Ready to send, download) with a country filter. Pipeline has a Resume column.
  - Phone fix: the screen-reader-only table header cells were widening the page. Table wrappers are now `relative`.
  - The list time is confirmed as **10 PM Central** (America/Chicago).
- **Files:** [022_resume_files.sql](supabase/migrations/022_resume_files.sql), [resumeFiles.js](backend/services/resumeFiles.js), [resumeStorage.js](backend/services/resumeStorage.js) (env read lazily), [careerOps.js](backend/routes/careerOps.js) (`/resume`, `/resume/files`, `/resume/files/:id/download`, upload-resume, tailored-resume, download, pipeline), [autoApplier.js](backend/services/autoApplier.js), [ResumePage.tsx](frontend/src/features/profile/ResumePage.tsx), [resumeFiles.ts](frontend/src/features/profile/resumeFiles.ts), [PipelinePage.tsx](frontend/src/features/applications/PipelinePage.tsx).
- **Status:**
  - Commits bab3e40 and 1b2a552 are on main and live. The backend patch was applied on the VM (2c85eb9). Migration 022 has been applied.
  - Tests: backend 108/108, frontend 49/49.
  - Live checks passed: API upload, history and download are byte-identical; the per-role upload shows in the Pipeline; a second account gets 404 on the first account's files; browser checks pass on desktop and at phone width.
  - The only file on the VM disk was the e2e account's test PDF. It is now in the cloud (resume_files #1), and the disk copy was moved to /tmp. The user's real account hasn't uploaded a resume yet.
- **Follow-up:** next is step 2, the Opus resume engine (structured master, project pick, ATS ≥ 90, change report, LaTeX → PDF, cover letter). Account deletion doesn't remove storage objects yet.

### 2026-10-14 — Plan: referral first, then apply; outreach timing
- **What:** Decisions only, no code yet.
- **Referral first:**
  - Approved roles get a referral ask first (8–11 AM recipient tz, the morning after approval). Contacts: LinkedIn connections export, then alumni, then team engineers.
  - Wait **2 business days**. A referral link or code means apply through it. "I submitted you" marks the role Referred. No referral means **apply anyway** the next morning (6–10 AM company tz), notify the user, and send the contacts an "I've applied" note.
- **LinkedIn referrals:** the user reports these on the site. Each role waiting on a referral gets "Got a link/code" (paste box), "They submitted me" and "They said no" buttons, and any of them stops the 2-day timer.
- **Cold email timing:** weekdays 8–11 AM recipient tz, max 20 a day, follow-ups on day 4 and day 10 that stop on a reply.
- **LinkedIn:** notes are drafted in-app, and the user sends them by hand with copy + open profile. Automating is against LinkedIn's terms.
- **Replies:** Gmail via IMAP or OAuth. LinkedIn replies are detected via LinkedIn's notification emails in Gmail.
- **Status:** build order unchanged: storage → resume engine → Gmail → daily flow (now includes the referral stage) → WhatsApp.
- **Follow-up:** the user still needs to add GMAIL_USER/GMAIL_APP_PASSWORD and confirm 8 PM Eastern.

### 2026-10-14 — Every page on the new UI; sponsorship per role; experiences

- **UI:** Home rebuilt (Analytics folded in, AI-spend card), Outreach Contacts and Templates, and the company page (`4d89397`). The legacy wrapper is gone from routes; `components/*.jsx` are now unused files.
  - Company page dropped: the Career Ops tab, Job Automation (one-click apply bypassed the daily plan), the resume picker, and auto-queue on scrape.
  - Cover letter and WaaS now call `/generate/cover-letter` and `/generate/waas`; before, they hit `/generate/email`.
- **Sponsorship** (`09af8b7`, `f520997`, `034df90`, migration 020):
  - `services/sponsorship.js` classifies sponsors / no_sponsorship / citizens_only (clearance / US persons) and keeps the deciding sentence.
  - `enrichPostingDetails` (in `payEnricher.js`) reads descriptions from Greenhouse/Ashby/Lever (one request per board) plus Workday/SmartRecruiters (per posting) plus stored descriptions (Indeed via JobSpy now keeps `description`).
  - First run: 1,562 read, 549 pay, sponsors 8 / no 101 / citizens 83 / not stated 1,370, 39 failed. **Workday CXS returns 403.**
  - Roles shows a visa badge (the quote on hover) and a visa filter, defaulting to "hide won't sponsor" when needs_sponsorship=1.
  - Roles also shows source prominence and `also_on`, and SpeedyApply leads each day.
- **SpeedyApply pay:** only their FAANG+/Quant tables have a Salary column (NEW_GRAD_USA: 124/881 rows); we capture all of it. levels.fyi was declined again (ToS).
- **Experiences** (`990f73c`, `99d169c`, migration 021): `user_profile.experiences` JSONB list editor on Details. current_company/title follow the newest entry.
- **Known bug:** add-company-by-name "Ramp" matched YC "WorkRamp" and copied its location.
- **Next:** resumes in cloud storage (master in Supabase Storage per user; every tailored PDF/LaTeX/report stored and linked to the application, visible in Pipeline and Profile), then the Opus tailoring engine, then the daily plan.

### 2026-10-14 — AI keys live; one capped door for every AI call

- The user pasted new OpenAI, Groq and Anthropic keys into the local `.env`. They were validated (free model-list calls), then copied into the VM `.env` without being printed. Backup is `.env.bak-*`.
- `services/llm.js` (`760e8f7`) is now the only AI client:
  - **score / evaluate / email / categorize** → Groq `openai/gpt-oss-120b` (`gpt-oss-20b` for categorize), with OpenAI `gpt-4o-mini` as backup.
  - **resume / cover_letter** → Claude Opus 5.5 only, no fallback.
  - Every call is written to `ai_usage` (migration 019) with tokens and cost.
  - **Hard caps:** `AI_MONTHLY_CAP_USD` (default $40 site-wide) and `AI_USER_MONTHLY_CAP_USD` (default $30/user). Calls are refused with a 402 once a cap would be exceeded.
  - The signed-in user reaches deep services via AsyncLocalStorage (`services/requestContext.js`).
  - Gemini removed. Categorization no longer falls through to Opus.
  - `GET /api/credits/ai-usage` reports spend against the caps.
- **pm2 bug** (`2c9fd42`): pm2 had saved the revoked OPENAI key, and dotenv doesn't override, so `server.js` now loads `.env` with `override: true`.
- Verified live:
  - Groq score: $0.00006.
  - Opus rewrite: $0.003.
  - Full evaluate via the API: Groq **413 "Request too large"** (free tier ~8K TPM), then the OpenAI backup succeeded for $0.002.
  - **The user must upgrade Groq to the Developer (paid) tier** for evaluations to run on Groq. Until then OpenAI mini is used.

### 2026-10-14 — Pay on roles, Applications rebuilt, AI plan agreed

- **Pay:** Greenhouse/Ashby/Lever public board APIs fill posted pay (`services/payEnricher.js`, `payParse.js`, migration 018 `pay_checked_at`). The lookup runs after both daily scrapes and filled 457 roles on its first run; US coverage is now 27–32%.
  - JobSpy pay keeps its currency (INR in lakhs). Funding-round amounts aren't read as pay.
  - Roles has a Pay column and a "Pay posted" filter (`pay=1`). levels.fyi was declined: its terms forbid scraping.
- **Applications rebuilt** (`10e1513`): Auto-apply / Evaluate / Pipeline, and Profile → Resume.
  - Removed: portal scanner, batch evaluate, history, ranked, resume folder.
  - Scores are shown out of 10.
  - Automatic applying stays locked in the UI until the daily plan exists. Rules default to 9.0+ and **15/day** (user changed this from 30).
- **AI is down on prod:** the OpenAI key is rejected (401), Gemini has 0 quota, and there's no ANTHROPIC_API_KEY. Evaluate shows a plain "scoring is down" message.
- **AI plan the user agreed to ("Smart, 15 a day", ~$45/mo):**
  - OpenAI for everything except resumes: gpt-4o-mini quick score, then gpt-4o short evaluation, both batched overnight.
  - **Claude Opus 5.5 for resume drafting, ATS check and cover letters.** If Opus is down, wait and retry; no silent fallback.
  - Batch APIs (50% off) for the overnight plan, short eval output (full report only on open), prompt caching, no duplicate work, cover letters only when required. Also an in-app spend cap plus a usage display in Settings.
  - Waiting on the user for **new OpenAI and Anthropic keys**.
- **Still old design:** Home (needs improving), Analytics (fold into Home), Outreach contacts, Templates, company page.

### 2026-10-14 — Full account wipe; country per account (USA / India / other)

- **Wipe** (user-requested, both choices confirmed): deleted all 5 accounts, emptied all 17 user tables, removed 9 stored files and the old disk files (reports, resumes, outreach.db).
  - **Kept** the shared job catalog (scraped_roles) and provider_domain_cache.
  - Backup: `~/outreach-backups/wipe-2026-10-13-2358.tgz` plus `…-applications.md`, on the Mac and on the VM.
  - Test accounts recreated after: e2e@, e2e+india@, e2e+nochoice@ outreach-os.local.
- **Markets**: backend `c561dd1`, `eb88170`, dedupe fix (VM). Frontend `5de342c`. Migration 017 applied.
  - `user_profile.job_market` is usa | india | other. `scraped_roles.region` gains `india` (intl = other countries). Mapping lives in `services/markets.js`, mirrored in `frontend/src/lib/markets.ts`.
  - India is matched on whole words (Indiana/Indianapolis stay US). Intl rows in India moved to india.
  - Sign-up asks for a country, stored in auth user_metadata. `MarketGate` copies it to the profile on first sign-in, or asks once.
  - Roles shows only the two lists for your market; `/jobs/roles/intern|new-grad` are market-relative, and old `-intl` links redirect.
  - Home counts and alert digests are filtered by market too. Country is editable in Profile ("Looking for jobs in").
  - JobSpy also searches Indeed + LinkedIn **India** (cron source `jobspy_india`). India: 204 intern / 415 new grad.
- **Fixes found on the way:**
  - `persistCatalogRows` lost whole 200-row chunks on duplicate apply_url. It now dedupes.
  - JobSpy near-matches ("Director, AI…" under internships) are filtered by title (`titleFitsRoleType`); 159 hidden.
  - Duplicate "Country" labels on Details renamed.
- Verified in a browser before the Mac restart: all 8 market checks passed. The scratchpad helpers were lost in the restart and re-created (`mint-session.mjs` now creates test users).

### 2026-10-13 — Sign in with GitHub (rule 2)

- Backend `20a5717` (VM same), migration 016 applied; frontend `01efaf5`, live at `/profile/github`.
- OAuth app "OutreachOS" (client `Ov23liS2sRLAmBIUgQTz`). The secret is in the VM `.env` only, as GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET, plus a generated TOKEN_ENC_KEY. `.env.bak-*` was taken first.
  - No scopes: public repos only.
  - Callback `https://outreach-jt.duckdns.org/api/github/callback` is public; it trusts only an HMAC-signed 10-minute `state`.
  - Tokens are AES-256-GCM sealed and refreshed when they expire, because "Expire user access tokens" is on.
- Repos import into `github_repos` with README text (3k chars) and language bytes. Forks and archived repos start excluded; the user can untick any repo.
- Verified: forged state → redirect with error; `/connect` builds the right URL; GitHub accepts the client id. **Not verified:** a real sign-in, which needs the user's GitHub login.
- Noticed: the VM `.env` has **no ANTHROPIC_API_KEY**, so Claude calls fall through to the other providers.

### 2026-10-13 — New look live; Profile (details + answer bank); apply pipeline rules

- **New look shipped** (`b735a81`): Fraunces display + IBM Plex, hairline rules, dark default (Paper Dark), cream light theme. The sidebar is now a top bar with section sub-tabs; the drawer remains for phones. Legacy pages still render old inside it.
- **$0 salary bug** (`a473e06`, VM `14c6260`): JobSpy rows without pay showed "$0" (Number(null) = 0). Fixed, and the 406 bad rows were cleared in prod.
- **Profile section** (`8f22323` backend + migration 015 applied, `65ece0a` frontend):
  - `/profile/details`: every user_profile field; work authorization now defaults to "Choose…", not US Citizen.
  - `/profile/answers`: answer bank (`application_answers` table, `services/answerBank.js`, `/api/profile/answers`). Pending questions from forms come first.
  - `answerFor(userId, question)` is the hook auto-apply will call: a miss records the question as pending.
  - Browser-tested against prod with the e2e user (answer / edit / delete, details persist).
- **The user's apply rules** (2026-10-13), in order:
  1. Fill all details. Done.
  2. GitHub = **project repos only**, via **Sign in with GitHub**. The user must register an OAuth app.
  3. Tailor the resume per JD, with a per-role **change report**.
  4. **Pick projects per JD** (from the resume plus GitHub repos).
  5. **ATS ≥ 90%**. Never invent skills; under 90 goes to "Waiting on you".
  6. Output **LaTeX → PDF**, attached to the application.
  7. Cover letter when the form needs one.
  - Master resume stays a **PDF uploaded on the site**, parsed into editable structure.
  - **Daily plan list goes out before anything is applied.** Up to 30 a day; 9+ out of 10 is planned.
- **Next:** master resume structure + GitHub OAuth → LaTeX tailoring engine (tectonic on VM, ATS scorer, change report, cover letter) → daily plan + auto-apply wiring → rebuild the remaining legacy pages.

### 2026-10-13 — JobSpy live + detailed per-tab designs (A vs B)

- **JobSpy:** see commit `d8d5794` (VM `d39f7ec`).
  - python-jobspy 1.1.82 runs from `~/outreach/.venv-jobspy` on the VM. Indeed and LinkedIn work; Glassdoor and Google fail.
  - It feeds the 06:15 UTC multi-source scrape and gave 558 roles on the first run.
  - Apify is now used only for LinkedIn people search, not for job listings.
- **Resume decision:** no GitHub repo. The user uploads a master resume in the app, and each job gets a tailored copy. There is also an "application answers" profile: standard fields, custom Q&A, and new questions that pause auto-apply until answered.
- **Designs:** the user liked A (Midnight) and B (Paper) and asked to see every tab. All 19 boards are on the canvas at https://claude.ai/artifact/Ugn3nsAuXHtSpLYD1qEaHL, one row per page with A and B side by side.
  - Pages: Home, Roles, Companies, Company, Evaluate, Applications (pipeline, while-you-slept log, needs-you, nightly settings), Outreach (Gmail review queue, campaigns with auto-send and caps, follow-ups), Profile (master resume, tailored versions, application answers), Settings (Gmail, WhatsApp, lookup budgets, job sources).
  - **Picked:** B layout and fonts on a dark palette (boards Mix-Evaluate, Mix-Applications). Scores move to /10. Auto-apply: 9+ sends on its own right away; 7–8.9 waits for one tap; below 7 left alone; **30/day cap** (user-set), one role per company per 30 days. A **daily plan list** of what will auto-apply goes out at 7 AM (WhatsApp + email) and is shown on the Auto-apply page with Hold/Remove per role. The chosen look has its own canvas: https://claude.ai/artifact/NpYRtVUKeXLNanm2YykTpH
  - Next: confirm the remaining pages in this look, then rebuild the live pages and build the integrations.
- **Still open:** Gmail OAuth needs a Google Cloud OAuth app from the user. WhatsApp provider (Meta Cloud API or Twilio) not chosen yet.

### 2026-10-13 — SpeedyApply daily lists + redesign kickoff

- **SpeedyApply:** see commit `1f0b76a`.
  - `services/speedyApply.js` mirrors their `get-jobs.ts` generator and auto-discovers the newest `<year>-SWE/AI-College-Jobs` repos.
  - All four lists are kept, with region `usa`/`intl` and `tracks` {swe, ai}, plus salary, posted date from Age, `company_url` and tier (faang/quant/other).
  - New 12:30 UTC cron, since they publish at 12:00. Digests moved to 13:00 UTC, USA only.
  - Upserts are batched: 5,368 rows in 10s. Migration `014_scraped_roles_details.sql` applied.
  - Roles page: four list tabs, an All/SWE/AI-ML switch, a FAANG+/Quant filter, salary and tier badges.
  - Not done yet: **JobSpy** (speedyapply/JobSpy, a Python LinkedIn/Indeed/Glassdoor scraper) as a free Apify replacement.
- **Redesign:** the user wants a **new look for the whole site** (rejected the current dark design as final). Three directions are mocked up at https://claude.ai/artifact/Ugn3nsAuXHtSpLYD1qEaHL (A Midnight, B Paper, C Soft Focus). Waiting for their pick, then rebuild every page in it.
- **New features requested** (handwritten note):
  1. **Gmail** sending: hybrid. New emails go through a review queue; per-campaign auto-send with a daily cap; follow-ups automatic.
  2. **GitHub** resume: their main template resume in a repo is the master, and each picked job gets a tailored copy. Need the repo URL and format.
  3. **Auto-apply while sleeping:** the nightly pipeline exists; it needs to be visible and trustworthy.
  4. **WhatsApp:** updates plus approvals (reply SEND/SKIP).

### 2026-10-13 — UI rebuild phase 2: Jobs (Roles + Companies)

- **Jobs section:** now two tabs.
  - **Roles** (`features/jobs/RolesPage.tsx`): catalog, intern/new-grad switch with counts, search and source in the URL, Track / Auto-apply with optimistic state, and an "Email alerts" dialog pre-filled from the current search. This replaces the Job Alerts page.
  - **Companies** (`CompaniesPage.tsx`): industry rail with counts, search/status/sort, inline status, people/email counts, roles checked, Add by name. It also hosts the "Find companies" dialog, which replaces the Job Scraper page: YC directory (free) or job boards, with a warning when Apify is down.
- **Redirects:** `/jobs/find`, `/discover/scraper` → `?find=1`; `/category/:name` → `?category=`; `/jobs/alerts` → Roles.
- **Fixed:** the scrape query hardcoded "intern 2026"; it now uses the recruiting season (from August, next year).
- **Backend:**
  - Catalog refresh is lock + 6h cooldown + background (202), with new `GET /scraped-roles/refresh-status`.
  - YC import uses chunked multi-row inserts.
  - `unified/companies` email/people counts no longer only count Hunter rows.
- **Still legacy:** company detail (`/company/:id`), Applications, Outreach, Analytics.
- **E2E:** 40 passed / 4 skipped locally (new `roles.spec.js`, updated `scraper.spec.js`/`shell.spec.js`).

### 2026-10-13 — Shared provider cache + per-user budgets

- **Shared cache:** `services/providerUsage.js` plus migration `013_provider_cache_and_budgets.sql`. Hunter/Prospeo domain searches are cached in `provider_domain_cache` for 14 days and reused by every account; only a cache miss spends a credit.
- **Budgets:** each user has a monthly budget per shared key in `provider_usage` (defaults hunter 15, prospeo 25, apollo 40, serper 150; override with `<PROVIDER>_USER_MONTHLY_LIMIT`). The increment is atomic and refuses at the limit with `ProviderError('BUDGET')`, which shows up as a reason in the UI.
- **Applied in:** bulk Find Emails, per-contact Find Email, and Find People (Apollo + each Google query).
- **Other:** new `GET /api/credits/usage`, shown in Settings → Integrations as "Your lookups this month". `scraper.js` `runApifyActor` gained the 1h quota short-circuit. Backend tests: 67.

### 2026-10-12 — Backend hardening + email/people pipeline rebuild

Two read-only audits (pipeline + rest of backend), verified against code, then fixed:
- **Security:**
  - `PUT /career/company/:id` accepted `resume_path`, which the delete/analyze routes then unlinked or read. That allowed deleting any server file (e.g. `.env`) or reading another user's resume. Now server-only, and every stored path goes through `isWithin()` (`services/safePaths.js`).
  - Uploads check ownership and parse the id before multer runs (`middleware/ownedCompany.js`).
  - `resume_dir` is no longer client-writable.
  - SSRF: `services/safeFetch.js` (public IPs only, re-checked per redirect, size cap) now covers the evaluator, intern-roles, careers scraping and website email scraping. Auto-apply asserts a public URL. The scrape-and-queue loopback ignores `X-Forwarded-Host`. `detectPlatform` matches on hostname.
  - Alerts only go to the account email; test sends are limited to 1/min; the digest escapes quotes.
- **Multi-user:** outreach, cover letters and WaaS notes were written as the founder for every account. Now `services/senderProfile.js` builds the sender from the user's profile and resume, and returns 400 if both are empty. Default templates and the evaluator no longer contain founder details. Per-contact generation now uses saved templates.
- **Auto-apply:** atomic row claim (no double submit), a per-user run lock, and pause/consent/daily cap enforced inside `processOneEvaluation` (every path). The nightly route clamps body overrides. Dry runs release their claim. Direct apply refuses already-submitted rows.
- **Reliability:** `middleware/asyncSafe.js` routes rejected async handlers to the JSON error handler. Added a JSON 404 for `/api`, plus unhandledRejection/uncaughtException logging. Removed `maybeWipeDb` and the 06:00 daily-refresh cron and `refresh-all`, which spent roughly 100 Apify runs a day and discarded the results. Crons now use `{ timezone: 'Etc/UTC', noOverlap: true }`.
- **Numbers:** `services/applyStatus.js` is the single status vocabulary. "Applied" now means actually submitted; added `inFlight`/`failed`; replies count as sent; the queue shows `submit_failed`/captcha/login rows. Quoted the `"jobTitle"`/`"jobDescription"` aliases, so reclassification sees titles. The per-source scrape buttons now post to `/jobs/scrape`.
- **Email/people pipeline:** new modules `companyDomain.js` (tldts, about 100 ATS/job-board hosts, exact-name known-domain map, MX check for guesses), `contactRules.js`, `providerGuard.js` (typed errors + 1h quota cooldown), `emailProviders.js` (timeouts) and `contactFinder.js` (ordered waterfall plus `upsertContact` dedupe/enrich).
  - Routes in `jobs.js` were rewritten with per-lookup locks, user-facing `reasons`/`message`, a 7-day negative cache for misses, and `force` to retry.
  - Find People was rebuilt in `apify.js`: it uses the trusted domain or a plausibility-checked name lookup, aborts on disconnect, includes recruiters, and only takes Google results that name the company.
  - Removed `hunter.js`, `emailfinders.js`, `domainResolver.js` and the legacy `/api/contacts` and `/api/emails` routers.
- **Migration:** `supabase/migrations/012_contact_finding.sql` adds `jobs.domain_source`, `job_contacts.email_confidence/email_lookup_at/email_lookup_note`, and unique indexes on lower(email) and lower(linkedin_url).
- **Tests:** backend 63 (`npm test --prefix backend`).
- **Deployed:** migration 012 applied. The VM backend is now synced to main (`f489d84` = main `c16386a`; it had drifted — missing alerts/mailer/digest code, which caused the Job Alerts 404). Health 200. Live checks: resume_path injection is ignored, bogus ids get 400, the evaluator refuses metadata/localhost URLs, and a real Find Emails run on Anthropic used the known domain and saved 2 verified contacts with no duplicates on repeat (test rows removed). E2E against prod: 37 passed / 4 skipped.
- **Still open:**
  - Alert emails aren't configured on the server (`GMAIL_USER`/`GMAIL_APP_PASSWORD` missing → `emailConfigured:false`).
  - Domain-search results aren't cached, so a repeat bulk click spends another Hunter credit.
  - Per-user credit budgets for the shared provider keys.
  - `scraper.js` `runApifyActor` lacks the quota short-circuit.
  - The Gemini free tier is at quota 0 (fallback is dead).

### 2026-10-12 — Claude path modernized (OpenAI stays live)

- **What:** User chose "modernize the Claude path only". `@anthropic-ai/sdk` 0.17 → **0.128.0** (pinned, backend + root package.json). New `backend/services/claude.js` is the single Claude helper: `claude-opus-5-5`, explicit `output_config.effort`, `max_tokens` 16000 (thinking counts toward it), server-side refusal fallback (`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`), refusal/max_tokens checks before reading content, text read by block type, SDK-level timeout + retries.
- **Call sites:** `ai.js` outreach (effort medium), `jobEvaluator.js` A–G evaluation (high, rubric prompt-cached; removed `temperature`, which 400s on current models), `resumeGenerator.js` tailoring (medium), `categorize.js` classification (low). OpenAI/Gemini code is untouched.
- **Status:** inactive in prod. The VM's `ANTHROPIC_API_KEY` is empty and `AI_PROVIDER=openai`. To turn it on, set the key in `~/outreach/.env` and `pm2 restart outreach-backend --update-env`. For evaluation, Claude stays third in line after OpenAI and Gemini (existing order).
- **Deployed:** VM `b4ba366` (backend files only from main `e80c4aa`), deps reinstalled (`npm ci` failed on the VM, so the `npm install` fallback ran), health 200. Note that Node 20 on the VM prints test results as `# pass`, not `ℹ pass`.
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

### 2026-10-15 — Rotated Apify API token
- **What:** User saved a new `APIFY_API_TOKEN` (ends `…8Gsy`, Apify account `charitable_raisin`) in local `.env`; copied it to the VM's `~/outreach/.env` and ran `pm2 restart outreach-backend --update-env`.
- **Status:** Live. Apify `/v2/users/me` accepts the token; `/api/health` → `ok`, `has_apify: true`. Old token backed up on the VM at `~/outreach/.env.bak-apify` (delete once confirmed unneeded).
- **Follow-up:** If Vercel env vars also hold an Apify token, update it in the Vercel dashboard (frontend doesn't normally need it).

### 2026-10-15 — Profile → Details: "Fill from resume"
- **What:** New button next to Save. Calls new `POST /api/resume-engine/master/read` (returns `parsedMaster()`: cached parse, or one Opus call if the master was never read) and fills **only empty** fields: name, email, phone, location, LinkedIn/GitHub/portfolio, first education entry (school/degree/major/graduation/GPA), skills, certifications; merges resume roles into Experience (drops blank entries; a role already listed by company+title only gets its empty fields). Dates "Jun 2025" → `2025-06`; "Present" → I work here now; bare years left empty. Nothing saved until the user clicks Save.
- **Files:** [resumeFill.ts](frontend/src/features/profile/resumeFill.ts), [DetailsPage.tsx](frontend/src/features/profile/DetailsPage.tsx), `api.js`/`lib/api.ts`, [backend/routes/resumeEngine.js](backend/routes/resumeEngine.js). Tests in `profile.test.ts`.
- **Status:** `33cac42` on main (Vercel live). Backend route applied on the VM as `fd0c4fb` (only the backend file, `git show … | git apply`). Verified live as the e2e user: toast "Filled 11 fields…", experience entry added, no console errors, no horizontal scroll at 390px. Not saved.

- **2026-10-15 — Fix "Turn on" on Auto-apply.** `saveSettings` in `backend/services/dailyPlan.js` wrote `auto_apply_consent = true`, but the column is `INT` (migration 006), so Postgres rejected it ("column auto_apply_consent is of type integer but expression is of type boolean"). Now writes `1`. Commit `944b4cb` on main; cherry-picked to the VM as `ffb5d28`, pm2 restarted, health 200.

### 2026-10-15 — Fix: long Details page scrolled the whole app shell
- **What:** After "Fill from resume" added the user's 5 roles, the top bar slid off and a blank band appeared below the content. Cause: each experience card's `sr-only` `<legend>` (position:absolute) had no positioned ancestor, so it sat against the document at its static position (~4000px down), making `<html>` scrollable even though the shell is `h-full overflow-hidden`. Fix: `relative` on `Page`'s scroller ([PageHeader.tsx](frontend/src/ui/PageHeader.tsx)) and on the experience `<fieldset>`.
- **Status:** `a20dd82` live on Vercel. Verified on prod with 6 mocked roles: document scrollHeight = viewport (900), only the inner scroller moves, no console errors. "Fill from resume" itself was fine for the user (their 5 roles and dates all mapped correctly).

### 2026-10-15 — Delete earlier master resume versions
- **What:** Trash button + ConfirmDialog on Profile → Resume → Earlier versions. New `DELETE /api/career/resume/files/:id` → `deleteMasterVersion()` in [resumeFiles.js](backend/services/resumeFiles.js): master kind only; refuses the current version (400) and any version an evaluation points at via `resume_file_id`/`applied_resume_file_id` (409); removes the Supabase Storage object (tolerates already-gone) then the row. `resumeHistory()` masters now carry `in_use`; in-use rows show no trash button.
- **Status:** `f5ac292` on main (Vercel live); backend applied on VM as `94abed4`. Verified live as e2e user: current-version delete → 400 with message; deleted the e2e user's old unused `test-resume.pdf` version via the UI (toast, row gone, API list confirms). The 409 in-use path wasn't exercised live (no in-use earlier version exists).

### 2026-10-15 — Fix: Home "Set your auto-apply rules" step never completed
- **What:** The setup checklist still read the old nightly settings (done only when moved off 85 / 50). The auto-apply page now saves the daily list (`meta.daily_plan_settings`), so the step stayed open for the user even with the list on (theirs: enabled, 9+, 20/day, 9 PM). `rulesSet` now = `useDailyPlan().data.settings.enabled` ([HomePage.tsx](frontend/src/features/home/HomePage.tsx)). `useNightlySettings` is now unused outside `app/queries.ts`.
- **Status:** `7315977` live. Verified on prod as e2e user with the overview response's `enabled` forced off/on: checklist 1 → 2 of 6.

### 2026-10-15 — Fix: app stuck on a bare spinner when the session refresh hangs
- **What:** User saw an endless spinner on another machine (work laptop). `AuthProvider` waits on `supabase.auth.getSession()`, which refreshes an expired stored token over the network; if `*.supabase.co/auth/v1/token` never answers (VPN/firewall) the app never leaves the spinner. New [AuthWait.tsx](frontend/src/app/AuthWait.tsx): after 8s shows "Still checking your sign-in" with **Try again** (reload) and **Sign in again** (removes `sb-*` localStorage keys, reloads → login page).
- **Status:** `7beb414` live. Reproduced on prod with an expired stored session + held refresh request (blank spinner before; stall screen after), and "Sign in again" lands on the login page. Root cause on the user's machine not confirmed. If it was a hard block on supabase.co, sign-in there will still fail until the network allows it.

### 2026-10-15 — UX: Integrations overview + first-run walkthrough on Home
- **What:** User feedback: "no walkthrough, I don't understand what Integrations does." (1) `/integrations` was a redirect to Gmail; it is now an **Overview** page (new first tab): one card per connection (Gmail, LinkedIn connections, WhatsApp, GitHub) with what it does in one sentence, "What you get" bullets, setup effort, live status badge (Connected / Not connected / Needs attention / Checking…) and a Set up / Manage / Fix it link. (2) Home shows a **"How Scout’n’Jobs works"** card with three steps (Tell it about you → Connect your accounts → Every evening, a list), each linking onward; it hides once all 6 setup steps are done or the user clicks Hide (`localStorage snj.walkthrough.dismissed`). (3) The setup checklist opens all steps by default when 0 are done.
- **Files:** [overview.ts](frontend/src/features/integrations/overview.ts) (+ `overview.test.ts`), [IntegrationsPage.tsx](frontend/src/features/integrations/IntegrationsPage.tsx), [Walkthrough.tsx](frontend/src/features/home/Walkthrough.tsx), [HomePage.tsx](frontend/src/features/home/HomePage.tsx), `app/nav.ts`, `app/App.tsx`. Frontend only, no backend change.
- **Status:** `bc58f1f` on main, live on Vercel. `npm run check` green (82 tests). Verified on prod as e2e user in light and dark at 1400px and 390px: walkthrough renders, Integrations shows 1 of 4 connected (LinkedIn), no console errors, no horizontal scroll.
- **Follow-up:** Same treatment is worth doing for Usage and People (both are opaque to a new user). Consider a first-visit tour of the nav itself.

### 2026-10-15 — UX round 2: Walkthrough tab, connection status everywhere, calmer styling
- **What:** User feedback: step 3 copy read wrong, wanted a walkthrough of what each tab does instead of a Home card, "something is off" with the design, and "the user should see somewhere what they've integrated". Usage and How it works were named as looking fine, so new pages now copy their patterns.
  - **How it works → Walkthrough** (now the default at `/how-it-works`): "If you're new, start here" (4 steps) + "Every tab, explained" (one card per section incl. Profile and Settings, a line per tab). Live queue view moved to `/how-it-works/flow` ("Your queue, live"). `walkthrough.test.ts` fails if a nav tab has no description.
  - **Home:** walkthrough card removed; a "New here? See what each tab does" link sits by the main buttons until setup is done. New **"Your accounts"** list under "So far" (dot, name, detail or Connect/Fix).
  - **Integrations overview** is now one "Your connections" card in the Usage → Service status row layout. Each Integrations sub-tab has a status dot.
  - One `useIntegrations()` hook feeds all three.
- **Files:** [walkthrough.ts](frontend/src/features/howitworks/walkthrough.ts), [WalkthroughPage.tsx](frontend/src/features/howitworks/WalkthroughPage.tsx), [useIntegrations.ts](frontend/src/features/integrations/useIntegrations.ts), [IntegrationsPage.tsx](frontend/src/features/integrations/IntegrationsPage.tsx), [overview.ts](frontend/src/features/integrations/overview.ts), [HomePage.tsx](frontend/src/features/home/HomePage.tsx), [AppShell.tsx](frontend/src/app/AppShell.tsx), `app/nav.ts`, `app/App.tsx`. `features/home/Walkthrough.tsx` deleted.
- **Status:** `cd8a9ca` + `aee94ab` on main, live. `npm run check` green (84 tests). Verified on prod as e2e user: light/dark at 1400px, 390px; no console errors, no horizontal scroll; e2e shows 1 of 4 connected (LinkedIn). Status endpoints: ~2s cold for `/gmail/status`, <1s warm.
- **Follow-up:** User still to confirm the new look. Candidates if "off" persists: the top bar is crowded (8 sections + search + status dot + theme + avatar); the unlabeled green status dot in the top bar means "services OK" and may confuse.

### 2026-10-15 — First-run tour of every tab + Help button
- **What:** User asked for the tabs to "come up" on first login and when asking for help on the right. Built a spotlight tour: 12 stops (welcome → each top tab → Profile/Settings under the avatar → status dot → Help). Each stop dims the page, rings the tab, and shows a card under it with what the section is for and a line per sub-tab (text from the Walkthrough guide, so they never disagree). On phones the tabs live in the ☰ menu, so stops show as centered cards. **Help** button at the right of the top bar (icon-only in the phone header) replays it. Keyboard: arrows step, Escape closes, focus trapped in the card.
- **Seen-once:** `localStorage snj.tour.done:<userId>` plus Supabase `user_metadata.tour_done_at` (set via `supabase.auth.updateUser` on close), so it shows once per account, not once per device. Existing users, including the owner's account, will see it once on their next visit.
- Also: WhatsApp number in "Your accounts"/Integrations now formatted (`formatPhone`), was raw digits. Walkthrough "when" lines rewritten as full sentences.
- **Files:** [app/tour/](frontend/src/app/tour/) (`Tour.tsx`, `steps.ts`, `placement.ts`, `HelpButton.tsx`, `context.ts`, `tour.test.ts`), `TopBar.tsx`, `AccountMenu.tsx`, `AppShell.tsx`, `features/howitworks/walkthrough.ts`, `features/integrations/overview.ts`.
- **Status:** `2242d35` + `286091b` live. `npm run check` green (89 tests). Verified on prod as e2e user (flag cleared first via admin API): auto-opens, all 12 steps in order, Done saves `tour_done_at` (PUT /auth/v1/user 200), stays closed after reload and on a fresh browser, Help reopens, Escape closes; light, dark, 390px; no page errors. The e2e user's flag is now set, so Playwright CI won't hit the tour.
- **Gotcha:** a local `vite preview` build uses a legacy Supabase anon key that is disabled, so `updateUser` 401s locally. Prod (Vercel env) is fine.

### 2026-10-15 — Help moved to a floating bottom-right button
- **What:** User drew an arrow from the top-bar Help to the bottom-right corner. Help is now a floating pill (`HelpLauncher`) at bottom-right on every signed-in page, desktop and phone. Clicking opens a Help panel above it: **Take the tour**, then **What each tab does** (each section expands to its purpose and a link + line per tab, from the Walkthrough guide), and a link to the Walkthrough page. Escape or clicking outside closes it. Removed Help from the top bar and phone header. The tour's last stop now points at the corner button with its card above (`place()` puts the card above anchors in the lower half; caret flips). Toasts moved to `bottom-20` and `Page` got `pb-24` so nothing hides behind the button.
- **Files:** [HelpLauncher.tsx](frontend/src/app/tour/HelpLauncher.tsx) (new; `HelpButton.tsx` deleted), `tour/placement.ts`, `tour/Tour.tsx`, `tour/steps.ts`, `tour/tour.test.ts`, `AppShell.tsx`, `TopBar.tsx`, `ui/Toast.tsx`, `ui/PageHeader.tsx`.
- **Status:** `d5520e7` live. `npm run check` green (90 tests). Verified on prod as e2e user at 1400px and 390px: tour auto-opens and runs all 12 stops, flag saves, panel opens/expands/starts the tour, Escape closes both, no page errors, no horizontal scroll.

### 2026-10-15 — Page frame shifted left to give the Help button room
- **What:** User asked for "Good evening and all" to move a little left so there's space by the floating Help button. Top bar, section tabs and `Page` now share one `.app-frame` class ([app.css](frontend/src/styles/app.css)) instead of `mx-auto max-w-7xl`. From 1024px up it sits up to 4rem left of center, so the wordmark and page content stay aligned. Page content also gets `.app-frame-page` (`max-width: min(80rem, 100% - 7rem)`), so on 1024–1376px screens, where there's no spare margin, the content stops short of Help. The top bar keeps its full width so its links don't wrap.
- **Measured on prod (e2e user, Home):** at 1470px the content moved 64px left with a 79px gap to Help. At 1280px and 1024px the gap is 32px; before the change Help covered about 80px of the right column. On phones Help still floats over content; `pb-24` lets you scroll past it. Roles, Dashboard and People → Messages checked at 1280px: no horizontal scroll, no errors.
- **Status:** `e707547` + `428a291` live. `npm run check` green (90 tests).

### 2026-10-15 — Frame shift halved (user: "too left, keep it a little right")
- **What:** `--frame-shift` is now 2rem instead of 4rem ([app.css](frontend/src/styles/app.css)). `.app-frame-page` max-width now subtracts the actual left margin too, so the content never runs into Help at in-between widths. The user wants it kept this way.
- **Measured on prod (Home):** at 1470px the content starts 95px from the left (it was 127px before any shift, 63px at 4rem) with a 47px gap to Help. At 1400, 1280 and 1024px the gap is 32px. No horizontal scroll.
- **Status:** `978bce8` live. `npm run check` green (90 tests).

### 2026-10-15 — Help is a round ? button; frame shift 1rem
- **What:** User asked for the page to go "even more right" and for a question-mark button instead of the "Help" pill. The launcher is now a 44px accent circle with "?" (it shows × while the panel is open), `aria-label="Help"`. `--frame-shift` went from 2rem to 1rem. `.app-frame-page` now reserves 4.5rem for the smaller button instead of 7rem. The tour's last step text mentions the ? button.
- **Measured on prod (Home):** at 1470px the content starts 111px from the left (it was 127px before any shift) with a 75px gap to the ? button. At 1400px the gap is 40px; at 1280px and 1024px it is 36px. The tour and Help panel test passed again: 12 steps, flag saved, panel, Escape, no page errors.
- **Status:** `c9610a8` live. `npm run check` green (91 tests).

- **2026-10-15 — Jobs → Roles: Posted column.** Each role shows its opening date ("Oct 15") and age ("today", "3d ago"). Sources that give no posting date (Remote Rocketship, InternshipDaily, some LinkedIn rows) show the day we first saw the role, labelled "first seen", from `scraped_at`, which upserts never overwrite. The column only appears from xl (1280px); below that the date sits under the source as "Posted Oct 15" / "First seen Oct 15", and on phones it goes in the meta line. With seven columns at 1024px the role title shrank to one letter. Helpers `postedDate` and `postedWords` in `features/jobs/catalog.ts` replace `postedLabel`. Commits 536cd01 and c9e95ad; verified live at 1440, 1024 and 390px with no horizontal scroll and no page errors.

### 2026-10-15 — Pages centered again (user: "all the screens are too much on left")
- **What:** Removed the left shift and the right-side reserve. `.app-frame` ([app.css](frontend/src/styles/app.css)) is now centered with an 80rem max width, the same as the original `mx-auto max-w-7xl`, but in one shared place for the top bar, section tabs and `Page`. `.app-frame-page` and `--frame-shift` are gone. **Don't shift the frame off center again.** The user tried left offsets of 4rem, 2rem and 1rem and settled on centered.
- **Measured on prod:** left and right margins are equal on Home and Roles: 127px each at 1470px, 32px at 1280px, 352px at 1920px. The ? button has 59px clear at 1470px. At 1280px and below it overlaps the last 36px of the right column in the bottom corner only, and pages have `pb-24` so content scrolls clear of it.
- **Status:** `4fdbd7f` live. `npm run check` green (91 tests).

### 2026-10-15 — "Still not updated": stale tabs after deploys → update notice
- **What:** User reported the centered layout "still not updated". The live site was already serving it (`.app-frame` centered in the served CSS; Vercel deploy `success`). Their open tab was running the bundle it loaded before the deploy, since the SPA never reloads by itself. Fix: [NewVersion.tsx](frontend/src/app/NewVersion.tsx) + [version.ts](frontend/src/app/version.ts). Every 5 minutes, and whenever the tab gets focus, the app fetches `/` with no-store and compares the `/assets/index-*.js` entry with the one it's running. If they differ, a slim "Scout’n’Jobs has been updated. Reload" bar shows above the top bar, and the next page change does a full reload, so the user lands on the page they clicked, on the new version. Does nothing on the dev server.
- **Status:** `47fe923` live. `npm run check` green (93 tests). Verified on prod by faking a newer index.html for the background fetch: no bar on the same version; the bar appears on focus; clicking Jobs did a full reload to /jobs/roles/intern and the bar cleared; no page errors.
- **Note:** another session had uncommitted backend edits in the tree (`backend/services/gmail.js`, `outbox.js`, `supabase/migrations/029_email_drafts.sql`). Left untouched; only frontend files were committed.

### 2026-10-15 — "Still not center": centered narrow pages and the Home greeting
- **What:** After the frame was centered, the user still saw Home as off-center. Margins were already equal; the cause was the layout. Home's greeting block was left-aligned with empty space to its right. Narrow pages (`<Page>` without `wide`: Usage, Integrations and its tabs, Profile, Settings, Evaluate, Messages, Outbox, Templates, Company) capped at `max-w-5xl` but sat against the left of the 80rem frame. Fix: `Page` centers the narrow column (`mx-auto max-w-5xl`), and the Home greeting, summary and buttons are centered (`mx-auto max-w-3xl text-center`, buttons `justify-center`). Page titles inside narrow pages stay left-aligned within their centered column.
- **Measured on prod at 1470px:** Home's greeting and buttons are 0px off center; Usage, Integrations and Profile → Details have 223px margins on both sides. At 390px Home is centered with 16px margins. No horizontal scroll, no page errors.
- **Status:** `3d4b6f0` live. `npm run check` green (94 tests).
