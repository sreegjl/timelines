const test = require("node:test");
const assert = require("node:assert");

test("timeline links normalize, resolve and describe", async () => {
  const { normalizeLinks, findLinkTarget, describeLink, normalizeListing } = await import("../src/utils/timelineLinks.js");
  assert.deepStrictEqual(
    normalizeLinks([{ timeline: " rome-123 ", element: "event-a" }, { timeline: "rome-123", element: "event-a" }, { timeline: "" }, { timeline: "greece", element: "  " }]),
    [{ timeline: "rome-123", element: "event-a" }, { timeline: "greece" }]
  );
  const listing = [{ id: "history/rome", uid: "rome-123", name: "Rome" }, { id: "greece", uid: "greece-9", name: "Greece" }];
  assert.strictEqual(findLinkTarget(listing, { timeline: "rome-123" }).id, "history/rome");
  assert.strictEqual(findLinkTarget(listing, { timeline: "greece" }).name, "Greece");
  assert.strictEqual(findLinkTarget(listing, { timeline: "nope" }), null);
  assert.deepStrictEqual(describeLink({ timeline: "nope", timelineTitle: "Old" }, listing, "x"), { isSelf: false, isMissing: true, timelineTitle: "Old", elementTitle: null });
  assert.strictEqual(describeLink({ timeline: "x", element: "e", elementTitle: "E" }, listing, "x").isSelf, true);
  assert.deepStrictEqual(normalizeListing({ files: [1] }), [1]);
  assert.deepStrictEqual(normalizeListing([2]), [2]);
  assert.deepStrictEqual(normalizeListing(null), []);
});
