import { marked } from "marked";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

marked.setOptions({
  async: false,
  breaks: true,
  gfm: true
});

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function sanitizeUrlAttribute(attribute: "href" | "src", value: string) {
  try {
    const normalized = value.trim();

    if (!normalized) {
      return `${attribute}="#"`;
    }

    if (normalized.startsWith("#") || normalized.startsWith("/")) {
      return `${attribute}="${normalized}"`;
    }

    if (attribute === "src" && normalized.startsWith("data:image/")) {
      return `${attribute}="${normalized}"`;
    }

    const url = new URL(normalized, "https://interleaf.invalid");

    if (!SAFE_PROTOCOLS.has(url.protocol)) {
      return `${attribute}="#"`;
    }

    return `${attribute}="${normalized}"`;
  } catch {
    return `${attribute}="#"`;
  }
}

function sanitizeAttributes(html: string) {
  return html.replace(/(href|src)="([^"]*)"/gi, (_match, attribute: "href" | "src", value: string) => {
    return sanitizeUrlAttribute(attribute, value);
  });
}

function sanitizeLinks(html: string) {
  return html.replace(/href="([^"]*)"/gi, (_match, href: string) => {
    try {
      const normalized = href.trim();

      if (normalized.startsWith("#") || normalized.startsWith("/")) {
        return `href="${normalized}"`;
      }

      const url = new URL(normalized, "https://interleaf.invalid");

      if (!SAFE_PROTOCOLS.has(url.protocol)) {
        return 'href="#"';
      }

      return `href="${normalized}"`;
    } catch {
      return 'href="#"';
    }
  });
}

export function renderMarkdown(markdown: string) {
  const html = marked.parse(escapeHtml(markdown)) as string;

  return sanitizeAttributes(sanitizeLinks(html));
}
