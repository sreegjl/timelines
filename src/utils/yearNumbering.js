// Switching noYearZero moves stored values so every year keeps the label the user typed;
// only durations change. Year 0 has no historical equivalent and folds into 1 BCE.
export const migrateYearValue = (value, toNoYearZero) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const shifted = toNoYearZero ? (value < 0 ? value + 1 : value) : value < 1 ? value - 1 : value;
  return Math.round(shifted * 1e9) / 1e9;
};

// A calendar label pins its own year, so a moved value can't keep it
const migrateField = (obj, key, labelKey, toNoYearZero) => {
  if (!(key in obj)) return;
  const next = migrateYearValue(obj[key], toNoYearZero);
  if (next === obj[key]) return;
  obj[key] = next;
  if (labelKey) delete obj[labelKey];
};

const migrateRanges = (list, toNoYearZero) =>
  Array.isArray(list)
    ? list.map((item) => ({
        ...item,
        start: migrateYearValue(item?.start, toNoYearZero),
        end: migrateYearValue(item?.end, toNoYearZero),
      }))
    : list;

export function migrateElementYears(el, toNoYearZero) {
  const next = { ...el };
  migrateField(next, "date", "dateLabel", toNoYearZero);
  migrateField(next, "start", "startLabel", toNoYearZero);
  migrateField(next, "end", "endLabel", toNoYearZero);
  if (Array.isArray(el.breaks)) {
    next.breaks = el.breaks.map((brk) => ({ ...brk, year: migrateYearValue(brk?.year, toNoYearZero) }));
  }
  return next;
}

export function migrateFileYears(file, toNoYearZero) {
  const next = { ...file };
  migrateField(next, "start", "startLabel", toNoYearZero);
  migrateField(next, "end", "endLabel", toNoYearZero);
  if (Array.isArray(file.scaleSections)) next.scaleSections = migrateRanges(file.scaleSections, toNoYearZero);
  if (Array.isArray(file.breaks)) next.breaks = migrateRanges(file.breaks, toNoYearZero);
  return next;
}
