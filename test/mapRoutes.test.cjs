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

test("routes only join points the map is showing", async () => {
  const { buildRoutes } = await import("../src/utils/mapRoutes.js");
  // the map's "limit to year" marker rule: events on that exact year, spans covering it
  const visibleAt = (year) => (el) => (el.type === "event" ? el.date === year : el.start <= year && year <= el.end);
  // 1905: the trip span and the 1905 event are on the map, the 1902 event's marker is not
  const at1905 = buildRoutes(ELEMENTS, "span", { isPointVisible: visibleAt(1905) });
  assert.deepStrictEqual(at1905[0].points.map((p) => p.id), ["span-trip", "e2"]);
  // 1903: only the span is showing, so there's nothing to join
  assert.deepStrictEqual(buildRoutes(ELEMENTS, "span", { isPointVisible: visibleAt(1903) }), []);
  // a hidden parent span still lends its color to the route between its visible events
  const hiddenParent = buildRoutes(ELEMENTS, "span", { isPointVisible: (el) => el.type === "event" });
  assert.strictEqual(hiddenParent[0].color, "#123456");
});

test("longitudes unwrap across the date line", async () => {
  const { unwrapLongitudes, screenBearing } = await import("../src/utils/mapRoutes.js");
  const pts = unwrapLongitudes([{ lat: 0, lng: 170 }, { lat: 0, lng: -170 }, { lat: 0, lng: -160 }]);
  assert.deepStrictEqual(pts.map((p) => p.lng), [170, 190, 200]);
  assert.strictEqual(Math.round(screenBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 10 })), 0);
  assert.strictEqual(Math.round(screenBearing({ lat: 0, lng: 0 }, { lat: 10, lng: 0 })), -90);
});

test("lineage routes follow extends-from, parent and merges-into links", async () => {
  const { buildRoutes } = await import("../src/utils/mapRoutes.js");
  const els = [
    { id: "a", type: "span", title: "Neolithic", start: -5000, end: -3200, lat: 25, lng: 32, color: "#111111" },
    { id: "b", type: "span", title: "Protodynastic", start: -3200, end: -3000, lat: 26, lng: 32, color: "#222222", extendFrom: "a" },
    { id: "c", type: "span", title: "Offshoot", start: -3100, end: -3050, lat: 27, lng: 33, mergeParent: "b" },
    { id: "d", type: "span", title: "No coords", start: -3100, end: -3000, extendFrom: "a" },
    { id: "e", type: "span", title: "Branch", start: -3150, end: -3100, lat: 28, lng: 31, parent: "b" },
    { id: "f", type: "event", title: "Event inside", date: -3150, lat: 26, lng: 31, parents: ["b"] },
  ];
  const routes = buildRoutes(els, "lineage");
  assert.deepStrictEqual(routes.map((r) => r.id), ["lineage:a>b", "lineage:c>b", "lineage:b>e"]);
  assert.strictEqual(routes[0].color, "#222222");
  assert.deepStrictEqual(routes[1].points.map((p) => p.id), ["c", "b"]);
  // a hidden end means no arrow
  assert.deepStrictEqual(buildRoutes(els, "lineage", { isPointVisible: (el) => el.id !== "a" }).map((r) => r.id), ["lineage:c>b", "lineage:b>e"]);
});
