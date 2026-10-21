import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { reticle } from '@reticlehq/vite-plugin';
// The frontend talks to the Express API through the same-origin `/api` prefix.
// In development Vite proxies `/api/*` to the backend and strips the prefix, so
// the browser never makes a cross-origin request and no backend CORS change is
// required. Point VITE_API_URL at a full URL only when the API is served
// elsewhere.
export default defineConfig({
  // `captureNetworkBodies` lets Reticle prove WRITE outcomes: a 2xx on a POST
  // describes the transport, not the result, so without the body a mutation
  // verdict can only be "unknown". Reticle redacts known credential fields.
  plugins: [reticle({ captureNetworkBodies: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
