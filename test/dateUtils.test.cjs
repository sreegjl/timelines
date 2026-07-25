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

test("parseTimelineInput resolves current / current-month / current-year at the right precision", async () => {
  const { parseTimelineInput, todayFractionalYear } = await load();
  const now = new Date();

  const current = parseTimelineInput("Current");
  assert.strictEqual(current.label, "current");
  assert.strictEqual(current.precision, "day");
  assert.strictEqual(current.value, todayFractionalYear());

  const month = parseTimelineInput("current-month");
  assert.strictEqual(month.label, "current-month");
  assert.strictEqual(month.precision, "month");
  assert.strictEqual(month.value, now.getFullYear() + now.getMonth() / 12);

  const year = parseTimelineInput("current-year");
  assert.strictEqual(year.label, "current-year");
  assert.strictEqual(year.precision, "year");
  assert.strictEqual(year.value, now.getFullYear());

  // today / now stay as day-precision aliases for backward compatibility
  assert.strictEqual(parseTimelineInput("today").value, todayFractionalYear());
  assert.strictEqual(parseTimelineInput("now").precision, "day");

  // offsets and yesterday/tomorrow are no longer keywords
  assert.strictEqual(parseTimelineInput("today-30d").value, null);
  assert.strictEqual(parseTimelineInput("yesterday").value, null);
});

test("displayDateLabel expands dynamic labels by precision and passes others through", async () => {
  const { displayDateLabel } = await load();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  assert.strictEqual(displayDateLabel("current"), `Today (${mm}/${dd}/${yyyy})`);
  assert.strictEqual(displayDateLabel("current-month"), `This month (${mm}/${yyyy})`);
  assert.strictEqual(displayDateLabel("current-year"), `This year (${yyyy})`);
  assert.strictEqual(displayDateLabel("today"), `Today (${mm}/${dd}/${yyyy})`);
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
