// plain text out of markdown, good enough for searching. not a parser, just vibes and regex
export function stripMarkdown(content) {
  return String(content ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, target, alias) => alias || target)
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|~~|==|`)/g, "")
    .replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

// finds the first hit and returns a little window around it, split so the ui can bold the match
export function findNoteSnippet(content, query, radius = 48) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return null;
  const text = stripMarkdown(content);
  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + needle.length + radius);
  let count = 0;
  for (let at = text.toLowerCase().indexOf(needle); at !== -1; at = text.toLowerCase().indexOf(needle, at + needle.length)) count++;
  return {
    before: `${start > 0 ? "…" : ""}${text.slice(start, index)}`,
    match: text.slice(index, index + needle.length),
    after: `${text.slice(index + needle.length, end)}${end < text.length ? "…" : ""}`,
    count,
  };
}

// raw text a search should look for inside notes. filter syntax (tags, dates, is:) isn't note material
export function getNoteSearchText(query) {
  const q = String(query ?? "").trim();
  if (!q || /(^|\s)(#|is:|has:|family:|parent:|contains:|[<>])/i.test(q) || /[|()~]/.test(q)) return "";
  return q.replace(/^"(.*)"$/, "$1").trim();
}
