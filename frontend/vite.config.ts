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
        /**
         * 禁止把 React / Radix / Query 拆成多 chunk。
         * 0.1.55 曾拆出 radix-*.js，运行时 React 为 undefined → forwardRef 崩溃。
         * 仅拆「按需动态 import」的重库。
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("jszip")) return "jszip";
          if (id.includes("highlight.js")) return "highlight";
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
