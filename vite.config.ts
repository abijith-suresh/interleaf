import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA, type ManifestOptions } from "vite-plugin-pwa";
import pkg from "./package.json";

const appManifest: Partial<ManifestOptions> = {
  name: "interleaf",
  short_name: "interleaf",
  description:
    "A local-first notes app for fast writing, search, tabbed notes, and export.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: "#F7F4F0",
  theme_color: "#F7F4F0",
  icons: [
    {
      src: "/pwa-icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
    {
      src: "/pwa-icon-maskable.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "maskable",
    },
  ],
};

export default defineConfig({
  plugins: [
    solidPlugin(),
    tailwindcss(),
    VitePWA({
      strategies: "generateSW",
      registerType: "autoUpdate",
      includeAssets: ["pwa-icon.svg", "pwa-icon-maskable.svg"],
      manifest: appManifest,
      devOptions: {
        enabled: false,
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    port: 3000,
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        about: fileURLToPath(new URL("./about/index.html", import.meta.url)),
        features: fileURLToPath(
          new URL("./features/index.html", import.meta.url),
        ),
        privacy: fileURLToPath(
          new URL("./privacy/index.html", import.meta.url),
        ),
        changelog: fileURLToPath(
          new URL("./changelog/index.html", import.meta.url),
        ),
        "keyboard-shortcuts": fileURLToPath(
          new URL("./keyboard-shortcuts/index.html", import.meta.url),
        ),
      },
    },
  },
});
