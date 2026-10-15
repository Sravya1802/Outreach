# Scout’n’Jobs 🚀

**AI-powered internship job search automation** — Evaluate companies, track applications, and auto-apply with intelligent resume tailoring.

## ✨ Features

### 💼 Job Search & Evaluation
- **Multi-source scraping** — LinkedIn, Wellfound, GitHub, Google Jobs, YC
- **AI evaluation** — A-F grading with detailed analysis (Claude, Gemini, GPT-4o)
- **Smart categorization** — 23 industry categories auto-applied
- **Contact enrichment** — Apollo.io + Hunter.io email finding

### 📋 Application Pipeline
- **Kanban board** — Visualize progress (evaluated → applied → offered)
- **Auto-apply** — Playwright form-filling for Greenhouse, Lever, Ashby
- **Resume tailoring** — AI keyword injection + PDF generation
- **Status tracking** — Full audit trail

### 🤖 Auto-Apply System
- Detects platform (Greenhouse/Lever/Ashby)
- Auto-fills form fields from profile
- Handles captcha/login walls (pauses for manual completion)
- Tracks submission status with timestamps
- Supports resume tailoring for each job

---

## 🏗️ Architecture

Production runs across three free-tier services:

```
┌──────────────────────────┐   HTTPS    ┌───────────────────────────┐
│ Vercel (frontend)        │ ─────────▶ │ Oracle Cloud Always Free  │
│ outreach-jt.vercel.app   │            │ VM, Ubuntu 22.04 ARM      │
│ React 19 + Vite SPA      │            │ Express + pm2 + nginx     │
└──────────────────────────┘            │ Playwright + Let's Encrypt│
                                         └─────────────┬─────────────┘
                                                       │ pg pool
                                                       ▼
                                         ┌───────────────────────────┐
                                         │ Supabase Free             │
                                         │ Postgres 17 + Storage     │
                                         │ + Auth (shared workspace) │
                                         └───────────────────────────┘
```

- **Frontend**: React 19 + Vite + Tailwind. Hosted on Vercel (static). Uses `VITE_API_URL` to point at the backend.
- **Backend**: Express.js + node-postgres. Hosted on an Oracle Cloud Always Free ARM VM (`outreach-jt.duckdns.org`). Playwright for auto-apply. Puppeteer for PDF generation.
- **Database**: Supabase Postgres (reached via the IPv4 session pooler — Oracle Free VMs don't have IPv6).
- **Auth**: Supabase Auth (frontend `supabase.auth`); backend is currently unauthenticated at the HTTP layer — if you're hardening this for multi-user, see the "Known gaps" section below.

**Cost**: $0/month, permanent. See [PLAN.txt](PLAN.txt) for the full migration record.

---

## 🚀 Local Development

```bash
# Clone + install both workspaces
git clone https://github.com/Sravya1802/outreach-os.git
cd outreach-os
npm run install:all

# Configure env — root .env is used by the backend
cp .env.example .env  # if you have an example; otherwise author it from scratch
# Required: OPENAI_API_KEY (or GEMINI_API_KEY) + DATABASE_URL (Supabase session pooler URI)

# Run backend + frontend concurrently
npm run dev
# → backend on :3001 (reads DATABASE_URL)
# → frontend on :5173 (proxies /api to backend when VITE_API_URL is unset)

# Or run individually
npm run dev:api       # backend only
npm run dev:frontend  # frontend only
```

### Required env vars

**Backend** (`/.env` or `backend/.env`):
```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
AI_PROVIDER=openai
OPENAI_API_KEY=...
# Optional
FRONTEND_ORIGIN=https://outreach-jt.vercel.app
CORS_ORIGINS=https://preview-a.vercel.app,https://preview-b.vercel.app  # comma-separated
APIFY_API_TOKEN=... SERPER_API_KEY=... APOLLO_API_KEY=... HUNTER_API_KEY=...
LINKEDIN_SESSION_COOKIE=... PROSPEO_API_KEY=...
```

**Frontend** (Vercel project settings → Environment Variables, OR `frontend/.env.local`):
```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_API_URL=https://outreach-jt.duckdns.org  # production only — leave unset for local dev
```

---

## 🧪 Tests

```bash
npm test                  # node --test against tests/*.test.mjs
npm run typecheck         # node --check sweep + ESLint
npm run verify-baseline   # probe prod for the audit-fix endpoints
npm run verify-migrations # schema invariants (DATABASE_URL optional)
```

End-to-end (Playwright):
```bash
npm run test:e2e:install  # one-time: download chromium (~150 MB)
npm run test:e2e          # runs against PLAYWRIGHT_BASE_URL (default: prod Vercel)
PLAYWRIGHT_BASE_URL=http://localhost:5173 npm run test:e2e   # local dev
```

The authenticated specs need an `E2E_REFRESH_TOKEN` env var. To create the test account once:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
node scripts/create-e2e-user.mjs
# → prints E2E_REFRESH_TOKEN. Add to your local .env and as a GitHub Actions secret.
```

CI runs the suite nightly (09:00 UTC) via `.github/workflows/e2e.yml`. Manual runs allowed via the GitHub Actions "Run workflow" button.

Frontend build / lint:
```bash
npm run build --prefix frontend
npm run lint --prefix frontend
```

---

## 📚 Docs

| File | Scope |
|---|---|
| **[PLAN.txt](PLAN.txt)** | Canonical migration plan (Vercel → Oracle + Supabase). Read this first for "how did we get here". |
| [PLAN-B.txt](PLAN-B.txt) | Fallback deployment plan (Google Cloud Run), unused. |
| [ORACLE-SETUP.txt](ORACLE-SETUP.txt) | Step-by-step Oracle Cloud account + VM bootstrap (Phase 1). |
| [PHASE-2-CHEATSHEET.txt](PHASE-2-CHEATSHEET.txt) | `oracle-setup.sh` installer walkthrough (Phase 2). |
| [PHASE-7-TEST-PLAN.txt](PHASE-7-TEST-PLAN.txt) | 40-feature manual end-to-end test checklist. |
| [SUPABASE_SETUP.md](SUPABASE_SETUP.md) | Supabase project creation + schema apply. |
| `supabase/migrations/*.sql` | Schema of record. Apply via the Supabase SQL editor. |
| [IMPROVEMENTS.md](IMPROVEMENTS.md) | Historical refactor notes (pre-Phase-4). |
| [BUG_REPORT.md](BUG_REPORT.md), [DEPLOYMENT.md](DEPLOYMENT.md), [FINAL_SUMMARY.md](FINAL_SUMMARY.md), [GITHUB_PUSH.md](GITHUB_PUSH.md), [QUICKSTART.md](QUICKSTART.md) | Historical — written before the Oracle migration. They describe a Vercel-serverless + SQLite + Railway architecture that **no longer applies**. Each has a deprecation banner. Preserved for context only. |

---

## 🗺️ Geographic scope

**Scout’n’Jobs is intentionally US-focused.** It targets US-based internships and assumes US work authorization, so:

- Scrapers pass `countryCode=US` / `location=United States` to LinkedIn, Wellfound, etc.
- The Greenhouse / Lever / Ashby portal scanner drops non-US roles.
- YC import filters Work-at-a-Startup to US.
- Auto-Apply profiles default `country = 'US'` and offer US-style work-authorization options.

This is a product decision, not a TODO. If you fork the project for a different region, removing the US filters is mechanical (search the codebase for `'US'` / `'United States'`) but you'll also need to add structured `country` columns on `roles` and `jobs`, expand the work-authorization vocabulary, and adjust Auto-Apply form fillers per locale.

---

## ⚠️ Known gaps

- **Backend is unauthenticated at the HTTP layer.** `/api/*` routes are open to anyone who can reach `outreach-jt.duckdns.org`. Supabase auth protects the frontend UI, but direct `curl` against the backend can mutate data, trigger scraping, and call auto-apply. If you're deploying for anyone outside a small trusted group, add JWT verification middleware (`supabase.auth.getUser(token)` server-side) before shipping.
- **Multi-user isolation.** The 002 schema declares RLS policies for `authenticated` role, but the backend uses the Supabase service-role key, which bypasses RLS. The app is designed as a 4-user shared workspace — every user sees every other user's data. Per-user scoping would require adding `user_id` columns and scoping every query.
- **PII in git history.** Earlier commits tracked tailored-resume PDFs under `backend/output/`. Current commits untrack them, but history still contains them. The GitHub repo is currently public — if you don't want those PDFs indexable, either run `git filter-repo` to purge, or mark the repo private.

---

## 📄 License

MIT © 2026 — Free to use and modify
