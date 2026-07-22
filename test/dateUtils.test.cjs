const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const load = () => import(pathToFileUrl(path.join(__dirname, "..", "src", "utils", "dateUtils.js")));
const pathToFileUrl = (p) => require("node:url").pathToFileURL(p).href;

test("parseTimelineInput resolves 'today' to the current date and keeps the label", async () => {
  const { parseTimelineInput, todayFractionalYear, fractionalYearToDate } = await load();
  const parsed = parseTimelineInput("Today");
  assert.strictEqual(parsed.label, "today");
  assert.strictEqual(parsed.precision, "day");
  assert.strictEqual(parsed.value, todayFractionalYear());

  const now = new Date();
  const { year, month, day } = fractionalYearToDate(parsed.value);
  assert.strictEqual(year, now.getFullYear());
  assert.strictEqual(month, now.getMonth() + 1);
  assert.strictEqual(day, now.getDate());
});

test("parseTimelineInput supports keyword aliases and date-math offsets", async () => {
  const { parseTimelineInput, todayFractionalYear, fractionalYearToDate } = await load();
  const today = todayFractionalYear();

  assert.strictEqual(parseTimelineInput("now").value, today);
  assert.strictEqual(parseTimelineInput("NOW").label, "now");

  const atNoon = (offsetDays) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d;
  };
  const expectDay = (parsed, expected) => {
    const { year, month, day } = fractionalYearToDate(parsed.value);
    assert.strictEqual(year, expected.getFullYear());
    assert.strictEqual(month, expected.getMonth() + 1);
    assert.strictEqual(day, expected.getDate());
  };

  expectDay(parseTimelineInput("yesterday"), atNoon(-1));
  expectDay(parseTimelineInput("tomorrow"), atNoon(1));
  expectDay(parseTimelineInput("today-30d"), atNoon(-30));
  expectDay(parseTimelineInput("now + 2w"), atNoon(14));

  const parsedOffset = parseTimelineInput("Today - 30 d");
  assert.strictEqual(parsedOffset.label, "today-30d");
  assert.strictEqual(parsedOffset.precision, "day");

  const yearAgo = fractionalYearToDate(parseTimelineInput("today-1y").value);
  const now = new Date();
  assert.strictEqual(yearAgo.year, now.getFullYear() - 1);
  assert.strictEqual(yearAgo.month, now.getMonth() + 1);

  const monthsAgo = parseTimelineInput("today-6m");
  assert.ok(Number.isFinite(monthsAgo.value));
  assert.ok(monthsAgo.value < today);
});

test("displayDateLabel expands dynamic labels and passes others through", async () => {
  const { displayDateLabel } = await load();
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  assert.strictEqual(displayDateLabel("today"), `Today (${mm}/${dd}/${now.getFullYear()})`);
  assert.ok(displayDateLabel("today-1y").startsWith("Today-1y ("));
  assert.strictEqual(displayDateLabel("7/4/1776"), "7/4/1776");
  assert.strictEqual(displayDateLabel(null), null);
  assert.strictEqual(displayDateLabel(undefined), null);
});

test("parseTimelineInput still parses plain and calendar dates", async () => {
  const { parseTimelineInput } = await load();
  assert.strictEqual(parseTimelineInput("1990").value, 1990);
  assert.strictEqual(parseTimelineInput("7/1/2020").value, 2020.5);
  assert.strictEqual(parseTimelineInput("someday").value, null);
});
