import { useState, useEffect, useRef } from "react";
import { ChevronDown, Pencil, Trash2, BookOpen, RotateCw } from "lucide-react";
import DOMPurify from "dompurify";
import { parseMediaWikiUrl } from "../utils/validation";
import { fetchWikipedia } from "../utils/electronApi";
import { getWikiCacheEntry, setWikiCacheEntry } from "../utils/wikiCacheStore";

// Outside Electron there is no IPC proxy; MediaWiki APIs allow direct
// anonymous CORS requests when origin=* is appended.
async function fetchWikiApi(url) {
  if (window.electron !== undefined) return fetchWikipedia({ url });
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}origin=*`);
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true, html: await res.text() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const WIKI_SANITIZE_VERSION = "collapsible-2";

// Persistent cache entries older than this are re-fetched in the background after being served.
const WIKI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Module-level LRU so cached articles survive component remounts (WikiSection is keyed by selected element).
const WIKI_CACHE_MAX_ENTRIES = 30;
const wikiCache = new Map();

function getCachedWiki(key) {
  if (!wikiCache.has(key)) return undefined;
  const value = wikiCache.get(key);
  wikiCache.delete(key);
  wikiCache.set(key, value);
  return value;
}

function setCachedWiki(key, value) {
  wikiCache.delete(key);
  wikiCache.set(key, value);
  while (wikiCache.size > WIKI_CACHE_MAX_ENTRIES) wikiCache.delete(wikiCache.keys().next().value);
}

function sanitizeWikiHtml(html, host = "https://en.wikipedia.org") {
  const preDoc = new DOMParser().parseFromString(html, "text/html");
  preDoc.querySelectorAll("img").forEach((img) => {
    const lazySrc = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original");
    if (lazySrc) img.setAttribute("src", lazySrc);
  });
  const sanitized = DOMPurify.sanitize(preDoc.body.innerHTML, {
    ALLOWED_TAGS: [
      "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code",
      "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt",
      "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6",
      "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre",
      "q", "s", "samp", "section", "small", "span", "strong", "sub",
      "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead",
      "time", "tr", "u", "ul", "var", "wbr",
    ],
    ALLOWED_ATTR: [
      "href", "target", "rel", "src", "alt", "title", "class", "id",
      "colspan", "rowspan", "scope", "headers", "width", "height",
      "loading", "decoding",
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
    KEEP_CONTENT: true,
  });

  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, "text/html");
  doc.body.querySelectorAll("a").forEach((node) => {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
    const href = node.getAttribute("href");
    if (href && href.startsWith("/")) {
      node.setAttribute("href", `${host}${href}`);
    } else if (href && href.startsWith("./")) {
      node.setAttribute("href", `${host}/wiki/${href.slice(2)}`);
    }
  });
  doc.body.querySelectorAll("img").forEach((node) => {
    let src = node.getAttribute("src");
    if (src && src.startsWith("//")) {
      src = `https:${src}`;
    } else if (src && src.startsWith("/")) {
      src = `${host}${src}`;
    }
    if (src) {
      src = src.replace(/\/revision\/latest\/[^?]+/, "/revision/latest");
      node.setAttribute("src", src);
    }
    node.setAttribute("loading", "eager");
  });

  const mapLikeSelectors = [
    ".mw-kartographer-map", ".mw-kartographer-maplink", ".mw-kartographer-container",
    ".locmap", ".maptable", ".maplink", ".mapframe", ".coordinates",
    ".geo-inline-hidden", ".plainlist .geo", ".plainlist .geo-inline",
  ];
  doc.body.querySelectorAll(mapLikeSelectors.join(",")).forEach((node) => {
    const removableWrapper = node.closest("li, tr, figure, p, div");
    if (removableWrapper && removableWrapper !== doc.body && removableWrapper.textContent?.trim() === node.textContent?.trim()) {
      removableWrapper.remove();
    } else {
      node.remove();
    }
  });
  doc.body.querySelectorAll('a[href*="geohack"], a[href*="openstreetmap"], a[href*="maplink"], a[href*="maps.wikimedia"]').forEach((node) => {
    const removableWrapper = node.closest("li, tr, p, div");
    if (removableWrapper && /map|coordinate|openstreetmap|geohack/i.test(removableWrapper.textContent || "")) {
      removableWrapper.remove();
    } else {
      node.remove();
    }
  });
  doc.body.querySelectorAll(".infobox tr").forEach((row) => {
    const rowText = (row.textContent || "").toLowerCase();
    const hasMapMarkers = Boolean(row.querySelector(
      '.mw-kartographer-map, .mw-kartographer-maplink, .mw-kartographer-container, .locmap, .maptable, .mapframe, .coordinates, .geo, a[href*="geohack"], a[href*="openstreetmap"], a[href*="maps.wikimedia"]'
    ));
    const looksLikeLocationList =
      row.querySelector(".plainlist, ul, ol") &&
      /map|location|locations|coordinates|coord\./.test(rowText);
    if (hasMapMarkers || looksLikeLocationList) row.remove();
  });

  doc.body.querySelectorAll(".mw-collapsible").forEach((collapsible) => {
    const titleEl = collapsible.querySelector(".sidebar-list-title");
    const contentEl = collapsible.querySelector(".mw-collapsible-content");
    if (!titleEl || !contentEl) return;
    collapsible.querySelectorAll(".mw-collapsible-text").forEach((el) => el.remove());
    const details = doc.createElement("details");
    details.className = "wiki-sidebar-section";
    const summary = doc.createElement("summary");
    summary.className = "wiki-sidebar-summary";
    while (titleEl.firstChild) summary.appendChild(titleEl.firstChild);
    details.appendChild(summary);
    contentEl.classList.add("wiki-sidebar-content");
    details.appendChild(contentEl);
    collapsible.parentNode.replaceChild(details, collapsible);
  });

  return doc.body.innerHTML;
}

export default function WikiSection({ wikiUrl, useWiki, isEditMode, onUrlChange }) {
  const [wikiContent, setWikiContent] = useState("");
  const [isWikiLoading, setIsWikiLoading] = useState(false);
  const [wikiError, setWikiError] = useState("");
  const [isWikiCollapsed, setIsWikiCollapsed] = useState(false);
  const [wikiUrlInput, setWikiUrlInput] = useState("");
  const [isWikiUrlInputOpen, setIsWikiUrlInputOpen] = useState(false);
  const [wikiUrlInputError, setWikiUrlInputError] = useState("");
  const wikiRenderRef = useRef(null);
  const wikiUrlInputRef = useRef(null);
  const activeUrlRef = useRef(null);

  const fetchWikiContent = async (url, { forceRefresh = false, background = false } = {}) => {
    if (!url) return;
    if (!background) activeUrlRef.current = url;
    const cacheKey = `${WIKI_SANITIZE_VERSION}:${url}`;
    if (!forceRefresh && !background) {
      const cached = getCachedWiki(cacheKey);
      if (cached !== undefined) {
        if (activeUrlRef.current !== url) return;
        setWikiContent(cached);
        setWikiError("");
        return;
      }
      const entry = await getWikiCacheEntry(cacheKey);
      if (entry?.html) {
        setCachedWiki(cacheKey, entry.html);
        if (activeUrlRef.current !== url) return;
        setWikiContent(entry.html);
        setWikiError("");
        if (Date.now() - (entry.fetchedAt || 0) > WIKI_CACHE_TTL_MS) {
          fetchWikiContent(url, { background: true });
        }
        return;
      }
      if (activeUrlRef.current !== url) return;
    }
    const parsed = parseMediaWikiUrl(url);
    if (!parsed) {
      if (background) return;
      setWikiError("Invalid wiki URL");
      setWikiContent("");
      return;
    }
    if (!background) {
      setIsWikiLoading(true);
      setWikiError("");
    }
    try {
      const apiPaths = [`${parsed.host}/api.php`, `${parsed.host}/w/api.php`];
      const titleCandidates = [parsed.title];
      if (parsed.title.includes("/")) {
        const lastSegment = parsed.title.split("/").pop();
        if (lastSegment) titleCandidates.push(lastSegment);
      }

      const resolveSectionIndex = async (base, title, anchor) => {
        const q = `?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json&formatversion=2`;
        const result = await fetchWikiApi(base + q);
        if (!result?.success) return null;
        const j = JSON.parse(result.html);
        const sections = j?.parse?.sections;
        if (!Array.isArray(sections)) return null;
        const normalizedAnchor = anchor.replace(/_/g, " ");
        const match = sections.find((s) =>
          s.anchor === anchor ||
          s.anchor.replace(/_/g, " ") === normalizedAnchor ||
          (() => { let t = s.line ?? ""; let prev; do { prev = t; t = t.replace(/<[^>]*>/g, ""); } while (t !== prev); return t; })() === normalizedAnchor
        );
        return match ? match.index : null;
      };

      const tryApi = async (base, title, sectionIndex) => {
        let q = `?action=parse&page=${encodeURIComponent(title)}&prop=text&disabletoc=1&format=json&formatversion=2`;
        if (sectionIndex != null) q += `&section=${sectionIndex}`;
        const result = await fetchWikiApi(base + q);
        if (!result?.success) return null;
        const j = JSON.parse(result.html);
        let text = j?.parse?.text;
        if (text && typeof text === "object") text = text["*"] ?? null;
        return text ? { parse: { ...j.parse, text } } : null;
      };

      let data = null;
      outer: for (const title of titleCandidates) {
        for (const base of apiPaths) {
          let sectionIndex = null;
          if (parsed.section) {
            sectionIndex = await resolveSectionIndex(base, title, parsed.section);
            if (sectionIndex == null) continue;
          }
          data = await tryApi(base, title, sectionIndex);
          if (data) break outer;
        }
      }

      if (!data && parsed.section) {
        outer2: for (const title of titleCandidates) {
          for (const base of apiPaths) {
            data = await tryApi(base, title, null);
            if (data) break outer2;
          }
        }
      }

      if (!data) {
        const pageResult = await fetchWikiApi(url);
        if (pageResult?.success) {
          const pageDoc = new DOMParser().parseFromString(pageResult.html, "text/html");
          const editUri = pageDoc.querySelector('link[rel="EditURI"]')?.getAttribute("href");
          const apiBase = editUri?.replace(/\?.*$/, "");
          const pageTitleMatch = pageResult.html.match(/"wgPageName":"([^"]+)"/);
          const discoveredTitle = pageTitleMatch?.[1];
          const apiOriginOk = (() => { try { return new URL(apiBase).origin === parsed.host; } catch { return false; } })();
          if (apiBase && apiOriginOk) {
            const discoveryTitles = [...new Set([
              ...(discoveredTitle ? [discoveredTitle] : []),
              ...titleCandidates,
            ])];
            for (const title of discoveryTitles) {
              let sectionIndex = null;
              if (parsed.section) {
                sectionIndex = await resolveSectionIndex(apiBase, title, parsed.section);
              }
              data = await tryApi(apiBase, title, sectionIndex);
              if (data) break;
            }
          }
        }
      }
      if (!data) throw new Error("No content returned");
      const sanitized = sanitizeWikiHtml(data.parse.text, parsed.host);
      setCachedWiki(cacheKey, sanitized);
      setWikiCacheEntry(cacheKey, sanitized);
      if (activeUrlRef.current !== url) return;
      setWikiContent(sanitized);
    } catch (err) {
      if (background) return;
      if (activeUrlRef.current !== url) return;
      setWikiError(`Failed to load wiki article: ${err.message}`);
      setWikiContent("");
    } finally {
      if (!background && activeUrlRef.current === url) setIsWikiLoading(false);
    }
  };

  const handleWikiRefresh = (e) => {
    e.stopPropagation();
    if (isWikiLoading) return;
    fetchWikiContent(wikiUrl, { forceRefresh: true });
  };

  useEffect(() => {
    if (!wikiUrl) {
      activeUrlRef.current = null;
      setWikiContent("");
      setWikiError("");
      return;
    }
    fetchWikiContent(wikiUrl);
  }, [wikiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wikiRenderRef.current || !wikiContent) return;
    const container = wikiRenderRef.current;
    container.querySelectorAll(".infobox td").forEach((td) => {
      if (td.dataset.wikiInit) return;
      td.dataset.wikiInit = "1";
      if (td.querySelectorAll("li").length < 4) return;
      const contentWrap = document.createElement("div");
      contentWrap.className = "wiki-section-hidden";
      while (td.firstChild) contentWrap.appendChild(td.firstChild);
      const bracket = document.createElement("span");
      bracket.className = "wiki-toggle-bracket";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wiki-toggle-btn";
      btn.textContent = "show";
      bracket.appendChild(document.createTextNode("["));
      bracket.appendChild(btn);
      bracket.appendChild(document.createTextNode("]"));
      btn.addEventListener("click", () => {
        const nowHidden = contentWrap.classList.toggle("wiki-section-hidden");
        btn.textContent = nowHidden ? "show" : "hide";
      });
      td.appendChild(bracket);
      td.appendChild(contentWrap);
    });
  }, [wikiContent]);

  const handleOpenWikiInput = () => {
    setWikiUrlInput(wikiUrl || "");
    setWikiUrlInputError("");
    setIsWikiUrlInputOpen(true);
    setTimeout(() => wikiUrlInputRef.current?.focus(), 0);
  };

  const handleWikiUrlSubmit = () => {
    const trimmed = wikiUrlInput.trim();
    if (!trimmed) {
      setIsWikiUrlInputOpen(false);
      setWikiUrlInputError("");
      return;
    }
    if (!parseMediaWikiUrl(trimmed)) {
      setWikiUrlInputError("Enter a valid MediaWiki URL (e.g., https://en.wikipedia.org/wiki/Ancient_Greece)");
      return;
    }
    onUrlChange(trimmed);
    setIsWikiUrlInputOpen(false);
    setWikiUrlInputError("");
  };

  const handleWikiUrlKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleWikiUrlSubmit();
    } else if (e.key === "Escape") {
      setIsWikiUrlInputOpen(false);
      setWikiUrlInputError("");
    }
  };

  const handleRemoveWikiUrl = () => {
    onUrlChange(null);
    setWikiContent("");
    setWikiError("");
    setIsWikiUrlInputOpen(false);
    setWikiUrlInputError("");
  };

  if (!useWiki) return null;

  if (!isEditMode) {
    if (!wikiUrl) return null;
    const parsedForLink = parseMediaWikiUrl(wikiUrl);
    const safeHref = parsedForLink
      ? `${parsedForLink.host}/wiki/${encodeURIComponent(parsedForLink.title)}${parsedForLink.section ? `#${encodeURIComponent(parsedForLink.section)}` : ""}`
      : null;
    return (
      <>
        <div className="note-divider" />
        <button type="button" className="rp-note-header sources-collapse-btn" onClick={() => setIsWikiCollapsed(v => !v)}>
          <span className="rp-note-label rp-note-label-wiki">Wiki</span>
          <span className="sources-collapse-right">
            {safeHref && (
              <a
                className="rp-note-meta wiki-header-link"
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in browser"
                onClick={(e) => e.stopPropagation()}
              >
                {parsedForLink?.section ? `§ ${parsedForLink.section.replace(/_/g, " ")}` : "Open article"}
              </a>
            )}
            <span
              role="button"
              tabIndex={0}
              className={`wiki-refresh-btn${isWikiLoading ? " wiki-refresh-btn-loading" : ""}`}
              title="Reload article"
              onClick={handleWikiRefresh}
              onKeyDown={(e) => { if (e.key === "Enter") handleWikiRefresh(e); }}
            >
              <RotateCw size={13} />
            </span>
            <ChevronDown size={14} style={{ transform: isWikiCollapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s ease", color: "var(--ui-muted)" }} />
          </span>
        </button>
        {!isWikiCollapsed && (isWikiLoading ? (
          <div className="wiki-loading">Loading wiki article...</div>
        ) : wikiError ? (
          <div className="wiki-error">{wikiError}</div>
        ) : (
          <div ref={wikiRenderRef} className="wiki-render" dangerouslySetInnerHTML={{ __html: wikiContent }} />
        ))}
      </>
    );
  }

  // Edit mode
  const parsedWiki = wikiUrl ? parseMediaWikiUrl(wikiUrl) : null;

  return (
    <>
      {!wikiUrl && !isWikiUrlInputOpen && (
        <button type="button" className="note-create-card" onClick={handleOpenWikiInput}>
          <div className="note-create-card-icon"><BookOpen size={18} /></div>
          <div className="note-create-card-text">
            <span className="note-create-card-title">Add wiki</span>
            <span className="note-create-card-subtitle">Link a MediaWiki article or section</span>
          </div>
        </button>
      )}
      {isWikiUrlInputOpen && (
        <div className="wiki-url-input-card">
          <div className="source-field">
            <label className="source-field-label">URL</label>
            <input
              ref={wikiUrlInputRef}
              type="text"
              className={`source-field-input${wikiUrlInputError ? " settings-input-error" : ""}`}
              value={wikiUrlInput}
              onChange={(e) => { setWikiUrlInput(e.target.value); setWikiUrlInputError(""); }}
              onKeyDown={handleWikiUrlKeyDown}
              placeholder="https://en.wikipedia.org/wiki/… or …/wiki/Page#Section"
            />
            {wikiUrlInputError && <div className="wiki-url-error">{wikiUrlInputError}</div>}
          </div>
          <div className="source-add-actions">
            <button type="button" className="btn-secondary" onClick={() => { setIsWikiUrlInputOpen(false); setWikiUrlInputError(""); }}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleWikiUrlSubmit}>Save</button>
          </div>
        </div>
      )}
      {wikiUrl && parsedWiki && !isWikiUrlInputOpen && (() => {
        const articleTitle = parsedWiki.title.replace(/_/g, " ");
        const sectionName = parsedWiki.section?.replace(/_/g, " ");
        let articleHost = "";
        try { articleHost = new URL(parsedWiki.host).hostname; } catch { /* invalid host */ }
        return (
          <div className="wiki-url-card">
            <div className="wiki-url-card-avatar">{articleTitle.charAt(0).toUpperCase()}</div>
            <div className="wiki-url-card-info">
              <div className="wiki-url-card-title">{articleTitle}{sectionName ? ` § ${sectionName}` : ""}</div>
              <div className="wiki-url-card-host">{articleHost}</div>
            </div>
            <div className="wiki-url-card-actions">
              <button type="button" className="wiki-url-card-btn" onClick={handleOpenWikiInput} title="Change"><Pencil size={13} /></button>
              <button type="button" className="wiki-url-card-btn wiki-url-card-btn-remove" onClick={handleRemoveWikiUrl} title="Remove"><Trash2 size={13} /></button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
