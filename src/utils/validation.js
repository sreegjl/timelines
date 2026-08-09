import { parseTimelineInput, snapToMonthGrid } from "./dateUtils";

// --- ID / tag / filename validators ---

export const isValidIdValue = (value) => /^[a-z0-9_-]+$/i.test(value);

// Any script is fine; these break filter syntax or the spreadsheet's comma column
const TAG_FORBIDDEN = /[,#|()~"<>]|\p{C}/u;

export const isValidTagValue = (value) => value.length > 0 && !TAG_FORBIDDEN.test(value);

// Bare filename or notes-root-relative slash path, matching what resolveNotePath accepts in main
export const isSafeNoteRef = (name) => {
  if (!name || typeof name !== "string" || name.includes("..")) return false;
  return /^[\w.-]+(\/[\w.-]+)*\.md$/i.test(name);
};

export const normalizeTagValue = (value) => String(value).normalize("NFC").trim().replace(/\s+/g, " ");

// --- URL helpers ---

export const parseMediaWikiUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const hostname = parsed.hostname.toLowerCase();
    if (
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
      /^\[.*\]$/.test(hostname) ||
      hostname === "localhost" ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      hostname === "::1" ||
      hostname === "0.0.0.0"
    ) return null;
    const pathname = parsed.pathname;
    let title = null;
    const prefixMatch = pathname.match(/^\/(?:wiki|title)\/(.+)$/);
    if (prefixMatch) {
      title = decodeURIComponent(prefixMatch[1]);
    } else if (/\/index\.php$/.test(pathname) && parsed.searchParams.get("title")) {
      title = parsed.searchParams.get("title");
    } else if (pathname.length > 1 && !pathname.endsWith("/")) {
      title = decodeURIComponent(pathname.slice(1));
    }
    if (!title) return null;
    const section = parsed.hash ? decodeURIComponent(parsed.hash.slice(1)) : null;
    return { host: parsed.origin, title, section };
  } catch {
    return null;
  }
};

// --- Title sanitization (SettingsModal) ---

export const sanitizeTitle = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

// --- Scale section helpers (SettingsModal) ---

export const loadScaleSections = (stored = [], legacyBreaks = []) => {
  const source =
    Array.isArray(stored) && stored.length > 0
      ? stored
      : Array.isArray(legacyBreaks) && legacyBreaks.length > 0
        ? legacyBreaks.map((b) => ({ ...b, scale: 0 }))
        : [];
  if (source.length === 0) return [];
  return source.map((item) => ({
    start: String(item?.start ?? ""),
    end: String(item?.end ?? ""),
    scale: String(item?.scale ?? "0"),
    showBreak: item?.showBreak !== false,
  }));
};

export const validateScaleSection = (item) => {
  const startRaw = item?.start?.trim() || "";
  const endRaw = item?.end?.trim() || "";
  const scaleRaw = item?.scale?.trim() || "";
  if (!startRaw && !endRaw && !scaleRaw) return null;
  if (!startRaw || !endRaw) return "Both start and end required";

  const parsedStart = parseTimelineInput(startRaw);
  const parsedEnd = parseTimelineInput(endRaw);
  if (!Number.isFinite(parsedStart.value)) return "Invalid start date";
  if (!Number.isFinite(parsedEnd.value)) return "Invalid end date";
  if (parsedStart.value === parsedEnd.value) return "Start and end must differ";

  const scaleNum = Number(scaleRaw);
  if (!Number.isFinite(scaleNum) || scaleNum < 0 || scaleNum > 2) return "Scale must be 0–2";
  return null;
};

// --- Span/element helpers (RightPanel) ---

export const getSpanNumericEnd = (span) => {
  const parsed = parseTimelineInput(span.endLabel ?? span.end);
  return parsed.value ?? span.end;
};

const stripInputs = (data) => {
  const { dateInput: _dateInput, startInput: _startInput, endInput: _endInput, ...rest } = data;
  return rest;
};

const validateEventParents = (draft, timelineData) => {
  const errors = [];

  if (draft.type === "event" && draft.parents && draft.parents.length > 0) {
    const spans = timelineData.elements.filter((el) => el.type === "span");
    const eventDate = parseTimelineInput(draft.dateInput).value;

    if (eventDate === null) {
      errors.push("Event date must be a number or MM/DD/YYYY.");
      return errors;
    }

    draft.parents.forEach((parentId) => {
      const parentSpan = spans.find((span) => span.id === parentId);

      if (!parentSpan) {
        errors.push(`Parent span "${parentId}" not found`);
      } else if (eventDate < parentSpan.start || eventDate > parentSpan.end) {
        errors.push(
          `Event date ${eventDate} is outside parent span "${parentSpan.title}" range (${parentSpan.start}-${parentSpan.end})`
        );
      }
    });
  }

  return errors;
};

export const buildValidatedUpdate = (draft, timelineData) => {
  const errors = validateEventParents(draft, timelineData);
  const parsedDate = parseTimelineInput(draft.dateInput);
  const parsedStart = parseTimelineInput(draft.startInput);
  const parsedEnd = parseTimelineInput(draft.endInput);
  const useMonths = timelineData?.file?.useCalendar === true;
  const timelineStart = timelineData?.file?.start;
  const timelineEnd = timelineData?.file?.end;

  if (draft.type === "event" && parsedDate.value === null) {
    errors.push("Event date must be a number or MM/DD/YYYY.");
  }
  if (draft.type !== "event" && (parsedStart.value === null || parsedEnd.value === null)) {
    errors.push("Start and end must be numbers or MM/DD/YYYY.");
  }
  if (draft.type === "event" && parsedDate.value !== null) {
    if (parsedDate.value < timelineStart || parsedDate.value > timelineEnd) {
      errors.push("Event date must be within the timeline bounds.");
    }
  }
  if (draft.type !== "event" && parsedStart.value !== null && parsedEnd.value !== null) {
    if (parsedStart.value >= parsedEnd.value) {
      errors.push("Start must be before End.");
    }
    if (parsedEnd.value <= timelineStart || parsedStart.value >= timelineEnd) {
      errors.push("Span/Era must overlap with the timeline range.");
    }
  }


  if (draft.type === "span" && draft.extendFrom) {
    const extendParent = timelineData?.elements?.find(
      (el) => el.type === "span" && el.id === draft.extendFrom
    );
    if (!extendParent) {
      errors.push(`Extend From span "${draft.extendFrom}" not found.`);
    } else if (parsedStart.value !== null) {
      const parentEnd = getSpanNumericEnd(extendParent);
      if (!Number.isFinite(parentEnd) || Math.abs(parentEnd - parsedStart.value) >= 1e-6) {
        errors.push("Extend From only works when the selected span ends exactly at this span's start.");
      }
    }
  }

  if (errors.length > 0) {
    return { errors, nextData: null };
  }

  const nextData = stripInputs({ ...draft });
  if (draft.type === "event") {
    nextData.date =
      useMonths && parsedDate.precision !== "day"
        ? snapToMonthGrid(parsedDate.value)
        : parsedDate.value;
    if (parsedDate.label) {
      nextData.dateLabel = parsedDate.label;
    } else {
      delete nextData.dateLabel;
    }
  } else {
    nextData.start =
      useMonths && parsedStart.precision !== "day"
        ? snapToMonthGrid(parsedStart.value)
        : parsedStart.value;
    nextData.end =
      useMonths && parsedEnd.precision !== "day"
        ? snapToMonthGrid(parsedEnd.value)
        : parsedEnd.value;
    if (parsedStart.label) {
      nextData.startLabel = parsedStart.label;
    } else {
      delete nextData.startLabel;
    }
    if (parsedEnd.label) {
      nextData.endLabel = parsedEnd.label;
    } else {
      delete nextData.endLabel;
    }
  }

  if (!nextData.description || !nextData.description.trim()) {
    delete nextData.description;
  } else {
    nextData.description = nextData.description.trim();
  }

  return { errors, nextData };
};
