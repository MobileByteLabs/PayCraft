// The signed-in dashboard as a Vite app. It builds into public/_spa/, which Next.js ships as static files, and the
// middleware serves public/_spa/index.html for every dashboard path (lib/spa-paths.ts). The pages and components
// are the same files Next.js compiles: `next/link` and `next/navigation` resolve to small TanStack Router
// adapters in spa/shims/.
import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const dashboard = path.resolve(__dirname, "..")

// What `next build` inlines for the browser: the NEXT_PUBLIC_* variables (plus NODE_ENV).
const publicEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.startsWith("NEXT_PUBLIC_")),
)

export default defineConfig(({ mode }) => ({
  root: __dirname,
  base: "/_spa/",
  plugins: [react()],
  resolve: {
    alias: [
      { find: "next/link", replacement: path.join(__dirname, "shims/link.tsx") },
      { find: "next/navigation", replacement: path.join(__dirname, "shims/navigation.ts") },
      { find: /^@\//, replacement: `${dashboard}/` },
    ],
  },
  define: {
    "process.env": JSON.stringify({ ...publicEnv, NODE_ENV: mode === "production" ? "production" : "development" }),
  },
  css: { postcss: dashboard },
  build: {
    outDir: path.join(dashboard, "public/_spa"),
    emptyOutDir: true,
  },
}))
