import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@pob-web/lua-wasm"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["pob.haaser.me", "pob.awx.at"],
    hmr: false,
    proxy: {
      "/poe-oauth": {
        target: "https://pathofexile.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/poe-oauth/, "/oauth"),
      },
      "/poe-api": {
        target: "https://api.pathofexile.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/poe-api/, ""),
      },
      "/poe-ninja-api": {
        target: "https://poe.ninja",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/poe-ninja-api/, ""),
      },
      "/api": {
        target: "http://localhost:7777",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  assetsInclude: ["**/*.wasm"],
});
