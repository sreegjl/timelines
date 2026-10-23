// little portals to another timeline, keyed by storage uid so renames and moves don't break them

export const MAX_LINKS_PER_ELEMENT = 20;

export function normalizeLinks(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const timeline = typeof raw?.timeline === "string" ? raw.timeline.trim() : "";
    if (!timeline) continue;
    const element = typeof raw?.element === "string" && raw.element.trim() ? raw.element.trim() : null;
    const key = `${timeline}\n${element ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const link = { timeline };
    if (element) link.element = element;
    if (typeof raw?.timelineTitle === "string" && raw.timelineTitle) link.timelineTitle = raw.timelineTitle.slice(0, 200);
    if (typeof raw?.elementTitle === "string" && raw.elementTitle) link.elementTitle = raw.elementTitle.slice(0, 200);
    out.push(link);
    if (out.length >= MAX_LINKS_PER_ELEMENT) break;
  }
  return out;
}

// library listing entries look like { id: "folder/name", uid, name }. uid first, path as a fallback
export function findLinkTarget(listing, link) {
  if (!link?.timeline || !Array.isArray(listing)) return null;
  return listing.find((entry) => entry?.uid === link.timeline)
    || listing.find((entry) => entry?.id === link.timeline)
    || null;
}

export function describeLink(link, listing, currentUid) {
  const isSelf = !!currentUid && link?.timeline === currentUid;
  const target = findLinkTarget(listing, link);
  // null titles get a translated fallback from the ui
  const timelineTitle = isSelf ? null : (target?.name || link?.timelineTitle || null);
  return {
    isSelf,
    isMissing: !isSelf && Array.isArray(listing) && listing.length > 0 && !target,
    timelineTitle,
    elementTitle: link?.element ? (link.elementTitle || link.element) : null,
  };
}

export const normalizeListing = (result) =>
  (Array.isArray(result) ? result : Array.isArray(result?.files) ? result.files : []);
