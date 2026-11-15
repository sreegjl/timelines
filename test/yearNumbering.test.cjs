const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = (name) => import(pathToFileURL(path.join(__dirname, "..", "src", "utils", name)).href);

test("turning noYearZero on keeps every label and fixes the BCE/CE duration (issue #80)", async () => {
  const { migrateElementYears } = await load("yearNumbering.js");
  const { formatDuration, axisToDisplayYear } = await load("dateUtils.js");
  // typed as -3 and 3 before the setting existed
  const span = migrateElementYears({ type: "span", start: -3, end: 3 }, true);
  assert.strictEqual(axisToDisplayYear(span.start, true), -3);
  assert.strictEqual(axisToDisplayYear(span.end, true), 3);
  assert.strictEqual(formatDuration(span.start, span.end), "5 yrs");
});

test("toggling noYearZero on then off restores everything except year 0", async () => {
  const { migrateElementYears, migrateFileYears } = await load("yearNumbering.js");
  const el = { type: "span", start: -500, end: 20, breaks: [{ year: -250 }] };
  assert.deepStrictEqual(migrateElementYears(migrateElementYears(el, true), false), el);
  const file = { start: -1000, end: 2000, scaleSections: [{ start: -800, end: -400, scale: 0.5 }] };
  assert.deepStrictEqual(migrateFileYears(migrateFileYears(file, true), false), file);
  // year 0 folds into 1 BCE, which reads back as -1
  assert.strictEqual(migrateElementYears(migrateElementYears({ type: "event", date: 0 }, true), false).date, -1);
});

test("a moved value drops its calendar label, an unmoved one keeps it", async () => {
  const { migrateElementYears } = await load("yearNumbering.js");
  const moved = migrateElementYears({ type: "event", date: 0.25, dateLabel: "0000-04" }, false);
  assert.strictEqual(moved.date, -0.75);
  assert.ok(!("dateLabel" in moved));
  const kept = migrateElementYears({ type: "event", date: 2020.25, dateLabel: "2020-04" }, false);
  assert.strictEqual(kept.dateLabel, "2020-04");
});
