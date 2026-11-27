// The signed-in dashboard as a Vite app. It builds into public/_spa/, which ships with the Worker's static assets,
// and worker.ts serves public/_spa/index.html for every dashboard path (lib/spa-paths.ts). The pages and
// components are the same files Next.js compiles: `next/link` and `next/navigation` resolve to small TanStack
// Router adapters in spa/shims/.
import path from "node:path"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

const dashboard = path.resolve(__dirname, "..")

export default defineConfig(({ mode }) => {
  // What `next build` inlines for the browser: the NEXT_PUBLIC_* variables, from the same places Next reads them —
  // dashboard/.env* files (infra/deploy/deploy.sh writes .env.production.local) with the process environment
  // winning. Without the files, a deploy.sh build shipped no Supabase URL.
  const publicEnv = {
    ...loadEnv(mode, dashboard, "NEXT_PUBLIC_"),
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("NEXT_PUBLIC_"))),
  }
  return {
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
  }
})
