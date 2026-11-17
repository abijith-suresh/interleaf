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
const interFont = (weight: 400 | 600 | 700) =>
  readFileSync(
    join(process.cwd(), `node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff`)
  );

// Cutting-mat tokens from src/styles/global.css.
const colors = {
  canvas: "#f5f3ee",
  surface: "#fcfbf8",
  fg: "#1b1e1b",
  fgMuted: "#50554e",
  line: "#e2ded3",
  mat: "#2b5a46",
  matMinor: "rgba(214, 236, 222, 0.09)",
  matMajor: "rgba(214, 236, 222, 0.2)",
};

const svgImage = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// The site's wordmark: the leaf-i, then "interleaf".
const markSrc = svgImage(readFileSync(join(process.cwd(), "public/mark.svg"), "utf-8"));

const inset = 72;
const matLeft = 780;
// A sheet lying on the mat, with the edge of a second sheet behind it.
const sheetShadow = "3px 3px 0 -1px #e3dfd3, 0 14px 22px -14px rgba(0, 18, 10, 0.7)";
const sheet = (left: number, top: number) => ({
  type: "div",
  props: {
    style: {
      position: "absolute",
      left,
      top,
      width: 200,
      height: 260,
      borderRadius: 3,
      backgroundColor: colors.surface,
      boxShadow: sheetShadow,
    },
  },
});

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
              position: "absolute",
              left: matLeft,
              top: inset,
              right: 0,
              bottom: 0,
              display: "flex",
              borderTopLeftRadius: 10,
              backgroundColor: colors.mat,
              backgroundImage: [
                `linear-gradient(to right, ${colors.matMajor} 1px, transparent 1px)`,
                `linear-gradient(to bottom, ${colors.matMajor} 1px, transparent 1px)`,
                `linear-gradient(to right, ${colors.matMinor} 1px, transparent 1px)`,
                `linear-gradient(to bottom, ${colors.matMinor} 1px, transparent 1px)`,
              ].join(", "),
              backgroundSize: "60px 60px, 60px 60px, 12px 12px, 12px 12px",
            },
            children: [sheet(60, 60), sheet(184, 120)],
          },
        },
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              left: inset,
              top: inset,
              bottom: inset,
              width: matLeft - inset * 2,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    fontSize: 34,
                    fontWeight: 600,
                    lineHeight: 1,
                    letterSpacing: "-0.035em",
                  },
                  children: [
                    {
                      type: "img",
                      props: { src: markSrc, width: 52, height: 52, style: { marginLeft: -15 } },
                    },
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
                          fontSize: 76,
                          fontWeight: 700,
                          lineHeight: 1,
                          letterSpacing: "-0.045em",
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
                          marginTop: 28,
                          color: colors.fgMuted,
                          fontSize: 28,
                          lineHeight: 1.35,
                          letterSpacing: "-0.015em",
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
      { name: "Inter", data: interFont(400), weight: 400, style: "normal" },
      { name: "Inter", data: interFont(600), weight: 600, style: "normal" },
      { name: "Inter", data: interFont(700), weight: 700, style: "normal" },
    ],
  });

  const pngBuffer = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();

  return new Response(new Uint8Array(pngBuffer), {
    headers: { "Content-Type": "image/png" },
  });
};
