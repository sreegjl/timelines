import { daysInMonth, fractionalYearToDate } from "./dateUtils.js";

// english fallback when Intl is having a day off
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// month and weekday names in the ui language, so translators never have to type "february" again
const namesCache = new Map();
export function getCalendarNames(locale = "en") {
  if (namesCache.has(locale)) return namesCache.get(locale);
  let names;
  try {
    const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
    const monthShort = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    names = {
      months: Array.from({ length: 12 }, (_, m) => month.format(Date.UTC(2021, m, 1))),
      monthsShort: Array.from({ length: 12 }, (_, m) => monthShort.format(Date.UTC(2021, m, 1))),
      // 2021-03-01 was a monday, the week starts there
      weekdays: Array.from({ length: 7 }, (_, d) => weekday.format(Date.UTC(2021, 2, 1 + d))),
    };
  } catch {
    names = { months: MONTH_NAMES, monthsShort: MONTH_NAMES.map((m) => m.slice(0, 3)), weekdays: WEEKDAY_LABELS };
  }
  namesCache.set(locale, names);
  return names;
}

// proleptic gregorian day number, so year -300 gets a calendar too (the Date object gets weird there)
export function dayNumber(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// 0 = monday ... 6 = sunday. day 0 (1970-01-01) was a thursday, fun fact nobody asked for
export function weekdayIndex(year, month, day) {
  return (((dayNumber(year, month, day) + 3) % 7) + 7) % 7;
}

export function fromDayNumber(n) {
  const z = n + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

// same day grid parseTimelineInput uses, so a double-click lands exactly where a typed date would
export function toFractionalYear(year, month, day) {
  return year + (month - 1) / 12 + (day - 1) / (daysInMonth(year, month) * 12);
}

export function elementDayRange(el) {
  if (el?.type === "event") {
    if (!Number.isFinite(el.date)) return null;
    const d = fractionalYearToDate(el.date);
    const n = dayNumber(d.year, d.month, d.day);
    return { start: n, end: n };
  }
  if (!Number.isFinite(el?.start) || !Number.isFinite(el?.end)) return null;
  const s = fractionalYearToDate(el.start);
  const e = fractionalYearToDate(el.end);
  const start = dayNumber(s.year, s.month, s.day);
  const end = Math.max(start, dayNumber(e.year, e.month, e.day));
  return { start, end };
}

// six rows of seven days, padded with the neighbours so the grid never looks like it lost a tooth
export function buildMonthGrid(year, month) {
  const first = dayNumber(year, month, 1);
  const gridStart = first - weekdayIndex(year, month, 1);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const n = gridStart + w * 7 + d;
      const date = fromDayNumber(n);
      days.push({ n, ...date, inMonth: date.month === month && date.year === year });
    }
    weeks.push({ start: gridStart + w * 7, end: gridStart + w * 7 + 6, days });
  }
  return weeks;
}

// greedy lanes for multi-day bars inside one week row. first come first served, like brunch
export function layoutWeekBars(ranged, weekStart, weekEnd) {
  const bars = ranged
    .filter((item) => item.range.start <= weekEnd && item.range.end >= weekStart && item.range.end > item.range.start)
    .map((item) => ({
      item,
      from: Math.max(item.range.start, weekStart) - weekStart,
      to: Math.min(item.range.end, weekEnd) - weekStart,
      continuesBefore: item.range.start < weekStart,
      continuesAfter: item.range.end > weekEnd,
    }))
    .sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
  const laneEnds = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end < bar.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = bar.to;
    bar.lane = lane;
  }
  return { bars, laneCount: laneEnds.length };
}

export function shiftMonth(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  return { year: y, month: total - y * 12 + 1 };
}
