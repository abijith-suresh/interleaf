import sitemap from "@astrojs/sitemap";
import solid from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  integrations: [solid(), sitemap({ filter: (page) => !page.includes("/mock/") })],
  site: "https://interleaf-snowy.vercel.app",
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
