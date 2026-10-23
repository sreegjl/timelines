const test = require("node:test");
const assert = require("node:assert");

test("manual order sorts ordered items first, then by date", async () => {
  const { sortByManualOrder, moveInOrder, compareManualOrder } = await import("../src/utils/elementOrder.js");
  const items = [
    { id: "c", date: 3 },
    { id: "a", date: 1, order: 1 },
    { id: "b", date: 2, order: 0 },
    { id: "d", date: 0 },
  ];
  assert.deepStrictEqual(sortByManualOrder(items).map((el) => el.id), ["b", "a", "d", "c"]);
  assert.deepStrictEqual(moveInOrder(items, "c", "b"), ["c", "b", "a", "d"]);
  assert.deepStrictEqual(moveInOrder(items, "b", "d", true), ["a", "d", "b", "c"]);
  assert.deepStrictEqual(moveInOrder(items, "b", "b"), ["b", "a", "d", "c"]);
  assert.deepStrictEqual(moveInOrder(items, "zzz", "b"), ["b", "a", "d", "c"]);
  assert.strictEqual(compareManualOrder({}, {}), 0);
});
