import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { APIRoute } from "astro";
import satori from "satori";
import { socialPreviewFilename, socialPreviewSize } from "../../utils/social-preview";

const pages: Record<string, { title: string; description: string }> = {
  index: {
    title: "Make the\ndocument ready.",
    description: "PDFs and images. All on your device.",
  },
  app: {
    title: "Your PDF\nworkspace.",
    description: "Open, arrange, and export in your browser.",
  },
  features: {
    title: "Features",
    description: "Merge, shape, export, and compress.",
  },
  about: {
    title: "About",
    description: "Work with PDFs. Keep the file with you.",
  },
  privacy: {
    title: "Privacy",
    description: "Your files stay with you. Nothing is uploaded.",
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

const fontData = readFileSync(join(process.cwd(), "src/fonts/WorkSans-SemiBold.ttf"));
const bodyFontData = readFileSync(
  join(process.cwd(), "node_modules/@fontsource/work-sans/files/work-sans-latin-400-normal.woff")
);
const titleFontData = readFileSync(
  join(process.cwd(), "node_modules/@fontsource/work-sans/files/work-sans-latin-500-normal.woff")
);

export function getStaticPaths() {
  return Object.keys(pages).flatMap((page) => [
    {
      params: { page: socialPreviewFilename(page).replace(/\.png$/, "") },
      props: { page },
    },
    // Cached page metadata may still reference the original image URL.
    { params: { page }, props: { page } },
  ]);
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
        backgroundColor: "#f7f5f0",
        color: "#242421",
        fontFamily: "WorkSans",
        fontWeight: 400,
      },
      children: {
        type: "div",
        props: {
          // Keep every element inside the centered square used by compact cards.
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: 510,
            textAlign: "center",
          },
          children: [
            {
              type: "div",
              props: {
                style: {
                  fontSize: 108,
                  fontWeight: 600,
                  lineHeight: 1,
                  letterSpacing: "-0.055em",
                },
                children: "interleaf",
              },
            },
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  marginTop: 32,
                  color: "#ff2a1f",
                  fontSize: 56,
                  fontWeight: 500,
                  lineHeight: 1.05,
                  letterSpacing: "-0.065em",
                },
                children: title.split("\n").map((line, index, lines) => ({
                  type: "span",
                  props: {
                    style: { color: lines.length > 1 && index === 0 ? "#242421" : "#ff2a1f" },
                    children: line,
                  },
                })),
              },
            },
            {
              type: "div",
              props: {
                style: {
                  marginTop: 28,
                  maxWidth: 480,
                  color: "#77756e",
                  fontSize: 25,
                  lineHeight: 1.45,
                  letterSpacing: "-0.02em",
                },
                children: description,
              },
            },
          ],
        },
      },
    },
  };

  const svg = await satori(element, {
    ...socialPreviewSize,
    fonts: [
      {
        name: "WorkSans",
        data: bodyFontData,
        weight: 400,
        style: "normal",
      },
      {
        name: "WorkSans",
        data: titleFontData,
        weight: 500,
        style: "normal",
      },
      {
        name: "WorkSans",
        data: fontData,
        weight: 600,
        style: "normal",
      },
    ],
  });

  const pngBuffer = new Resvg(svg).render().asPng();

  return new Response(new Uint8Array(pngBuffer), {
    headers: { "Content-Type": "image/png" },
  });
};
