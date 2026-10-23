// same folder, new name. bare names get lowercased like the main process does, bc consistency is hot
export const buildRenamedNoteRef = (oldRef, nextName) => {
  const base = String(nextName ?? "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!base) return null;
  const ref = String(oldRef ?? "");
  const slash = ref.lastIndexOf("/");
  if (slash === -1) return `${base.toLowerCase()}.md`;
  return `${ref.slice(0, slash)}/${base}.md`;
};

export const getNoteDisplayName = (ref) => String(ref ?? "").split("/").pop().replace(/\.md$/i, "");
