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
    allowedHosts: ["pob.haaser.me"],
    proxy: {
      "/poe-ninja-api": {
        target: "https://poe.ninja",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/poe-ninja-api/, ""),
      },
    },
  },
  assetsInclude: ["**/*.wasm"],
});
