import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const svgContent = readFileSync(join(process.cwd(), "public/favicon.svg"), "utf-8");

const appleTouchIconSize = 180;
const faviconSizes = [16, 32, 48];

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

const faviconPngs = faviconSizes.map((size) => {
  const faviconResvg = new Resvg(svgContent, {
    fitTo: {
      mode: "width",
      value: size,
    },
  });

  return new Uint8Array(faviconResvg.render().asPng());
});

const icoHeaderSize = 6;
const icoEntrySize = 16;
const icoDataOffset = icoHeaderSize + icoEntrySize * faviconPngs.length;
const icoSize = icoDataOffset + faviconPngs.reduce((total, png) => total + png.length, 0);
const ico = new Uint8Array(icoSize);
const icoView = new DataView(ico.buffer);

icoView.setUint16(0, 0, true);
icoView.setUint16(2, 1, true);
icoView.setUint16(4, faviconPngs.length, true);

let dataOffset = icoDataOffset;
faviconPngs.forEach((png, index) => {
  const size = faviconSizes[index];
  const entryOffset = icoHeaderSize + index * icoEntrySize;

  ico[entryOffset] = size === 256 ? 0 : size;
  ico[entryOffset + 1] = size === 256 ? 0 : size;
  ico[entryOffset + 2] = 0;
  ico[entryOffset + 3] = 0;
  icoView.setUint16(entryOffset + 4, 1, true);
  icoView.setUint16(entryOffset + 6, 32, true);
  icoView.setUint32(entryOffset + 8, png.length, true);
  icoView.setUint32(entryOffset + 12, dataOffset, true);
  ico.set(png, dataOffset);

  dataOffset += png.length;
});

writeFileSync(join(process.cwd(), "public/favicon.ico"), ico);
