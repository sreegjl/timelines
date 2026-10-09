import { Marked } from "marked";
import DOMPurify from "dompurify";
import { parseWikilink } from "./wikilinks";

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

// Set for the duration of one synchronous parse so the extension can mark unresolved links
let activeWikilinkResolver = null;

// [[Note]], [[Note#Heading|Alias]] and ![[image.png]]; a marked extension so code spans are left alone
const wikilinkExtension = {
  name: "wikilink",
  level: "inline",
  start(src) {
    const idx = src.search(/!?\[\[/);
    return idx === -1 ? undefined : idx;
  },
  tokenizer(src) {
    const match = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(src);
    if (!match) return undefined;
    return { type: "wikilink", raw: match[0], embed: match[1] === "!", inner: match[2] };
  },
  renderer(token) {
    const { target, heading, alias } = parseWikilink(token.inner);
    if (!target) return escapeHtml(token.raw);
    if (token.embed && IMAGE_EXT_RE.test(target)) {
      return `<img src="${escapeHtml(target)}" alt="${escapeHtml(alias || target)}">`;
    }
    const resolved = activeWikilinkResolver ? activeWikilinkResolver(target) : null;
    const text = alias || (heading ? `${target} > ${heading}` : target);
    const pathAttr = resolved ? ` data-note-path="${escapeHtml(resolved)}"` : "";
    return `<a class="wikilink${resolved ? "" : " is-unresolved"}" data-note-target="${escapeHtml(target)}"${pathAttr}>${escapeHtml(text)}</a>`;
  },
};

const markdown = new Marked({ extensions: [wikilinkExtension] });

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

// { rows: [[key, value]], body } for simple "key: value" frontmatter
export function splitFrontmatter(raw) {
  const text = String(raw || "");
  const match = text.match(FRONTMATTER_RE);
  if (!match) return { rows: [], body: text };
  const rows = match[1].split(/\r?\n/).map((line) => {
    const sep = line.indexOf(":");
    if (sep === -1) return null;
    const key = line.slice(0, sep).trim();
    return key ? [key, line.slice(sep + 1).trim()] : null;
  }).filter(Boolean);
  return { rows, body: text.slice(match[0].length) };
}

// resolveLocalSrc: optional (src) => url hook so environments without
// filesystem access (the web viewer reading a packaged .timeline) can serve
// stored asset refs, e.g. as blob URLs
export function sanitizeNoteHtml(html, baseUrl = "", basePath = "", assetsBasePath = "", assetsTimelineDir = "", resolveLocalSrc = null) {
  const normalizeFsPath = (inputPath) => {
    if (!inputPath) return "";
    let value = decodeURIComponent(String(inputPath)).replace(/\\/g, "/");
    if (/^\/[a-zA-Z]:\//.test(value)) value = value.slice(1);
    const parts = [];
    value.split("/").forEach((part) => {
      if (!part || part === ".") return;
      if (part === "..") { if (parts.length) parts.pop(); return; }
      parts.push(part);
    });
    return parts.join("/");
  };

  const isPathInsideBase = (candidatePath) => {
    const normalizedCandidate = normalizeFsPath(candidatePath).toLowerCase();
    if (basePath) {
      const normalizedBase = normalizeFsPath(basePath).toLowerCase();
      if (normalizedBase && (normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(`${normalizedBase}/`))) return true;
    }
    if (assetsBasePath) {
      const normalizedAssets = normalizeFsPath(assetsBasePath).toLowerCase();
      if (normalizedAssets && (normalizedCandidate === normalizedAssets || normalizedCandidate.startsWith(`${normalizedAssets}/`))) return true;
    }
    return false;
  };

  const fileUrlToPath = (fileUrl) => {
    try {
      const url = new URL(fileUrl);
      if (url.protocol !== "file:") return null;
      return url.pathname;
    } catch { return null; }
  };

  const toAssetProtocol = (filePath) => {
    if (!assetsBasePath) return null;
    const normalizedCandidate = normalizeFsPath(filePath).toLowerCase();
    const normalizedAssets = normalizeFsPath(assetsBasePath).toLowerCase();
    if (!normalizedAssets) return null;
    if (normalizedCandidate === normalizedAssets || normalizedCandidate.startsWith(`${normalizedAssets}/`)) {
      return `timelines-asset://asset/${encodeURIComponent(normalizeFsPath(filePath))}`;
    }
    return null;
  };

  const normalizeSrc = (rawValue) => {
    const value = String(rawValue || "").trim();
    if (!value) return null;
    if (resolveLocalSrc) {
      const resolved = resolveLocalSrc(value);
      if (resolved) return resolved;
    }
    if (/^https:\/\//i.test(value)) return value;
    if (/^timelines-asset:\/\//i.test(value)) return value;
    if (/^file:\/\//i.test(value)) {
      const filePath = fileUrlToPath(value);
      if (!filePath || !isPathInsideBase(filePath)) return null;
      return toAssetProtocol(filePath) ?? value;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;

    // Bare filename (no path separators) → resolve against assets timeline dir
    if (assetsTimelineDir && !value.includes("/") && !value.includes("\\") && !value.startsWith(".")) {
      const assetPath = normalizeFsPath(`${assetsTimelineDir}${value}`);
      const assetProtocol = toAssetProtocol(assetPath);
      if (assetProtocol) return assetProtocol;
    }

    if (!baseUrl) return null;
    try {
      const resolved = new URL(value, baseUrl).toString();
      const resolvedPath = fileUrlToPath(resolved);
      if (!resolvedPath || !isPathInsideBase(resolvedPath)) return null;
      return toAssetProtocol(resolvedPath) ?? resolved;
    } catch { return null; }
  };

  const normalizeHref = (rawValue) => {
    const value = String(rawValue || "").trim();
    if (!value) return null;
    if (/^https:\/\//i.test(value) || /^mailto:/i.test(value)) return value;
    if (/^file:\/\//i.test(value)) {
      const filePath = fileUrlToPath(value);
      if (!filePath || !isPathInsideBase(filePath)) return null;
      return value;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;
    if (!baseUrl) return null;
    try {
      const resolved = new URL(value, baseUrl).toString();
      const resolvedPath = fileUrlToPath(resolved);
      if (!resolvedPath || !isPathInsideBase(resolvedPath)) return null;
      return resolved;
    } catch { return null; }
  };

  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "a", "abbr", "b", "blockquote", "br", "code", "del", "div", "em",
      "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "iframe",
      "img", "input", "li", "mark", "ol", "p", "pre", "span", "strong",
      "table", "tbody", "thead", "tr", "td", "th", "u", "ul", "video",
    ],
    ALLOWED_ATTR: [
      "href", "target", "rel", "src", "alt", "title", "color", "face",
      "size", "width", "height", "loading", "frameborder", "allowfullscreen",
      "allow", "class", "controls", "type", "checked", "disabled",
      "data-note-target", "data-note-path",
    ],
    KEEP_CONTENT: true,
  });

  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, "text/html");
  const nodes = Array.from(doc.body.querySelectorAll("*"));
  let checkboxIdx = 0;
  nodes.forEach((node) => {
    const tagName = node.tagName.toLowerCase();

    if (tagName === "a" && node.classList.contains("wikilink")) {
      node.removeAttribute("href");
      return;
    }

    if (tagName === "a") {
      const href = normalizeHref(node.getAttribute("href"));
      if (!href) node.removeAttribute("href");
      else node.setAttribute("href", href);
      node.setAttribute("rel", "noopener noreferrer");
      node.setAttribute("target", "_blank");
    }

    if (tagName === "img" || tagName === "video") {
      const src = normalizeSrc(node.getAttribute("src"));
      if (!src) { node.remove(); return; }
      node.setAttribute("src", src);
      if (tagName === "img" && !node.getAttribute("loading")) node.setAttribute("loading", "lazy");
    }

    if (tagName === "iframe") {
      const ALLOWED_IFRAME_ORIGINS = [
        "https://www.youtube-nocookie.com",
        "https://www.youtube.com",
        "https://player.vimeo.com",
      ];
      const src = node.getAttribute("src") || "";
      if (!ALLOWED_IFRAME_ORIGINS.some((origin) => src.startsWith(origin + "/"))) {
        node.remove();
        return;
      }
    }

    if (tagName === "input" && node.getAttribute("type") === "checkbox") {
      node.removeAttribute("disabled");
      node.setAttribute("data-idx", checkboxIdx++);
    }
  });

  return doc.body.innerHTML;
}

// One image src resolved the same way rendered notes resolve it, for live preview widgets
export function resolveNoteImageSrc(src, baseUrl = "", basePath = "", assetsBasePath = "", assetsTimelineDir = "", resolveLocalSrc = null) {
  const html = sanitizeNoteHtml(`<img src="${escapeHtml(src)}">`, baseUrl, basePath, assetsBasePath, assetsTimelineDir, resolveLocalSrc);
  const match = /<img[^>]*\ssrc="([^"]*)"/.exec(html);
  return match ? match[1].replace(/&amp;/g, "&") : null;
}

// options.resolveWikilink: (target) => notePath | null, so unresolved links render faded
// options.omitFrontmatter: the note page renders properties itself
export function renderNoteMarkdown(content, isLoading, baseUrl = "", basePath = "", assetsBasePath = "", assetsTimelineDir = "", resolveLocalSrc = null, options = {}) {
  const raw = isLoading ? "_Loading note..._" : content || "";

  let frontmatterHtml = "";
  const { rows: fmRows, body } = splitFrontmatter(raw);
  if (fmRows.length && !options.omitFrontmatter) {
    const rows = fmRows.map(([key, val]) => `<div class="fm-row"><span class="fm-key">${key}</span><span class="fm-val">${val}</span></div>`).join("");
    frontmatterHtml = `<div class="frontmatter"><div class="fm-header">Properties</div>${rows}</div>`;
  }

  const withUnderline = body.replace(/__(.+?)__/g, "<u>$1</u>");
  const withHighlight = withUnderline.replace(/==(.+?)==/g, "<mark>$1</mark>");

  const extractYouTubeId = (url) => {
    try {
      const u = new URL(url);
      if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0];
      if (u.hostname === "youtube.com" || u.hostname.endsWith(".youtube.com")) return u.searchParams.get("v");
    } catch { /* invalid URL */ }
    return null;
  };

  const extractVimeoId = (url) => {
    try {
      const u = new URL(url);
      if (u.hostname === "vimeo.com" || u.hostname.endsWith(".vimeo.com")) {
        const match = u.pathname.match(/\/(\d+)/);
        return match ? match[1] : null;
      }
    } catch { /* invalid URL */ }
    return null;
  };

  const renderer = new markdown.Renderer();
  const originalImage = renderer.image.bind(renderer);
  renderer.image = (href, title, text) => {
    const youtubeId = extractYouTubeId(href);
    if (youtubeId) return `<iframe class="video-embed" src="https://www.youtube-nocookie.com/embed/${youtubeId}" width="560" height="315" frameborder="0" referrerpolicy="origin-when-cross-origin" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
    const vimeoId = extractVimeoId(href);
    if (vimeoId) return `<iframe class="video-embed" src="https://player.vimeo.com/video/${vimeoId}" width="560" height="315" frameborder="0" allowfullscreen allow="autoplay; fullscreen; picture-in-picture"></iframe>`;
    if (/^https:\/\//i.test(href) && /\.(mp4|webm|ogg|mov)(\?|$)/i.test(href)) return `<video class="video-embed" src="${href}" controls></video>`;
    return originalImage(href, title, text);
  };

  activeWikilinkResolver = options.resolveWikilink || null;
  let html;
  try {
    html = markdown.parse(withHighlight, { renderer });
  } finally {
    activeWikilinkResolver = null;
  }
  return sanitizeNoteHtml(frontmatterHtml + html, baseUrl, basePath, assetsBasePath, assetsTimelineDir, resolveLocalSrc);
}
