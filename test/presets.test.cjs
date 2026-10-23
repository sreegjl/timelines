const test = require("node:test");
const assert = require("node:assert");

const load = () => import("../src/utils/presets.js");

test("normalizeProperties trims, drops blanks, dedupes keys", async () => {
  const { normalizeProperties } = await load();
  assert.deepStrictEqual(
    normalizeProperties([{ key: " Role ", value: "Queen" }, { key: "", value: "x" }, { key: "role", value: "dup" }, { key: "Age", value: 30 }]),
    [{ key: "Role", value: "Queen" }, { key: "Age", value: "30" }]
  );
  assert.deepStrictEqual(normalizeProperties(null), []);
});

test("applyPreset fills blanks and keeps existing values", async () => {
  const { applyPreset } = await load();
  const preset = { id: "preset-character", name: "Character", type: "span", color: "#123456", tags: ["character"], properties: ["Role", "Born"] };
  const el = { id: "span-1", type: "span", title: "Ada", tags: ["math"], properties: [{ key: "role", value: "Countess" }] };
  const out = applyPreset(el, preset);
  assert.strictEqual(out.preset, "preset-character");
  assert.strictEqual(out.color, "#123456");
  assert.deepStrictEqual(out.tags, ["math", "character"]);
  assert.deepStrictEqual(out.properties, [{ key: "role", value: "Countess" }, { key: "Born", value: "" }]);
  assert.strictEqual(el.preset, undefined);
});

test("presets from elements get unique ids", async () => {
  const { createPresetFromElement, makePresetId, normalizePresets } = await load();
  const existing = [{ id: "preset-hero", name: "Hero" }];
  const preset = createPresetFromElement({ type: "event", color: "#fff000", properties: [{ key: "Power", value: "flight" }] }, "Hero", existing);
  assert.strictEqual(preset.id, "preset-hero-2");
  assert.deepStrictEqual(preset.properties, ["Power"]);
  assert.strictEqual(makePresetId("  ", []), "preset-preset");
  assert.strictEqual(normalizePresets([{ id: "a", name: "A", type: "weird", properties: ["x", "X", ""] }])[0].type, "event");
  assert.deepStrictEqual(normalizePresets([{ id: "a", name: "A", properties: ["x", "X", ""] }])[0].properties, ["x"]);
});

test("getPropertyKeysInUse collects keys from elements and presets", async () => {
  const { getPropertyKeysInUse, normalizePropertyKey } = await load();
  const keys = getPropertyKeysInUse([{ properties: [{ key: "Role" }, { key: "role" }] }, {}], [{ properties: ["Born"] }]);
  assert.deepStrictEqual(keys, ["Born", "Role"]);
  assert.strictEqual(normalizePropertyKey("Eye Color"), normalizePropertyKey("eye_color"));
});
