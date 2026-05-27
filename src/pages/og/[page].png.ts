import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { APIRoute } from "astro";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const pages: Record<string, { title: string; description: string }> = {
  index: {
    title: "Interleaf",
    description: "Edit, merge, split — all in your browser.",
  },
  app: {
    title: "Editor",
    description: "Open your PDF and start editing. No uploads required.",
  },
  features: {
    title: "Features",
    description: "Merge, split, reorder, rotate, and delete.",
  },
  about: {
    title: "About",
    description: "Client-side PDF tools. No servers. No data collection.",
  },
  privacy: {
    title: "Privacy",
    description: "Your files never leave your browser. Zero data collection.",
  },
  terms: {
    title: "Terms",
    description: "Simple, honest terms for a tool you can trust.",
  },
  changelog: {
    title: "Changelog",
    description: "A complete history of every Interleaf release.",
  },
  faq: {
    title: "FAQ",
    description: "Everything you need to know about Interleaf.",
  },
};

const fontData = readFileSync(join(process.cwd(), "src/fonts/WorkSans-SemiBold.ttf"));

export function getStaticPaths() {
  return Object.keys(pages).map((page) => ({ params: { page } }));
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.page as string;
  const { title, description } = pages[slug];

  const element = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "1200px",
        height: "630px",
        backgroundColor: "#ffffff",
        padding: "60px",
        fontFamily: "WorkSans",
      },
      children: [
        // Top row: brand + subtitle
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "16px",
              marginBottom: "60px",
            },
            children: [
              {
                type: "span",
                props: {
                  style: {
                    fontSize: "28px",
                    fontWeight: 600,
                    color: "#111",
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                  },
                  children: "INTERLEAF",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    width: "4px",
                    height: "28px",
                    backgroundColor: "#ff0000",
                  },
                  children: "",
                },
              },
              {
                type: "span",
                props: {
                  style: {
                    fontSize: "18px",
                    color: "#888",
                    letterSpacing: "0.05em",
                  },
                  children: "Client-side PDF Editor",
                },
              },
            ],
          },
        },
        // Main area: page title
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flex: 1,
              flexDirection: "column",
              justifyContent: "center",
              gap: "24px",
            },
            children: [
              {
                type: "span",
                props: {
                  style: {
                    fontSize: "104px",
                    fontWeight: 600,
                    color: "#111",
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                  },
                  children: title,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    width: "80px",
                    height: "4px",
                    backgroundColor: "#ff0000",
                  },
                  children: "",
                },
              },
              {
                type: "span",
                props: {
                  style: {
                    fontSize: "28px",
                    color: "#888",
                    lineHeight: 1.5,
                    maxWidth: "800px",
                  },
                  children: description,
                },
              },
            ],
          },
        },
        // Bottom: URL
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              marginTop: "40px",
            },
            children: [
              {
                type: "span",
                props: {
                  style: {
                    fontSize: "18px",
                    color: "#555",
                    letterSpacing: "0.05em",
                  },
                  children: "interleaf.page",
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(element, {
    width: 1200,
    height: 630,
    fonts: [
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
