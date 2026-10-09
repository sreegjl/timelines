// Obsidian-style [[wikilink]] parsing and resolution against the notes folder.
// Note paths are relative to the notes root and always use forward slashes.

// Mirrors safeName in electron/main.cjs so paths match the folders main writes
const safeName = (value) => String(value || "")
  .trim()
  .replace(/[^\w.-]+/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-+|-+$/g, "")
  .toLowerCase();

// Mirrors getNotesDir: the timeline's notes folder relative to the notes root
export function timelineNotesDir(storageId) {
  const parts = String(storageId || "").split(/[/\\]/).map(safeName).filter(Boolean);
  return parts.length > 0 ? parts.join("/") : "timeline";
}

// Mirrors resolveNotePath: slash refs are root-relative, bare names live in the timeline's folder
export function toNotePath(noteFile, timelineDir) {
  const raw = String(noteFile || "").trim().replace(/\\/g, "/");
  if (!raw) return null;
  if (raw.includes("/")) return raw.replace(/^\.\//, "");
  const base = cleanNoteFileName(raw.replace(/\.md$/i, "")) || "note";
  return `${timelineDir}/${base}.md`;
}

// A path main's resolveNotePath reads from the notes root, even for files at the root itself
export function toNoteRef(notePath) {
  return notePath.includes("/") ? notePath : `./${notePath}`;
}

export function noteName(notePath) {
  const file = String(notePath || "").split("/").pop() || "";
  return file.replace(/\.md$/i, "");
}

const dirOf = (notePath) => {
  const idx = notePath.lastIndexOf("/");
  return idx === -1 ? "" : notePath.slice(0, idx);
};

// "Target#Heading|Alias" -> { target, heading, alias }
export function parseWikilink(inner) {
  const raw = String(inner || "");
  const pipe = raw.indexOf("|");
  const linkPart = pipe === -1 ? raw : raw.slice(0, pipe);
  const alias = pipe === -1 ? "" : raw.slice(pipe + 1).trim();
  const hash = linkPart.indexOf("#");
  const target = (hash === -1 ? linkPart : linkPart.slice(0, hash)).trim();
  const heading = hash === -1 ? "" : linkPart.slice(hash + 1).trim();
  return { target, heading, alias };
}

export function buildNoteIndex(paths) {
  const byPath = new Map();
  const byName = new Map();
  for (const p of paths || []) {
    if (typeof p !== "string" || !/\.md$/i.test(p)) continue;
    const notePath = p.replace(/\\/g, "/").replace(/^\.\//, "");
    byPath.set(notePath.toLowerCase(), notePath);
    const key = noteName(notePath).toLowerCase();
    const list = byName.get(key);
    if (list) list.push(notePath);
    else byName.set(key, [notePath]);
  }
  return { byPath, byName };
}

const depth = (p) => p.split("/").length;

// Prefers the open timeline's folder, then the linking note's folder, then the shortest path
const pickBest = (candidates, { timelineDir, fromPath }) => {
  if (candidates.length === 1) return candidates[0];
  const fromDir = fromPath ? dirOf(fromPath) : null;
  const rank = (p) => {
    if (timelineDir && p.startsWith(`${timelineDir}/`)) return 0;
    if (fromDir !== null && dirOf(p) === fromDir) return 1;
    return 2;
  };
  return [...candidates].sort((a, b) =>
    rank(a) - rank(b) || depth(a) - depth(b) || a.length - b.length || a.localeCompare(b)
  )[0];
};

export function resolveWikilink(target, index, context = {}) {
  if (!index) return null;
  const clean = String(target || "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "");
  if (!clean) return null;
  const lower = clean.toLowerCase();

  if (clean.includes("/")) {
    const exact = index.byPath.get(`${lower}.md`);
    if (exact) return exact;
    // Obsidian also accepts a trailing part of the path, like [[People/Alice]]
    const suffix = `/${lower}.md`;
    const matches = [...index.byPath.entries()].filter(([key]) => key.endsWith(suffix)).map(([, p]) => p);
    return matches.length ? pickBest(matches, context) : null;
  }

  const candidates = index.byName.get(lower);
  return candidates?.length ? pickBest(candidates, context) : null;
}

// Strips characters Windows and macOS reject, keeping spaces and case like Obsidian does
export function cleanNoteFileName(name) {
  return String(name || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*#^[\]\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
}
