import Papa from "papaparse";
import { parseTimelineInput } from "./dateUtils.js";
import { generateUniqueRandomElementId } from "./idUtils.js";
import { applyFieldValue } from "./elementFields.js";

const MAIN_GROUP_ID = "g-main";

// Fields a CSV column can map to, in the order the import modal lists them. Kept to what
// generic spreadsheets carry; app-specific structure (eras, parents, styles) round-trips via .timeline/.json.
export const IMPORT_FIELDS = ["title", "date", "end", "description", "group", "tags", "color"];

// Common header names from other apps, compared after normalizeHeader
const FIELD_ALIASES = {
  title: ["title", "name", "event", "label", "heading", "subject"],
  date: ["date", "datestart", "start", "startdate", "year", "begin", "from", "when", "startyear"],
  end: ["end", "enddate", "finish", "until", "to", "endyear"],
  description: ["description", "desc", "details", "summary"],
  group: ["group", "track", "lane"],
  tags: ["tags", "tag", "category", "categories", "labels"],
  color: ["color", "colour"],
};

const normalizeHeader = (h) => String(h ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function parseCsv(text) {
  const result = Papa.parse(String(text ?? "").replace(/^\uFEFF/, ""), { skipEmptyLines: "greedy" });
  const [headerRow = [], ...rows] = result.data;
  const headers = headerRow.map((h) => String(h ?? "").trim());
  return { headers, rows: rows.map((r) => headers.map((_, i) => String(r[i] ?? ""))) };
}

// labels: { fieldKey: localized column label } so the app's own exports match in any language.
// Returns one field key (or "") per header; each field is used at most once.
export function guessMapping(headers, labels = {}) {
  const used = new Set();
  return headers.map((header) => {
    const norm = normalizeHeader(header);
    if (!norm) return "";
    const field = IMPORT_FIELDS.find((f) =>
      !used.has(f) && (normalizeHeader(labels[f]) === norm || FIELD_ALIASES[f]?.includes(norm))
    );
    if (!field) return "";
    used.add(field);
    return field;
  });
}

const newElementBase = (type, id) => type === "event"
  ? { id, type, title: "", date: null, groupId: MAIN_GROUP_ID, parents: [], eventLineStyle: "solid", eventBorderStyle: "solid" }
  : { id, type, title: "", start: null, end: null, groupId: MAIN_GROUP_ID, color: "#A6977E" };

// rows: string[][] from parseCsv; mapping: field key per column from guessMapping (or the user).
// Returns { elements, groups, start, end, useCalendar, skipped: [{ row, reason }] } where groups
// are the ones to add after the default "Main" group, and row is the 1-based line in the file.
export function buildTimelineFromRows(rows, mapping, { dateFormat } = {}) {
  const col = Object.fromEntries(mapping.map((field, i) => [field, i]).filter(([field]) => field));
  const cell = (row, field) => (col[field] != null ? String(row[col[field]] ?? "") : "");

  // Groups named in the file, matched case-insensitively; "Main" is the default group
  const groups = [];
  const allGroups = [{ id: MAIN_GROUP_ID, title: "Main" }];
  if (col.group != null) {
    for (const row of rows) {
      const name = cell(row, "group").trim();
      if (!name || allGroups.some((g) => g.title.toLowerCase() === name.toLowerCase())) continue;
      const group = { id: `g-${allGroups.length + 1}`, title: name, order: allGroups.length, stack: allGroups.length, visible: true, locked: false };
      groups.push(group);
      allGroups.push(group);
    }
  }

  const elements = [];
  const skipped = [];
  let useCalendar = false;

  rows.forEach((row, index) => {
    const line = index + 2; // header is line 1
    const title = cell(row, "title").trim();
    if (!title) { skipped.push({ row: line, reason: "noTitle" }); return; }
    const startInput = parseTimelineInput(cell(row, "date"), dateFormat, false);
    if (startInput.value === null) { skipped.push({ row: line, reason: "noDate" }); return; }
    const endInput = parseTimelineInput(cell(row, "end"), dateFormat, false);

    // A row with a usable end date is a span; everything else is an event
    const type = endInput.value !== null && endInput.value > startInput.value ? "span" : "event";

    let el = newElementBase(type, generateUniqueRandomElementId(elements, type));
    el.title = title;
    el = applyFieldValue(el, "date", cell(row, "date"), { dateFormat, noYearZero: false }) ?? el;
    if (type === "span") el = applyFieldValue(el, "end", cell(row, "end"), { dateFormat, noYearZero: false }) ?? el;
    if (startInput.precision === "month" || startInput.precision === "day") useCalendar = true;
    if (type === "span" && (endInput.precision === "month" || endInput.precision === "day")) useCalendar = true;

    for (const field of ["description", "group", "tags", "color"]) {
      const value = cell(row, field);
      if (value.trim()) el = applyFieldValue(el, field, value, { groups: allGroups }) ?? el;
    }
    elements.push(el);
  });

  // Timeline bounds: the data's range plus 5% each side, rounded out to whole years
  let min = Infinity;
  let max = -Infinity;
  for (const el of elements) {
    const s = el.type === "event" ? el.date : el.start;
    const e = el.type === "event" ? el.date : el.end;
    if (s < min) min = s;
    if (e > max) max = e;
  }
  let start = null;
  let end = null;
  if (elements.length) {
    const pad = Math.max((max - min) * 0.05, 1);
    start = Math.floor(min - pad);
    end = Math.ceil(max + pad);
  }

  return { elements, groups, start, end, useCalendar, skipped };
}
