const test = require("node:test");
const assert = require("node:assert");

const load = () => import("../src/utils/calendarUtils.js");

test("day numbers round-trip and weekdays match reality", async () => {
  const { dayNumber, fromDayNumber, weekdayIndex } = await load();
  assert.strictEqual(dayNumber(1970, 1, 1), 0);
  assert.deepStrictEqual(fromDayNumber(dayNumber(2024, 2, 29)), { year: 2024, month: 2, day: 29 });
  assert.deepStrictEqual(fromDayNumber(dayNumber(-44, 3, 15)), { year: -44, month: 3, day: 15 });
  assert.strictEqual(weekdayIndex(2026, 9, 30), 2); // a wednesday
  assert.strictEqual(weekdayIndex(1969, 7, 20), 6); // moon landing, a sunday
});

test("month grid starts on monday and covers the whole month", async () => {
  const { buildMonthGrid } = await load();
  const weeks = buildMonthGrid(2026, 9);
  assert.strictEqual(weeks.length, 6);
  assert.deepStrictEqual([weeks[0].days[0].month, weeks[0].days[0].day], [8, 31]);
  assert.strictEqual(weeks.flatMap((w) => w.days).filter((d) => d.inMonth).length, 30);
});

test("element ranges and week bars", async () => {
  const { elementDayRange, toFractionalYear, dayNumber, layoutWeekBars } = await load();
  const ev = elementDayRange({ type: "event", date: toFractionalYear(1990, 4, 19) });
  assert.strictEqual(ev.start, dayNumber(1990, 4, 19));
  const span = elementDayRange({ type: "span", start: toFractionalYear(1990, 4, 17), end: toFractionalYear(1990, 4, 25) });
  assert.strictEqual(span.end - span.start, 8);
  const weekStart = dayNumber(1990, 4, 16);
  const { bars, laneCount } = layoutWeekBars([
    { id: "a", range: span },
    { id: "b", range: { start: weekStart, end: weekStart + 1 } },
    { id: "c", range: { start: weekStart + 2, end: weekStart + 3 } },
  ], weekStart, weekStart + 6);
  assert.strictEqual(laneCount, 2);
  assert.ok(bars.find((b) => b.item.id === "a").continuesAfter);
  assert.strictEqual(elementDayRange({ type: "event" }), null);
});
