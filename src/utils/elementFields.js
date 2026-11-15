import { parseTimelineInput } from "./dateUtils.js";
import { normalizeTagValue } from "./validation.js";
import { ICON_MAP } from "../config/elementIcons.js";

// Applies a spreadsheet-style text value to one field of an element. Shared by
// spreadsheet editing/paste and CSV import so both read cells the same way.
// ctx: { elements, groups, dateFormat?, noYearZero? } — elements/groups resolve titles to ids.
// Returns the updated element, or null if the value doesn't apply or nothing changed.
export function applyFieldValue(el, field, val, { elements = [], groups = [], dateFormat, noYearZero } = {}) {
  const updated = { ...el };
  if (field === "title") {
    const t = val.trim(); if (t) updated.title = t; else return null;
  } else if (field === "description") {
    if (el.type !== "span") return null;
    const v = val.trim(); if (v) updated.description = v; else delete updated.description;
  } else if (field === "date") {
    const p = parseTimelineInput(val, dateFormat, noYearZero); if (p.value === null) return null;
    if (el.type === "event") { updated.date = p.value; if (p.label) updated.dateLabel = p.label; else delete updated.dateLabel; }
    else { updated.start = p.value; if (p.label) updated.startLabel = p.label; else delete updated.startLabel; }
  } else if (field === "end") {
    if (el.type === "event") return null;
    const p = parseTimelineInput(val, dateFormat, noYearZero); if (p.value === null) return null;
    if (Number.isFinite(el.start) && p.value <= el.start) return null;
    updated.end = p.value; if (p.label) updated.endLabel = p.label; else delete updated.endLabel;
  } else if (field === "tags") {
    const tags = val.split(",").map((t) => normalizeTagValue(t)).filter(Boolean);
    if (tags.length) updated.tags = tags; else delete updated.tags;
  } else if (field === "icon") {
    const v = val.trim();
    if (v && ICON_MAP[v]) updated.icon = v; else if (!v) delete updated.icon; else return null;
  } else if (field === "coords") {
    const parts = val.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) { updated.lat = parts[0]; updated.lng = parts[1]; }
    else if (!val.trim()) { delete updated.lat; delete updated.lng; }
    else return null;
  } else if (field === "wiki") {
    const v = val.trim(); if (v) updated.wikiUrl = v; else delete updated.wikiUrl;
  } else if (field === "group") {
    const v = val.trim();
    if (v) { const match = groups.find((g) => g.title.toLowerCase() === v.toLowerCase()); if (match) updated.groupId = match.id; else return null; }
    else delete updated.groupId;
  } else if (field === "parent") {
    const v = val.trim();
    const usesExtend = el.type === "span" && el.extendFrom;
    if (!v) {
      if (el.type === "event") { const rest = (el.parents ?? []).slice(1); if (rest.length) updated.parents = rest; else delete updated.parents; }
      else if (usesExtend) delete updated.extendFrom; else delete updated.parent;
    } else {
      const match = elements.find((x) => x.id !== el.id && (x.title ?? "").toLowerCase() === v.toLowerCase());
      if (!match) return null;
      if (el.type === "event") updated.parents = [match.id, ...(el.parents ?? []).slice(1)];
      else if (usesExtend) updated.extendFrom = match.id; else updated.parent = match.id;
    }
  } else if (field === "mergeInto") {
    const v = val.trim();
    if (!v) delete updated.mergeParent;
    else {
      const match = elements.find((x) => x.id !== el.id && x.type === "span" && (x.title ?? "").toLowerCase() === v.toLowerCase());
      if (!match) return null;
      updated.mergeParent = match.id;
    }
  } else if (field === "color") {
    const v = val.trim(); if (v) updated.color = v; else delete updated.color;
  } else if (field === "size") {
    if (el.type === "event") return null;
    const v = val.trim().toLowerCase();
    const sizeKey = el.type === "span" ? "spanSize" : "eraSize";
    if (v) updated[sizeKey] = v; else delete updated[sizeKey];
  } else if (field === "lineStyle") {
    if (el.type !== "event") return null;
    const v = val.trim(); if (v) updated.eventLineStyle = v; else delete updated.eventLineStyle;
  } else if (field === "borderStyle") {
    if (el.type !== "event") return null;
    const v = val.trim(); if (v) updated.eventBorderStyle = v; else delete updated.eventBorderStyle;
  } else if (field === "note") {
    const v = val.trim(); if (v) updated.noteFile = v; else delete updated.noteFile;
  } else if (field === "thumbnail") {
    if (el.type !== "event") return null;
    const v = val.trim(); if (v) updated.thumbnail = v; else delete updated.thumbnail;
  } else if (field === "thumbnailStyle") {
    if (el.type !== "event") return null;
    const valid = ["strip", "banner", "square-fill", "circle-fill"];
    const v = val.trim();
    if (v && valid.includes(v)) updated.thumbnailStyle = v;
    else if (!v) delete updated.thumbnailStyle;
    else return null;
  } else {
    return null;
  }
  return JSON.stringify(el) !== JSON.stringify(updated) ? updated : null;
}
