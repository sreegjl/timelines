/**
 * Generate a URL-safe ID from a title
 * @param {string} title - The title to convert to an ID
 * @param {string} type - The type prefix (event, span, era)
 * @returns {string} - The generated ID
 */
export function generateIdFromTitle(title, type) {
  const sanitized = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  return `${type}-${sanitized}`;
}


/**
 * Storage key for a timeline's notes/assets folders: the immutable file.uid,
 * with fallback to the title-derived file.id for older timelines.
 */
export function getStorageId(file) {
  return file?.uid ?? file?.id?.replace(/-timeline$/, "") ?? null;
}


// Storage uid: title slug plus random digits so same-titled timelines never share notes/assets folders
export function generateStorageUid(base) {
  return `${String(base || "timeline")}-${getRandomDigits(6)}`;
}

const RANDOM_ID_RETRY_LIMIT = 1024;

const getRandomDigits = (length = 12) => {
  const max = 10 ** length;
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return String(bytes[0] % max).padStart(length, "0");
  }
  return String(Math.floor(Math.random() * max)).padStart(length, "0");
};

export function ensureUniqueElementIds(elements) {
  if (!Array.isArray(elements)) return elements;
  const used = new Set();
  let changed = false;
  const next = elements.map((el) => {
    if (!el || typeof el !== "object") return el;
    const id = el.id != null ? String(el.id) : "";
    if (id && !used.has(id)) {
      used.add(id);
      return el;
    }
    changed = true;
    const prefix = String(el.type || "item").trim().toLowerCase();
    let fresh = `${prefix}-${getRandomDigits(12)}`;
    while (used.has(fresh)) fresh = `${prefix}-${getRandomDigits(12)}`;
    used.add(fresh);
    return { ...el, id: fresh };
  });
  return changed ? next : elements;
}

export function generateUniqueRandomElementId(elements, type = "item", excludeId) {
  const ids = new Set((elements || []).map((el) => String(el.id)));
  if (excludeId) ids.delete(String(excludeId));
  const prefix = String(type || "item").trim().toLowerCase();

  for (let i = 0; i < RANDOM_ID_RETRY_LIMIT; i += 1) {
    const candidate = `${prefix}-${getRandomDigits(12)}`;
    if (!ids.has(candidate)) return candidate;
  }

  let fallback = `${prefix}-${Date.now()}`;
  while (ids.has(fallback)) {
    fallback = `${prefix}-${Number(fallback.split("-").pop()) + 1}`;
  }
  return fallback;
}


/**
 * Update an element with a new ID and update all references
 * @param {Object} timelineData 
 * @param {Object} updatedElement 
 * @param {string} originalId 
 * @returns {Object} 
 */
export function updateElementWithNewId(timelineData, updatedElement, originalId) {
  const dataWithUpdatedElement = {
    ...timelineData,
    elements: timelineData.elements.map((el) =>
      el.id === originalId ? updatedElement : el
    ),
  };
  return dataWithUpdatedElement;
}
