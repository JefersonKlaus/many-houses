# web/: the new frontend (React + TypeScript), being migrated from frontend/

The backend does not change: same API, same Python code. Until every screen is moved over, the app in use
is still `frontend/` (deploy and `python dev.py serve` keep serving it).

- `npm install` once, then with the local API running (`python dev.py serve`, port 8765):
  - `npm run dev`: the new app with hot reload (it proxies `/api` and `/js/config.js` to the local server)
  - `npm run build`: type-check + production build in `web/dist/`
- `/js/config.js` is not bundled: it is loaded at runtime, generated at deploy time or by the local server,
  so one build works locally and in AWS.

Migration steps: 1. shell (login, menu, notices count) - done; 2. API types; 3. screens (Avisos, Perfil,
Predefinições, Casas, the house page); 4. switch deploy/e2e to `web/dist/` and remove `frontend/`.

## Brand

- Mark: a house whose inside is a rising bar chart (bought, renovated, valued) - `src/Logo.tsx`, `public/favicon.svg`.
- Colors (tokens on `:root` in `src/style.css`, redefined for the dark theme): Petróleo `#0f4c5c` (brand),
  Ouro `#f2b544` (accent: growth, the notices count, the current page), warm neutrals `#f5f7f8` / `#16262c`.
- Type: the system UI font (Segoe UI / -apple-system / Roboto): the CSP allows no external fonts.
