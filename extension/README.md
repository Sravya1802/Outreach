# Scout'n'Jobs filler (Chrome extension)

Fills an approved role's application in the user's own browser. The user does the CAPTCHA and presses Submit; the extension never does either. LinkedIn is never touched.

- `bridge.js` runs on scoutnjobs.vercel.app only. It marks the page (`data-snj-filler` = version) and passes the page's requests to the background: Open (a signed one-role link), pair (the user's 120-day key, sent on every signed-in visit by `FillerPairing`) and Open all now.
- `background.js`:
  - Open: checks the link against `/api/fill/:token` and opens the form in a new tab, registered before it navigates.
  - Mornings: on Chrome start (and whenever it wakes from 7 AM on, every 30 minutes) it opens every ready role from `/api/fill/daily` in one window, once a day. "Turn off mornings" and "Open all now" are on the Ready page.
  - A ready role's page opened by hand: `/api/fill/match` recognises it.
  - It injects `filler.js` into every page and frame of a tab being filled (company sites that embed a Greenhouse form), and sends reports and "submitted" back to the API.
- `filler.js` also runs by itself on jobs.ashbyhq.com, job-boards/boards.greenhouse.io, grnh.se, jobs.lever.co and *.myworkdayjobs.com, including frames. It does nothing unless the page is a ready role. It waits for the form to render, attaches the resume first (DataTransfer), then fills from the profile, the role's prepared answers (read every night and written by the Claude run) and the saved answers. It sets values with the native setter plus input/change/blur, answers Yes/No buttons (Ashby), outlines in red what it couldn't answer, shows "Filled X fields, Y need you", and marks the role applied when the confirmation page shows.
- `localStorage.snjDebug = '1'` on a job site logs each step.

The download in the app is `frontend/public/scoutnjobs-filler.zip`. Rebuild it after any change here: zip this folder's `*.js` and `manifest.json` under a `scoutnjobs-filler/` directory.

Tested 2026-11-19 with the extension loaded in Chromium, filling only and never submitting:
- Ashby (Netic): name, email, LinkedIn, phone, resume, start date, years, both Yes/No, the open question.
- Greenhouse (Verkada): 26 fields including resume, school, degree, GPA and self-identification.
- Morning open, a page opened by hand, and the confirmation page marking the role applied (test account).
- Yext's posting is closed (grnh.se → ?error=true), so there was no Yext form to test.
