// The new frontend (React + TypeScript). In development (`npm run dev`) the API and the runtime config come
// from the local server (`python dev.py serve`, port 8765): the same Python backend, nothing changes there.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// changeOrigin false: the local server writes the API's address from the Host it gets, so the browser keeps
// calling this same origin (/api, proxied) and there is no CORS to deal with.
const local = { target: "http://127.0.0.1:8765", changeOrigin: false };
const proxy = { "/api": local, "/js/config.js": local, "/local-photos": local };

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  build: { outDir: "dist", emptyOutDir: true },
});
