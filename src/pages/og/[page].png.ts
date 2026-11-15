import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { APIRoute } from "astro";
import satori from "satori";
import {
  legacySocialPreviewFilenames,
  socialPreviewFilename,
  socialPreviewSize,
} from "../../utils/social-preview";

const pages: Record<string, { title: string; description: string }> = {
  index: {
    title: "Make the\ndocument ready.",
    description: "PDFs and images. Your files never leave your device.",
  },
  app: {
    title: "Your PDF\nworkspace.",
    description: "Open, shape, and export in your browser.",
  },
  features: {
    title: "Features",
    description: "Everything before the export.",
  },
  privacy: {
    title: "Privacy",
    description: "Your files never leave your device. Nothing is uploaded.",
  },
  terms: {
    title: "Terms of service",
    description: "The terms for using Interleaf.",
  },
  faq: {
    title: "Questions,\nanswered.",
    description: "Short answers about using Interleaf.",
  },
};

// Satori draws text as paths, so resvg never needs these fonts. Satori renders
// a variable font at its default instance only, so the image uses static cuts.
const fontFile = (file: string) =>
  readFileSync(join(process.cwd(), "node_modules/@fontsource", file));
const bodyFontData = fontFile("inter/files/inter-latin-400-normal.woff");
const wordmarkFontData = fontFile("inter/files/inter-latin-500-normal.woff");
const displayFontData = fontFile("source-serif-4/files/source-serif-4-latin-600-normal.woff");

// Folio tokens from src/styles/global.css.
const colors = {
  canvas: "#f3f0e8",
  surface: "#fcfbf8",
  fg: "#191b17",
  fgMuted: "#55584f",
  line: "#e0dacd",
  lineStrong: "#cbc3b2",
};

const svgImage = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// The site's wordmark: the app icon from the favicon, then plain "interleaf".
const markSrc = svgImage(readFileSync(join(process.cwd(), "public/favicon.svg"), "utf-8"));

const wordmarkSize = 34;
const markSize = 40;
const inset = 48;
// The interleaved sheet: a second sheet's edge behind the card.
const sheetOffset = 8;
const sheet = {
  boxSizing: "border-box",
  width: socialPreviewSize.width - 2 * inset - sheetOffset,
  height: socialPreviewSize.height - 2 * inset - sheetOffset,
  borderRadius: 12,
} as const;

export function getStaticPaths() {
  return Object.keys(pages).flatMap((page) =>
    [socialPreviewFilename(page), ...legacySocialPreviewFilenames(page)].map((filename) => ({
      params: { page: filename.replace(/\.png$/, "") },
      props: { page },
    }))
  );
}

export const GET: APIRoute = async ({ props }) => {
  const { title, description } = pages[props.page];

  const element = {
    type: "div",
    props: {
      style: {
        display: "flex",
        position: "relative",
        width: socialPreviewSize.width,
        height: socialPreviewSize.height,
        backgroundColor: colors.canvas,
        color: colors.fg,
        fontFamily: "Inter",
        fontWeight: 400,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              ...sheet,
              position: "absolute",
              top: inset + sheetOffset,
              left: inset + sheetOffset,
              backgroundColor: colors.surface,
              border: `1px solid ${colors.lineStrong}`,
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              ...sheet,
              position: "absolute",
              top: inset,
              left: inset,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: 64,
              backgroundColor: colors.surface,
              border: `1px solid ${colors.line}`,
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontSize: wordmarkSize,
                    fontWeight: 500,
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                  },
                  children: [
                    { type: "img", props: { src: markSrc, width: markSize, height: markSize } },
                    "interleaf",
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column" },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          flexDirection: "column",
                          fontFamily: "Source Serif 4",
                          fontSize: 80,
                          fontWeight: 600,
                          lineHeight: 1.05,
                          letterSpacing: "-0.02em",
                        },
                        children: title.split("\n").map((line) => ({
                          type: "span",
                          props: { children: line },
                        })),
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          marginTop: 24,
                          maxWidth: 760,
                          color: colors.fgMuted,
                          fontSize: 30,
                          lineHeight: 1.35,
                          letterSpacing: "-0.01em",
                        },
                        children: description,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(element, {
    ...socialPreviewSize,
    fonts: [
      { name: "Inter", data: bodyFontData, weight: 400, style: "normal" },
      { name: "Inter", data: wordmarkFontData, weight: 500, style: "normal" },
      { name: "Source Serif 4", data: displayFontData, weight: 600, style: "normal" },
    ],
  });

  const pngBuffer = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();

  return new Response(new Uint8Array(pngBuffer), {
    headers: { "Content-Type": "image/png" },
  });
};
