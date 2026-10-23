import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The UI ships as ONE self-contained HTML file: an MCP Apps host renders it from an MCP
// resource inside a sandboxed iframe, so there is nowhere to load chunks from.
export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
