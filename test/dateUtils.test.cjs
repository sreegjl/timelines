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

test("displayDateLabel expands dynamic labels by precision (default MDY)", async () => {
  const { displayDateLabel, setActiveDateFormat } = await load();
  setActiveDateFormat("MDY");
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  assert.strictEqual(displayDateLabel("current"), `Today (${mm}/${dd}/${yyyy})`);
  assert.strictEqual(displayDateLabel("current-month"), `This month (${mm}/${yyyy})`);
  assert.strictEqual(displayDateLabel("current-year"), `This year (${yyyy})`);
  assert.strictEqual(displayDateLabel("today"), `Today (${mm}/${dd}/${yyyy})`);
  assert.strictEqual(displayDateLabel(null), null);
  assert.strictEqual(displayDateLabel(undefined), null);
});

test("parseTimelineInput stores canonical ISO labels and respects the active format order", async () => {
  const { parseTimelineInput, setActiveDateFormat } = await load();

  setActiveDateFormat("MDY");
  const mdy = parseTimelineInput("3/4/2020");
  assert.strictEqual(mdy.value, 2020 + 2 / 12 + 3 / (31 * 12)); // March 4
  assert.strictEqual(mdy.label, "2020-03-04");
  assert.strictEqual(mdy.precision, "day");

  setActiveDateFormat("DMY");
  const dmy = parseTimelineInput("3/4/2020"); // day 3, month 4 => April 3
  assert.strictEqual(dmy.label, "2020-04-03");

  // ISO input is auto-detected regardless of the active format
  const iso = parseTimelineInput("2020-03-04");
  assert.strictEqual(iso.label, "2020-03-04");
  assert.strictEqual(iso.precision, "day");

  setActiveDateFormat("MDY");
});

test("format is a display lens: canonical labels render per active format, value unchanged", async () => {
  const { displayDateLabel, formatDateForInput, setActiveDateFormat } = await load();
  const iso = "2020-03-04";

  setActiveDateFormat("MDY");
  assert.strictEqual(displayDateLabel(iso), "03/04/2020");
  assert.strictEqual(formatDateForInput(iso), "03/04/2020");

  setActiveDateFormat("DMY");
  assert.strictEqual(displayDateLabel(iso), "04/03/2020");

  setActiveDateFormat("ISO");
  assert.strictEqual(displayDateLabel(iso), "2020-03-04");
  assert.strictEqual(formatDateForInput("current"), "current"); // keywords stay literal

  setActiveDateFormat("MDY");
});

test("normalizeLegacyDateLabel upgrades old MM/DD/YYYY labels to ISO, leaves the rest", async () => {
  const { normalizeLegacyDateLabel, setActiveDateFormat } = await load();
  // Always parses slash labels as MDY, independent of the active format.
  setActiveDateFormat("DMY");
  assert.strictEqual(normalizeLegacyDateLabel("03/04/2020"), "2020-03-04"); // March 4, not April 3
  assert.strictEqual(normalizeLegacyDateLabel("07/2020"), "2020-07");
  // ISO, keywords, and non-dates pass through untouched.
  assert.strictEqual(normalizeLegacyDateLabel("2020-03-04"), "2020-03-04");
  assert.strictEqual(normalizeLegacyDateLabel("current"), "current");
  assert.strictEqual(normalizeLegacyDateLabel(undefined), undefined);
  setActiveDateFormat("MDY");
});

test("parseTimelineInput still parses plain and calendar dates", async () => {
  const { parseTimelineInput } = await load();
  assert.strictEqual(parseTimelineInput("1990").value, 1990);
  assert.strictEqual(parseTimelineInput("7/1/2020").value, 2020.5);
  assert.strictEqual(parseTimelineInput("someday").value, null);
});

test("written-out years under 1000 stay literal; only 1-2 digit years are 2000s shorthand", async () => {
  const { parseTimelineInput, setActiveDateFormat } = await load();
  setActiveDateFormat("MDY");

  assert.strictEqual(parseTimelineInput("1/1/0004").label, "0004-01-01");
  assert.strictEqual(parseTimelineInput("1/1/004").label, "0004-01-01");
  assert.strictEqual(parseTimelineInput("1/1/1004").label, "1004-01-01");
  assert.strictEqual(parseTimelineInput("01/0004").label, "0004-01");
  assert.strictEqual(parseTimelineInput("0004-01-01").label, "0004-01-01");
  assert.strictEqual(parseTimelineInput("4-1-1").label, "0004-01-01");
  assert.strictEqual(parseTimelineInput("0004").value, 4);
  assert.strictEqual(parseTimelineInput("1/1/0004").value, 4);

  assert.strictEqual(parseTimelineInput("1/1/04").label, "2004-01-01");
  assert.strictEqual(parseTimelineInput("1/1/4").label, "2004-01-01");

  setActiveDateFormat("DMY");
  assert.strictEqual(parseTimelineInput("1/1/0004").label, "0004-01-01");
  setActiveDateFormat("MDY");
});

test("low years round-trip through the input field without jumping to the 2000s", async () => {
  const { parseTimelineInput, formatDateForInput, displayDateLabel, setActiveDateFormat } = await load();

  for (const fmt of ["MDY", "DMY", "ISO"]) {
    setActiveDateFormat(fmt);
    const first = parseTimelineInput("1/1/0004");
    const shown = formatDateForInput(first.label);
    assert.strictEqual(parseTimelineInput(shown).label, first.label, `${fmt} day round-trip`);

    const month = parseTimelineInput("01/0004");
    const shownMonth = formatDateForInput(month.label);
    assert.strictEqual(parseTimelineInput(shownMonth).label, month.label, `${fmt} month round-trip`);
  }

  setActiveDateFormat("MDY");
  assert.strictEqual(formatDateForInput("0004-01-01"), "01/01/0004");
  assert.strictEqual(displayDateLabel("0004-01-01"), "01/01/0004");
  setActiveDateFormat("ISO");
  assert.strictEqual(displayDateLabel("0004-01-01"), "0004-01-01");
  setActiveDateFormat("MDY");
});
