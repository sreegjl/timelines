// manual ordering for elements. no order = "whenever, babe", which sorts after everyone who has one
const orderOf = (el) => (Number.isFinite(el?.order) ? el.order : Number.POSITIVE_INFINITY);

export function compareManualOrder(a, b) {
  const oa = orderOf(a);
  const ob = orderOf(b);
  if (oa === ob) return 0;
  return oa < ob ? -1 : 1;
}

const dateOf = (el) => el?.date ?? el?.start ?? 0;

export function sortByManualOrder(items) {
  return [...items].sort((a, b) =>
    compareManualOrder(a, b) ||
    dateOf(a) - dateOf(b) ||
    String(a?.title || a?.id || "").localeCompare(String(b?.title || b?.id || ""))
  );
}

// move one id next to another inside the full (manually sorted) list, returns the new id order
export function moveInOrder(items, draggedId, targetId, placeAfter = false) {
  const ids = sortByManualOrder(items).map((el) => el.id);
  const from = ids.indexOf(draggedId);
  if (from === -1 || draggedId === targetId || !ids.includes(targetId)) return ids;
  ids.splice(from, 1);
  const to = ids.indexOf(targetId) + (placeAfter ? 1 : 0);
  ids.splice(to, 0, draggedId);
  return ids;
}
