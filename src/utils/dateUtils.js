export const daysInMonth = (year, month) => {
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return monthDays[month - 1] || 0;
};

const precisionFromValue = (value) => {
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return "year";
  const scaled = value * 12;
  const isMonthGrid = Math.abs(scaled - Math.round(scaled)) < 1e-6;
  return isMonthGrid ? "month" : "day";
};

const dateToFractionalYear = (date) => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return year + (month - 1) / 12 + (day - 1) / (daysInMonth(year, month) * 12);
};

// current date as a fractional year on the same day grid as parseTimelineInput
export const todayFractionalYear = () => dateToFractionalYear(new Date());

// Format is a display + input lens only; stored labels stay canonical ISO.
let activeDateFormat = "MDY"; // "MDY" | "DMY" | "ISO"
export const setActiveDateFormat = (fmt) => {
  activeDateFormat = fmt === "DMY" || fmt === "ISO" ? fmt : "MDY";
};
export const getActiveDateFormat = () => activeDateFormat;

const pad2 = (n) => String(n).padStart(2, "0");
const pad4 = (n) => (Number.isFinite(n) && n >= 0 && n < 1000 ? String(n).padStart(4, "0") : `${n}`);
// "1/1/24" is 2024 shorthand, but a written-out "0024" stays year 24.
const normalizeYear = (raw) => {
  const y = Number(raw);
  if (!Number.isFinite(y)) return NaN;
  return String(raw).trim().length <= 2 && y >= 0 && y <= 99 ? y + 2000 : y;
};

// Canonical ISO stored label; year precision needs no label.
const canonicalDateLabel = (year, month, day, precision) => {
  if (precision === "year") return null;
  if (precision === "month") return `${pad4(year)}-${pad2(month)}`;
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
};

export const formatCalendarDate = (year, month, day, precision, fmt = activeDateFormat) => {
  if (precision === "year") return `${year}`;
  if (precision === "month") return fmt === "ISO" ? `${pad4(year)}-${pad2(month)}` : `${pad2(month)}/${pad4(year)}`;
  if (fmt === "ISO") return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
  if (fmt === "DMY") return `${pad2(day)}/${pad2(month)}/${pad4(year)}`;
  return `${pad2(month)}/${pad2(day)}/${pad4(year)}`;
};

const buildCalendarDate = (year, month, day, precision) => {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  return {
    value: year + (month - 1) / 12 + (day - 1) / (maxDay * 12),
    precision,
    label: canonicalDateLabel(year, month, day, precision),
    year,
    month,
    day,
  };
};

// ISO (dash) is auto-detected regardless of format; slash order follows the format.
const parseCalendarDate = (raw, fmt = activeDateFormat) => {
  const iso = /^(\d{1,4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(raw);
  if (iso) {
    const hasDay = iso[3] !== undefined;
    return buildCalendarDate(Number(iso[1]), Number(iso[2]), hasDay ? Number(iso[3]) : 1, hasDay ? "day" : "month");
  }
  if (raw.includes("/")) {
    const parts = raw.split("/").map((p) => p.trim());
    if (parts.length === 2) {
      return buildCalendarDate(normalizeYear(parts[1]), Number(parts[0]), 1, "month");
    }
    if (parts.length === 3) {
      const [a, b, c] = parts;
      return fmt === "DMY"
        ? buildCalendarDate(normalizeYear(c), Number(b), Number(a), "day")
        : buildCalendarDate(normalizeYear(c), Number(a), Number(b), "day");
    }
  }
  return null;
};

const DATE_KEYWORD_RE = /^(current|current-month|current-year|today|now)$/i;

export const parseDateKeyword = (raw) => {
  if (typeof raw !== "string" || !DATE_KEYWORD_RE.test(raw.trim())) return null;
  const kw = raw.trim().toLowerCase();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (kw === "current-year") return { value: year, precision: "year" };
  if (kw === "current-month") return { value: year + (month - 1) / 12, precision: "month" };
  return {
    value: year + (month - 1) / 12 + (day - 1) / (daysInMonth(year, month) * 12),
    precision: "day",
  };
};

const DYNAMIC_LABEL_NAMES = {
  current: "Today",
  today: "Today",
  now: "Today",
  "current-month": "This month",
  "current-year": "This year",
};

// Read-only display: keywords -> "This year (2026)", fixed dates -> active format.
export const displayDateLabel = (label) => {
  if (typeof label !== "string") return label ?? null;
  const kw = parseDateKeyword(label);
  if (kw !== null) {
    const { year, month, day } = fractionalYearToDate(kw.value);
    const resolved = formatCalendarDate(year, month, day, kw.precision);
    return `${DYNAMIC_LABEL_NAMES[label.trim().toLowerCase()] || "Today"} (${resolved})`;
  }
  const cal = parseCalendarDate(label);
  if (cal) return formatCalendarDate(cal.year, cal.month, cal.day, cal.precision);
  return label;
};

// Editable-field form: keywords stay literal so they can be re-typed.
export const formatDateForInput = (label) => {
  if (typeof label !== "string" || !label.trim()) return "";
  if (parseDateKeyword(label) !== null) return label.trim().toLowerCase();
  const cal = parseCalendarDate(label);
  if (cal) return formatCalendarDate(cal.year, cal.month, cal.day, cal.precision);
  return label;
};

// Legacy slash labels were always MM/DD/YYYY; upgrade to ISO regardless of active format.
export const normalizeLegacyDateLabel = (label) => {
  if (typeof label !== "string" || !label.includes("/")) return label;
  const cal = parseCalendarDate(label, "MDY");
  return cal ? cal.label : label;
};

export const parseTimelineInput = (value) => {
  if (value === null || value === undefined) {
    return { value: null, label: null, precision: null };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value, label: null, precision: precisionFromValue(value) };
  }

  const raw = String(value).trim();
  if (!raw) return { value: null, label: null, precision: null };

  // dynamic keywords stay labels so they re-resolve to the current date on every load
  const keyword = parseDateKeyword(raw);
  if (keyword !== null) {
    return { value: keyword.value, label: raw.trim().toLowerCase(), precision: keyword.precision };
  }

  const cal = parseCalendarDate(raw);
  if (cal) {
    return { value: cal.value, label: cal.label, precision: cal.precision };
  }

  const num = Number(raw);
  return Number.isFinite(num)
    ? { value: num, label: null, precision: precisionFromValue(num) }
    : { value: null, label: null, precision: null };
};

export const snapToMonthGrid = (value) => {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 12) / 12;
};

export const fractionalYearToDate = (value) => {
  const yearInt = Math.floor(value);
  const fraction = Math.max(0, value - yearInt);
  const monthIndex = Math.min(11, Math.floor(fraction * 12 + 1e-9));
  const month = monthIndex + 1;
  const monthFraction = Math.max(0, fraction * 12 - monthIndex);
  const days = daysInMonth(yearInt, month);
  const day = Math.min(days, Math.max(1, Math.floor(monthFraction * days + 1e-9) + 1));
  return { year: yearInt, month, day };
};

const plural = (n, unit) => `${n.toLocaleString()} ${unit}${n === 1 ? "" : "s"}`;

// Proleptic Gregorian day number, valid for negative years unlike the Date object
const daysFromCivil = (year, month, day) => {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};

// Advance a date by whole months, clamping to the target month's length
const addMonths = (date, count) => {
  const total = date.year * 12 + (date.month - 1) + count;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
};

// A custom unit is written verbatim, since "Ma" and "kyr" have no sensible plural
const withUnit = (n, unit) => (unit ? `${n.toLocaleString()} ${unit}` : plural(n, "yr"));

// How long a span or era lasts, e.g. "4 yrs, 4 mos, 26 days", "1,550 yrs", or "2.3 Ma"
export const formatDuration = (start, end, useCalendar = false, hideDecimals = false, unit = "") => {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const gap = end - start;
  if (gap < 0) return null;
  const unitLabel = typeof unit === "string" ? unit.trim() : "";

  if (!useCalendar) {
    // Year-only timelines have no meaningful months or days to break out
    const years = hideDecimals ? Math.round(gap) : Math.round(gap * 100) / 100;
    return withUnit(years, unitLabel);
  }

  const from = fractionalYearToDate(start);
  const to = fractionalYearToDate(end);
  // Count whole months first, then the leftover days, so month lengths never skew the result
  let months = (to.year - from.year) * 12 + (to.month - from.month);
  if (to.day < from.day) months -= 1;
  if (months < 0) months = 0;
  const anchor = addMonths(from, months);
  const days = daysFromCivil(to.year, to.month, to.day) - daysFromCivil(anchor.year, anchor.month, anchor.day);

  const parts = [];
  const years = Math.floor(months / 12);
  if (years) parts.push(withUnit(years, unitLabel));
  if (months - years * 12) parts.push(plural(months - years * 12, "mo"));
  if (days) parts.push(plural(days, "day"));
  return parts.length ? parts.join(", ") : "0 days";
};

export const snapToDayGrid = (value) => {
  if (!Number.isFinite(value)) return value;
  const yearInt = Math.floor(value);
  const fraction = Math.max(0, value - yearInt);
  const monthIndex = Math.min(11, Math.floor(fraction * 12 + 1e-9));
  const month = monthIndex + 1;
  const monthFraction = Math.max(0, fraction * 12 - monthIndex);
  const days = daysInMonth(yearInt, month);
  const day = Math.min(days, Math.max(1, Math.round(monthFraction * days + 0.5 - 1e-9) + 1));
  return yearInt + (month - 1) / 12 + (day - 1) / (days * 12);
};
