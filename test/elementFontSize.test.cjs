const test = require("node:test");
const assert = require("node:assert");

test("element font sizes clamp and scale the card", async () => {
  const { resolveElementFontSize, getEventFontVars, getSpanFontSize, scaleEventHeight } = await import("../src/utils/elementFont.js");
  assert.strictEqual(resolveElementFontSize(undefined), null);
  assert.strictEqual(resolveElementFontSize("abc"), null);
  assert.strictEqual(resolveElementFontSize(2), 6);
  assert.strictEqual(resolveElementFontSize(99), 32);
  assert.strictEqual(resolveElementFontSize(13.6), 14);
  assert.strictEqual(getEventFontVars(10, 10, 25), null);
  assert.strictEqual(getEventFontVars(20, 10, 25)["--event-height"], "50px");
  assert.strictEqual(scaleEventHeight(25, 10, 10), 25);
  assert.strictEqual(getSpanFontSize({ fontSize: 30 }), 15);
  assert.strictEqual(getSpanFontSize({ fontSize: 30, spanSize: "thick" }), 28);
  assert.strictEqual(getSpanFontSize({}), null);
});
