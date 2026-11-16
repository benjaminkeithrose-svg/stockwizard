import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative paths, so the built app works from any folder (e.g. GitHub Pages' /stockwizard/).
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { environment: "node" },
});
