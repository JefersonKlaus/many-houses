# web/: the site (React + TypeScript)

The backend is the Python API (backend/); this is only the browser side, built with Vite into `web/dist/`,
which the deploy publishes to S3 and `local/server.py` serves.

- `npm install` once (or `python dev.py setup`), then with the local API running (`python dev.py serve`, port 8765):
  - `npm run dev`: the site with hot reload (it proxies `/api` and `/js/config.js` to the local server)
  - `npm run build`: type-check + production build in `web/dist/`
- `/js/config.js` is not bundled: it is loaded at runtime, generated at deploy time or by the local server,
  so one build works locally and in AWS.
- The CSP allows no inline scripts or styles: React's `style={...}` is fine (set through the CSSOM).

## Brand

- Mark: a house whose inside is a rising bar chart (bought, renovated, valued) - `src/Logo.tsx`, `public/favicon.svg`.
- Colors (tokens on `:root` in `src/style.css`, redefined for the dark theme): Petróleo `#0f4c5c` (brand),
  Ouro `#f2b544` (accent: growth, the notices count, the current page), warm neutrals `#f5f7f8` / `#16262c`.
- Type: the system UI font (Segoe UI / -apple-system / Roboto): the CSP allows no external fonts.
