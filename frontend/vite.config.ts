import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-dom") || id.includes("/react/")) return "react-vendor";
          if (id.includes("@tanstack")) return "query";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("react-markdown") || id.includes("remark")) return "markdown";
          if (id.includes("highlight.js")) return "highlight";
          if (id.includes("jszip")) return "jszip";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/healthz": {
        target: process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/readyz": {
        target: process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
});
