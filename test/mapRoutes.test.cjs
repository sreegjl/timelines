const test = require("node:test");
const assert = require("node:assert");

const ELEMENTS = [
  { id: "span-trip", type: "span", title: "Trip", start: 1900, end: 1910, color: "#123456", lat: 48.85, lng: 2.35, tags: ["travel"], groupId: "g1" },
  { id: "e2", type: "event", date: 1905, parents: ["span-trip"], lat: 41.9, lng: 12.5, tags: ["travel"], groupId: "g1" },
  { id: "e1", type: "event", date: 1902, parents: ["span-trip"], lat: 52.5, lng: 13.4, groupId: "g1" },
  { id: "e3", type: "event", date: 1903, parents: [], lat: 35.7, lng: 139.7, tags: ["travel"], groupId: "g2" },
  { id: "e4", type: "event", date: 1904, parents: ["span-trip"], groupId: "g1" },
  { id: "era", type: "era", start: 1900, end: 1950, lat: 0, lng: 0 },
];

test("routes by parent span run in date order and include the span", async () => {
  const { buildRoutes } = await import("../src/utils/mapRoutes.js");
  const routes = buildRoutes(ELEMENTS, "span");
  assert.strictEqual(routes.length, 1);
  assert.strictEqual(routes[0].color, "#123456");
  assert.deepStrictEqual(routes[0].points.map((p) => p.id), ["span-trip", "e1", "e2"]);
});

test("routes by tag, group, all, off and year limit", async () => {
  const { buildRoutes } = await import("../src/utils/mapRoutes.js");
  assert.deepStrictEqual(buildRoutes(ELEMENTS, "tag", { tagColors: { travel: "#ff0000" } })[0].points.map((p) => p.id), ["span-trip", "e3", "e2"]);
  assert.strictEqual(buildRoutes(ELEMENTS, "group").length, 1);
  assert.strictEqual(buildRoutes(ELEMENTS, "all")[0].points.length, 4);
  assert.deepStrictEqual(buildRoutes(ELEMENTS, "off"), []);
  const limited = buildRoutes(ELEMENTS, "span", { limitToYear: true, viewportYear: 1903 });
  assert.deepStrictEqual(limited[0].points.map((p) => p.id), ["span-trip", "e1"]);
  assert.deepStrictEqual(buildRoutes(ELEMENTS, "span", { limitToYear: true, viewportYear: 1901 }), []);
});

test("longitudes unwrap across the date line", async () => {
  const { unwrapLongitudes, screenBearing } = await import("../src/utils/mapRoutes.js");
  const pts = unwrapLongitudes([{ lat: 0, lng: 170 }, { lat: 0, lng: -170 }, { lat: 0, lng: -160 }]);
  assert.deepStrictEqual(pts.map((p) => p.lng), [170, 190, 200]);
  assert.strictEqual(Math.round(screenBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 10 })), 0);
  assert.strictEqual(Math.round(screenBearing({ lat: 0, lng: 0 }, { lat: 10, lng: 0 })), -90);
});
