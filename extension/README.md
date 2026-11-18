# Scout'n'Jobs filler (Chrome extension)

Fills an approved role's application in the user's own browser. The user does the CAPTCHA and presses Submit; the extension never does either. LinkedIn is never touched.

- `bridge.js` runs on scoutnjobs.vercel.app only. It marks the page (`data-snj-filler`) and passes the page's Open click to the background.
- `background.js` checks the signed one-role link against `/api/fill/:token` and opens the form in a new tab. It then injects `filler.js` into every page and frame that loads in that tab, and sends reports and "submitted" back to the API.
- `filler.js` works in this order: attach the resume first, then fill from the profile, then from the saved answers (via the API). It outlines in red and lists the required questions it couldn't answer, shows a small panel, and spots a confirmation page.

The download in the app is `frontend/public/scoutnjobs-filler.zip`. Rebuild it after any change here: zip this folder's `*.js` and `manifest.json` under a `scoutnjobs-filler/` directory.

Tested 2026-11-17 against live forms, filling only and never submitting:
- Greenhouse (Verkada): 26 fields.
- Ashby (Netic).
- Lever (Global Lending Services).
