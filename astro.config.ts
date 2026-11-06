import { readFileSync } from "node:fs";
import sitemap from "@astrojs/sitemap";
import solid from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Browser tests serve the production security headers from vercel.json, the single source of truth.
const vercelHeaders = () =>
  Object.fromEntries(
    (
      JSON.parse(readFileSync("vercel.json", "utf8")) as {
        headers: { source: string; headers: { key: string; value: string }[] }[];
      }
    ).headers
      .find((rule) => rule.source === "/(.*)")
      ?.headers.map(({ key, value }) => [key, value]) ?? []
  );

// https://astro.build/config
export default defineConfig({
  integrations: [solid(), sitemap()],
  site: "https://www.interleaf.cc",
  // Prefetch same-origin links once they are visible, so taps and quick clicks also land on a cached page.
  // Astro skips this under Save-Data and on 2G connections.
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  server: process.env.INTERLEAF_VERCEL_HEADERS ? { headers: vercelHeaders() } : {},
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": "/src",
      },
    },
    optimizeDeps: { exclude: ["@resvg/resvg-js"] },
    ssr: { external: ["@resvg/resvg-js"] },
  },
});
