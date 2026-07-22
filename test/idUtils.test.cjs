const test = require("node:test");
const assert = require("node:assert");

test("ensureUniqueElementIds reassigns duplicate ids, keeping the first occurrence", async () => {
  const { ensureUniqueElementIds } = await import("../src/utils/idUtils.js");
  const eras = [
    { id: "era-arcade", type: "era", title: "1970s ARCADE", start: 1970, end: 1980 },
    { id: "era-arcade", type: "era", title: "1980s ARCADE", start: 1980, end: 1990 },
    { id: "era-arcade", type: "era", title: "1990s ARCADE", start: 1990, end: 2000 },
  ];
  const result = ensureUniqueElementIds(eras);
  assert.strictEqual(result[0].id, "era-arcade");
  assert.notStrictEqual(result[1].id, "era-arcade");
  assert.notStrictEqual(result[2].id, "era-arcade");
  assert.strictEqual(new Set(result.map((e) => e.id)).size, 3);
  assert.ok(result[1].id.startsWith("era-"));
  assert.strictEqual(result[1].title, "1980s ARCADE");
});

test("ensureUniqueElementIds returns the same array when ids are already unique", async () => {
  const { ensureUniqueElementIds } = await import("../src/utils/idUtils.js");
  const elements = [
    { id: "event-1", type: "event" },
    { id: "span-1", type: "span" },
  ];
  assert.strictEqual(ensureUniqueElementIds(elements), elements);
});

test("ensureUniqueElementIds assigns ids to elements missing one", async () => {
  const { ensureUniqueElementIds } = await import("../src/utils/idUtils.js");
  const result = ensureUniqueElementIds([{ type: "event", title: "no id" }, { id: "event-1", type: "event" }]);
  assert.ok(result[0].id.startsWith("event-"));
  assert.strictEqual(result[1].id, "event-1");
  assert.strictEqual(new Set(result.map((e) => e.id)).size, 2);
});
