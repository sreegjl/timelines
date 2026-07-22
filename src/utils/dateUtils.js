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

// dynamic keywords: today, now, yesterday, tomorrow, with optional offset like today-30d / now+2w / today-6m / today-1y
const DATE_KEYWORD_RE = /^(today|now|yesterday|tomorrow)(?:\s*([+-])\s*(\d+)\s*([dwmy]))?$/i;

export const parseDateKeyword = (raw) => {
  const match = DATE_KEYWORD_RE.exec(raw);
  if (!match) return null;
  const [, keyword, sign, amountRaw, unit] = match;
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const kw = keyword.toLowerCase();
  if (kw === "yesterday") date.setDate(date.getDate() - 1);
  if (kw === "tomorrow") date.setDate(date.getDate() + 1);
  if (sign) {
    const amount = Number(amountRaw) * (sign === "-" ? -1 : 1);
    const u = unit.toLowerCase();
    if (u === "d") date.setDate(date.getDate() + amount);
    if (u === "w") date.setDate(date.getDate() + amount * 7);
    if (u === "m" || u === "y") {
      // clamp the day so month/year offsets never roll into the next month
      const day = date.getDate();
      date.setDate(1);
      if (u === "m") date.setMonth(date.getMonth() + amount);
      else date.setFullYear(date.getFullYear() + amount);
      date.setDate(Math.min(day, daysInMonth(date.getFullYear(), date.getMonth() + 1)));
    }
  }
  return dateToFractionalYear(date);
};

// display form for dynamic labels: "Today (07/22/2026)"; non-dynamic labels pass through unchanged
export const displayDateLabel = (label) => {
  if (typeof label !== "string") return label ?? null;
  const value = parseDateKeyword(label);
  if (value === null) return label;
  const { year, month, day } = fractionalYearToDate(value);
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  const pretty = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
  return `${pretty} (${m}/${d}/${year})`;
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
  const keywordValue = parseDateKeyword(raw);
  if (keywordValue !== null) {
    return { value: keywordValue, label: raw.toLowerCase().replace(/\s+/g, ""), precision: "day" };
  }

  if (raw.includes("/")) {
    const parts = raw.split("/");
    if (parts.length !== 2 && parts.length !== 3) return { value: null, label: null, precision: null };
    const [monthRaw, midRaw, yearRaw] = parts.map((part) => part.trim());
    const month = Number(monthRaw);
    const rawYear = Number(parts.length === 2 ? midRaw : yearRaw);
    const year = (Number.isFinite(rawYear) && rawYear >= 0 && rawYear <= 99) ? rawYear + 2000 : rawYear;
    const day = parts.length === 2 ? 1 : Number(midRaw);

    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
      return { value: null, label: null, precision: null };
    }
    if (month < 1 || month > 12) return { value: null, label: null, precision: null };
    const maxDay = daysInMonth(year, month);
    if (day < 1 || day > maxDay) return { value: null, label: null, precision: null };

    const monthBase = (month - 1) / 12;
    const monthDays = daysInMonth(year, month);
    const dayOffset = (day - 1) / (monthDays * 12);
    return {
      value: year + monthBase + dayOffset,
      label: raw,
      precision: parts.length === 2 ? "month" : "day",
    };
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
