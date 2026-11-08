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
// a variable font at its default instance only, so headings use static Inter.
const interFont = (weight: 400 | 500) =>
  readFileSync(
    join(process.cwd(), `node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff`)
  );
const bodyFontData = interFont(400);
const headingFontData = interFont(500);

// Cards tokens from the marketing theme in src/styles/global.css.
const colors = {
  canvas: "#f5f5f5",
  surface: "#ffffff",
  fg: "#0a0a0a",
  fgMuted: "#525252",
  line: "#e5e5e5",
  accent: "#17804f",
};

const svgImage = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// The app icon, from the favicon, and the leaf that dots the wordmark's first i.
const markSrc = svgImage(readFileSync(join(process.cwd(), "public/favicon.svg"), "utf-8"));
const leafSrc = svgImage(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 9A6.9 6.9 0 0 1 9 1A6.9 6.9 0 0 1 1 9z" fill="${colors.accent}"/></svg>`
);

const wordmarkSize = 34;
const markSize = 64;

const cardInset = 40;

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
        width: socialPreviewSize.width,
        height: socialPreviewSize.height,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.canvas,
        color: colors.fg,
        fontFamily: "Inter",
        fontWeight: 400,
      },
      children: {
        type: "div",
        props: {
          style: {
            display: "flex",
            width: socialPreviewSize.width - 2 * cardInset,
            height: socialPreviewSize.height - 2 * cardInset,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.surface,
            border: `1px solid ${colors.line}`,
            borderRadius: 12,
          },
          children: {
            type: "div",
            props: {
              // Keep every element inside the centered square used by compact cards.
              style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: 600,
                textAlign: "center",
              },
              children: [
                {
                  type: "img",
                  props: { src: markSrc, width: markSize, height: markSize },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      marginTop: 20,
                      fontSize: wordmarkSize,
                      fontWeight: 500,
                      lineHeight: 1,
                      letterSpacing: "-0.02em",
                    },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: { display: "flex", position: "relative" },
                          children: [
                            "ı",
                            {
                              type: "img",
                              props: {
                                src: leafSrc,
                                width: wordmarkSize * 0.3,
                                height: wordmarkSize * 0.3,
                                style: {
                                  position: "absolute",
                                  top: 0,
                                  left: "50%",
                                  transform: "translateX(-40%)",
                                },
                              },
                            },
                          ],
                        },
                      },
                      "nterleaf",
                    ],
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      marginTop: 40,
                      fontSize: 72,
                      fontWeight: 500,
                      lineHeight: 1.1,
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
                      maxWidth: 520,
                      color: colors.fgMuted,
                      fontSize: 26,
                      lineHeight: 1.4,
                      letterSpacing: "-0.01em",
                      textWrap: "balance",
                    },
                    children: description,
                  },
                },
              ],
            },
          },
        },
      },
    },
  };

  const svg = await satori(element, {
    ...socialPreviewSize,
    fonts: [
      { name: "Inter", data: bodyFontData, weight: 400, style: "normal" },
      { name: "Inter", data: headingFontData, weight: 500, style: "normal" },
    ],
  });

  const pngBuffer = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();

  return new Response(new Uint8Array(pngBuffer), {
    headers: { "Content-Type": "image/png" },
  });
};
