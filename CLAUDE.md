# Sunotes

Static website (no build step): `index.html`, `css/`, `js/`. Run with `python -m http.server 8765` (see `.claude/launch.json`).

Live on GitHub Pages (public repo `rohityadav6014/pdf-voice-reader`, branch `main`, root): https://rohityadav6014.github.io/pdf-voice-reader/ — every push to `main` redeploys it.

Also live on Vercel (free Hobby plan, project `sunotes`, team `profit222`): https://sunotes-sigma.vercel.app — it is NOT connected to GitHub, so after pushing, redeploy with `vercel deploy --prod --yes` from the project folder (Vercel CLI is installed globally via npm; Node.js is at the default install path, refresh PATH as below if needed). `.vercelignore` keeps `music/`, `.env*`, `.claude/` and `CLAUDE.md` out of the upload.

Analytics: `js/analytics.js` sends every action to GA4 and to `/api/track` (Vercel function, `api/track.js`); `js/track-actions.js` listens for user actions. Admin panel `/admin` (`admin.html`, `js/admin.js`, `css/admin.css`) reads `/api/stats` (`api/stats.js`), protected by the `ADMIN_EMAIL` + `ADMIN_PASSWORD` env vars (both secret, set in Vercel; never commit them). Storage is Upstash Redis via `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`). Never put real secrets in the repo; the owner sets them in Vercel. The API only runs on Vercel, not GitHub Pages.

When you change any file in `css/` or `js/`, bump the `?v=N` number on every local `<link>`/`<script>` in `index.html` so browsers (and GitHub Pages' 10-minute cache) load the new files.

## Git workflow

- Every change must be committed and pushed to GitHub (`origin`, branch `main`) when the work is done — the user asked for all future changes to be uploaded.
- Git and GitHub CLI are installed at `C:\Program Files\Git\cmd\git.exe` and `C:\Program Files\GitHub CLI\gh.exe`. If they aren't on PATH in a shell, refresh it first:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- `*.pdf` is marked binary in `.gitattributes`; keep it that way.
