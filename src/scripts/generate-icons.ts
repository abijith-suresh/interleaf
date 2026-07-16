import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const svgContent = readFileSync(join(process.cwd(), "public/favicon.svg"), "utf-8");

const appleTouchIconSize = 180;
const faviconSize = 32;

const appleTouchIconResvg = new Resvg(svgContent, {
  fitTo: {
    mode: "width",
    value: appleTouchIconSize,
  },
});
const appleTouchIconPng = appleTouchIconResvg.render().asPng();
writeFileSync(
  join(process.cwd(), "public/apple-touch-icon.png"),
  new Uint8Array(appleTouchIconPng)
);

const faviconResvg = new Resvg(svgContent, {
  fitTo: {
    mode: "width",
    value: faviconSize,
  },
});
const faviconPng = faviconResvg.render().asPng();
writeFileSync(join(process.cwd(), "public/favicon.ico"), new Uint8Array(faviconPng));
