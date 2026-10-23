import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { fractionalYearToDate, todayFractionalYear, formatTimeOfDay, isValidTimeOfDay } from "../utils/dateUtils";
import {
  getCalendarNames,
  buildMonthGrid,
  dayNumber,
  elementDayRange,
  layoutWeekBars,
  shiftMonth,
  toFractionalYear,
} from "../utils/calendarUtils";
import { withAlpha } from "../utils/colorUtils";
import { ICON_MAP } from "../config/elementIcons";
import { getReadableTextColor } from "../utils/timelineUtils";

const MAX_EVENTS_PER_DAY = 3;
const BAR_HEIGHT = 18;
const DAY_HEADER_HEIGHT = 24;

const formatYearLabel = (year, negID, posID) => {
  if (year < 0) return `${Math.abs(year)} ${negID || "BCE"}`;
  return posID ? `${year} ${posID}` : String(year);
};

function MiniMonth({ year, month, monthName, dayCounts, todayN, onPickMonth }) {
  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);
  return (
    <button type="button" className="cal-mini" onClick={() => onPickMonth(year, month)}>
      <span className="cal-mini-title">{monthName}</span>
      <span className="cal-mini-grid">
        {weeks.flatMap((week) => week.days).map((day) => {
          const count = day.inMonth ? dayCounts.get(day.n) || 0 : 0;
          return (
            <span
              key={day.n}
              className={`cal-mini-day${day.inMonth ? "" : " is-outside"}${count ? " has-items" : ""}${day.n === todayN ? " is-today" : ""}`}
              style={count ? { "--cal-heat": Math.min(1, 0.25 + count * 0.2) } : undefined}
            >
              {day.inMonth ? day.day : ""}
            </span>
          );
        })}
      </span>
    </button>
  );
}

// month grid + year overview for timelines that live on real dates. dates are hard, calendars are cute
export default function CalendarView({ timelineData, selectedId, onSelect, onAddEvent, focusYear, readOnly = false, leftInset = 0, rightInset = 0, viewSwitcher = null }) {
  const { t, i18n } = useTranslation("timeline");
  const names = useMemo(() => getCalendarNames(i18n.language || "en"), [i18n.language]);
  const untitled = t("untitledElement", "(untitled)");
  const file = timelineData?.file;
  const elements = timelineData?.elements;
  const groupsHidden = useMemo(
    () => new Set((file?.groups ?? []).filter((g) => g.visible === false).map((g) => g.id)),
    [file?.groups]
  );

  const ranged = useMemo(() => {
    const spanById = new Map((elements ?? []).filter((el) => el.type === "span").map((el) => [el.id, el]));
    return (elements ?? [])
      .filter((el) => (el.type === "event" || el.type === "span" || el.type === "era") && !(el.groupId && groupsHidden.has(el.groupId)))
      .map((el) => {
        const range = elementDayRange(el);
        if (!range) return null;
        const parentColor = el.type === "event" ? spanById.get(el.parents?.[0])?.color : null;
        return { el, range, color: el.color || parentColor || (el.type === "era" ? "#F4D05A" : "var(--ui-muted)") };
      })
      .filter(Boolean);
  }, [elements, groupsHidden]);

  const todayFraction = todayFractionalYear();
  const todayDate = fractionalYearToDate(todayFraction);
  const todayN = dayNumber(todayDate.year, todayDate.month, todayDate.day);

  const initialCursor = () => {
    const selected = ranged.find((item) => item.el.id === selectedId);
    // selected thing first, then wherever the timeline was looking, then the earliest dated thing
    const earliest = ranged.reduce((min, item) => Math.min(min, item.el.date ?? item.el.start ?? Infinity), Infinity);
    const anchor = selected
      ? selected.el.date ?? selected.el.start
      : Number.isFinite(focusYear) ? focusYear : Number.isFinite(earliest) ? earliest : file?.start;
    const d = fractionalYearToDate(Number.isFinite(anchor) ? anchor : todayFraction);
    return { year: d.year, month: d.month };
  };
  const [cursor, setCursor] = useState(initialCursor);
  const [mode, setMode] = useState("month");
  const lastSelectedRef = useRef(selectedId);

  // selecting something from the sidebar flips to its month, as long as it isn't already on screen
  useEffect(() => {
    if (!selectedId || selectedId === lastSelectedRef.current) return;
    lastSelectedRef.current = selectedId;
    const selected = ranged.find((item) => item.el.id === selectedId);
    if (!selected) return;
    const weeks = buildMonthGrid(cursor.year, cursor.month);
    const visibleStart = weeks[0].start;
    const visibleEnd = weeks[weeks.length - 1].end;
    if (mode === "month" && selected.range.start <= visibleEnd && selected.range.end >= visibleStart) return;
    const d = fractionalYearToDate(selected.el.date ?? selected.el.start);
    setCursor({ year: d.year, month: d.month });
    setMode("month");
  }, [selectedId, ranged]); // eslint-disable-line react-hooks/exhaustive-deps

  const weeks = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor.year, cursor.month]);

  const monthData = useMemo(() => {
    const multiDay = ranged.filter((item) => item.range.end > item.range.start);
    const singles = new Map();
    for (const item of ranged) {
      if (item.range.end > item.range.start) continue;
      const list = singles.get(item.range.start) || [];
      list.push(item);
      singles.set(item.range.start, list);
    }
    for (const list of singles.values()) {
      list.sort((a, b) => (a.el.date ?? 0) - (b.el.date ?? 0) || String(a.el.time ?? "").localeCompare(String(b.el.time ?? "")));
    }
    return weeks.map((week) => ({
      ...week,
      ...layoutWeekBars(multiDay.sort((a, b) => (a.el.type === "era" ? -1 : 0) - (b.el.type === "era" ? -1 : 0)), week.start, week.end),
      singles,
    }));
  }, [weeks, ranged]);

  const yearCounts = useMemo(() => {
    const counts = new Map();
    if (mode !== "year") return counts;
    const yearStart = dayNumber(cursor.year, 1, 1);
    const yearEnd = dayNumber(cursor.year, 12, 31);
    for (const item of ranged) {
      if (item.el.type === "era") continue;
      const from = Math.max(item.range.start, yearStart);
      const to = Math.min(item.range.end, yearEnd);
      for (let n = from; n <= to && n - from < 400; n++) counts.set(n, (counts.get(n) || 0) + 1);
    }
    return counts;
  }, [mode, cursor.year, ranged]);

  const step = (delta) => {
    setCursor((prev) => (mode === "year" ? { ...prev, year: prev.year + delta } : shiftMonth(prev.year, prev.month, delta)));
  };

  const inRange = (fraction) => !file || (fraction >= file.start && fraction <= file.end);

  const handleDayDoubleClick = (day) => {
    if (readOnly || !onAddEvent) return;
    const fraction = toFractionalYear(day.year, day.month, day.day);
    if (!inRange(fraction)) return;
    onAddEvent(undefined, fraction);
  };

  const title = mode === "year"
    ? formatYearLabel(cursor.year, file?.negID, file?.posID)
    : `${names.months[cursor.month - 1]} ${formatYearLabel(cursor.year, file?.negID, file?.posID)}`;

  const renderChip = (item) => {
    const { el } = item;
    const Icon = el.icon ? ICON_MAP[el.icon] : null;
    const time = isValidTimeOfDay(el.time) ? formatTimeOfDay(el.time) : null;
    return (
      <button
        key={el.id}
        type="button"
        className={`cal-chip${selectedId === el.id ? " is-selected" : ""}`}
        style={{ "--cal-color": item.color }}
        title={el.title}
        onClick={(e) => { e.stopPropagation(); onSelect?.(el.id); }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <span className="cal-chip-dot" />
        {Icon && <Icon size={10} className="cal-chip-icon" />}
        {time && <span className="cal-chip-time">{time}</span>}
        <span className="cal-chip-title">{el.title || untitled}</span>
      </button>
    );
  };

  return (
    <div className="calendar-view" style={{ paddingLeft: `${leftInset}px`, paddingRight: `${rightInset}px` }}>
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="cal-nav-button" onClick={() => step(-1)} aria-label={mode === "year" ? t("calendar.previousYear", "Previous year") : t("calendar.previousMonth", "Previous month")}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="cal-nav-button" onClick={() => step(1)} aria-label={mode === "year" ? t("calendar.nextYear", "Next year") : t("calendar.nextMonth", "Next month")}>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className="cal-title"
            onClick={() => setMode((m) => (m === "month" ? "year" : "month"))}
            title={mode === "month" ? t("calendar.showYear", "Show the whole year") : t("calendar.backToMonth", "Back to the month")}
          >
            {title}
          </button>
        </div>
        {viewSwitcher && <div className="cal-switcher">{viewSwitcher}</div>}
        <div className="cal-actions">
          {inRange(todayFraction) && (
            <button
              type="button"
              className="cal-pill"
              onClick={() => setCursor({ year: todayDate.year, month: todayDate.month })}
            >
              {t("calendar.today", "Today")}
            </button>
          )}
          <div className="cal-segment" role="group" aria-label={t("calendar.range", "Calendar range")}>
            <button type="button" className={mode === "month" ? "is-active" : ""} onClick={() => setMode("month")}>{t("calendar.month", "Month")}</button>
            <button type="button" className={mode === "year" ? "is-active" : ""} onClick={() => setMode("year")}>{t("calendar.year", "Year")}</button>
          </div>
        </div>
      </div>

      {mode === "year" ? (
        <div className="cal-year">
          {names.months.map((monthName, index) => (
            <MiniMonth
              key={index}
              year={cursor.year}
              month={index + 1}
              monthName={monthName}
              dayCounts={yearCounts}
              todayN={todayN}
              onPickMonth={(year, month) => { setCursor({ year, month }); setMode("month"); }}
            />
          ))}
        </div>
      ) : (
        <div className="cal-month">
          <div className="cal-weekdays">
            {names.weekdays.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="cal-weeks">
            {monthData.map((week) => {
              const barsHeight = week.laneCount * BAR_HEIGHT;
              return (
                <div key={week.start} className="cal-week" style={{ "--cal-bars": `${barsHeight}px` }}>
                  {week.days.map((day) => {
                    const items = week.singles.get(day.n) || [];
                    const fraction = toFractionalYear(day.year, day.month, day.day);
                    const outOfRange = !inRange(fraction);
                    return (
                      <div
                        key={day.n}
                        className={`cal-day${day.inMonth ? "" : " is-outside"}${day.n === todayN ? " is-today" : ""}${outOfRange ? " is-out-of-range" : ""}`}
                        onDoubleClick={() => handleDayDoubleClick(day)}
                        title={!readOnly && onAddEvent && !outOfRange ? t("calendar.addHint", "Double-click to add an event") : undefined}
                      >
                        <span className="cal-day-number">{day.day === 1 ? `${names.monthsShort[day.month - 1]} 1` : day.day}</span>
                        <div className="cal-day-items" style={{ marginTop: `${barsHeight}px` }}>
                          {items.slice(0, MAX_EVENTS_PER_DAY).map(renderChip)}
                          {items.length > MAX_EVENTS_PER_DAY && (
                            <button
                              type="button"
                              className="cal-more"
                              onClick={(e) => { e.stopPropagation(); onSelect?.(items[MAX_EVENTS_PER_DAY].el.id); }}
                              title={items.slice(MAX_EVENTS_PER_DAY).map((item) => item.el.title).join("\n")}
                            >
                              {t("calendar.more", "+{{n}} more", { n: items.length - MAX_EVENTS_PER_DAY })}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {week.bars.map((bar) => {
                    const { el } = bar.item;
                    const isEra = el.type === "era";
                    return (
                      <button
                        key={el.id}
                        type="button"
                        className={`cal-bar${isEra ? " is-era" : ""}${selectedId === el.id ? " is-selected" : ""}${bar.continuesBefore ? " continues-before" : ""}${bar.continuesAfter ? " continues-after" : ""}`}
                        style={{
                          left: `calc(${(bar.from / 7) * 100}% + 3px)`,
                          width: `calc(${((bar.to - bar.from + 1) / 7) * 100}% - 6px)`,
                          top: `${DAY_HEADER_HEIGHT + bar.lane * BAR_HEIGHT}px`,
                          "--cal-color": bar.item.color,
                          "--cal-fill": isEra ? withAlpha(bar.item.color, 0.3) : bar.item.color,
                          "--cal-text": isEra ? "var(--text-primary)" : getReadableTextColor(bar.item.color),
                        }}
                        title={el.title}
                        onClick={(e) => { e.stopPropagation(); onSelect?.(el.id); }}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <span className="cal-bar-title">{el.title || untitled}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ranged.length === 0 && (
        <div className="cal-empty">
          <CalendarDays size={16} />
          <span>{t("calendar.empty", "Nothing dated yet. Double-click a day to add an event.")}</span>
        </div>
      )}
    </div>
  );
}
