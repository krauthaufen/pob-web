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
  },
  assetsInclude: ["**/*.wasm"],
});
