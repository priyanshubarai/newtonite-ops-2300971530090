import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend talks to the Express API through the same-origin `/api` prefix.
// In development Vite proxies `/api/*` to the backend and strips the prefix, so
// the browser never makes a cross-origin request and no backend CORS change is
// required. Point VITE_API_URL at a full URL only when the API is served
// elsewhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
