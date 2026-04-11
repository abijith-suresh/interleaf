import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

export default defineConfig({
  plugins: [
    solidPlugin(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [],
      manifest: false,
      devOptions: {
        enabled: false
      }
    })
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    "import.meta.env.APP_VERSION": JSON.stringify(pkg.version)
  },
  resolve: {
    alias: {
      "@": "/src"
    }
  },
  server: {
    port: 3000
  },
  build: {
    target: "esnext"
  }
});
