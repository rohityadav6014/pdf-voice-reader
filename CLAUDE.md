# PDF Voice Reader

Static website (no build step): `index.html`, `css/`, `js/`. Run with `python -m http.server 8765` (see `.claude/launch.json`).

Live on GitHub Pages (public repo `rohityadav6014/pdf-voice-reader`, branch `main`, root): https://rohityadav6014.github.io/pdf-voice-reader/ — every push to `main` redeploys it.

When you change any file in `css/` or `js/`, bump the `?v=N` number on every local `<link>`/`<script>` in `index.html` so browsers (and GitHub Pages' 10-minute cache) load the new files.

## Git workflow

- Every change must be committed and pushed to GitHub (`origin`, branch `main`) when the work is done — the user asked for all future changes to be uploaded.
- Git and GitHub CLI are installed at `C:\Program Files\Git\cmd\git.exe` and `C:\Program Files\GitHub CLI\gh.exe`. If they aren't on PATH in a shell, refresh it first:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- `*.pdf` is marked binary in `.gitattributes`; keep it that way.
