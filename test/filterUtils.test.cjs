const test = require("node:test");
const assert = require("node:assert");

const ELEMENTS = [
  { id: "span-rome", type: "span", title: "Roman Republic", start: -509, end: -27 },
  { id: "span-punic", type: "span", title: "Punic Wars", parent: "span-rome", start: -264, end: -146 },
  { id: "event-cannae", type: "event", title: "Cannae", parents: ["span-punic"], date: -216 },
  { id: "span-empire", type: "span", title: "Roman Empire", extendFrom: "span-rome", start: -27, end: 476 },
  { id: "span-legion", type: "span", title: "Legion Reform", mergeParent: "span-rome", start: -107, end: -27 },
  { id: "span-greece", type: "span", title: "Classical Greece", start: -510, end: -323 },
  { id: "event-marathon", type: "event", title: "Marathon", parents: ["span-greece"], date: -490 },
];

async function run(query, elements = ELEMENTS) {
  const { parseFilterQuery, matchesFilter, buildFilterContext } = await import("../src/utils/filterUtils.js");
  const parsed = parseFilterQuery(query);
  const context = buildFilterContext(elements);
  return elements.filter((el) => matchesFilter(el, parsed, null, context)).map((el) => el.id);
}

test("family: returns the span itself plus every kind of descendant", async () => {
  const ids = await run("family:span-rome");
  assert.deepStrictEqual(ids.sort(), [
    "event-cannae",
    "span-empire",
    "span-legion",
    "span-punic",
    "span-rome",
  ]);
});

test("family: excludes unrelated elements and their children", async () => {
  const ids = await run("family:span-rome");
  assert.ok(!ids.includes("span-greece"));
  assert.ok(!ids.includes("event-marathon"));
});

test("family: resolves an exact title as well as an id", async () => {
  assert.deepStrictEqual(
    (await run('family:"roman republic"')).sort(),
    (await run("family:span-rome")).sort()
  );
});

test("family: falls back to a title substring when nothing matches exactly", async () => {
  const ids = await run("family:greece");
  assert.deepStrictEqual(ids.sort(), ["event-marathon", "span-greece"]);
});

test("family: yields nothing for an unknown target", async () => {
  assert.deepStrictEqual(await run("family:span-atlantis"), []);
});

test("family: combines with other leaves", async () => {
  assert.deepStrictEqual(await run("family:span-rome is:event"), ["event-cannae"]);
  assert.deepStrictEqual(
    (await run("~family:span-rome")).sort(),
    ["event-marathon", "span-greece"]
  );
});

test("family: does not match when no context is supplied", async () => {
  const { parseFilterQuery, matchesFilter } = await import("../src/utils/filterUtils.js");
  const parsed = parseFilterQuery("family:span-rome");
  assert.strictEqual(matchesFilter(ELEMENTS[0], parsed), false);
});

test("family: tolerates a parent cycle", async () => {
  const cyclic = [
    { id: "span-a", type: "span", title: "A", parent: "span-b" },
    { id: "span-b", type: "span", title: "B", parent: "span-a" },
  ];
  assert.deepStrictEqual((await run("family:span-a", cyclic)).sort(), ["span-a", "span-b"]);
});

test("parent: matches direct children only", async () => {
  assert.deepStrictEqual(
    (await run("parent:span-rome")).sort(),
    ["span-empire", "span-legion", "span-punic"]
  );
});

test("parent: matches a parent title substring", async () => {
  assert.deepStrictEqual((await run("parent:roman")).sort(), ["span-empire", "span-legion", "span-punic"]);
  assert.deepStrictEqual(await run("parent:greece"), ["event-marathon"]);
});

test("parent: keeps substring matching even when a title matches exactly", async () => {
  const nested = [
    { id: "span-sega", type: "span", title: "Sega" },
    { id: "span-genesis", type: "span", title: "Sega Genesis", parent: "span-sega" },
    { id: "e-sonic", type: "event", title: "Sonic", parents: ["span-genesis"] },
    { id: "span-saturn", type: "span", title: "Sega Saturn" },
    { id: "e-nights", type: "event", title: "NiGHTS", parents: ["span-saturn"] },
  ];
  assert.deepStrictEqual((await run("parent:sega", nested)).sort(), ["e-nights", "e-sonic", "span-genesis"]);
  assert.deepStrictEqual(
    (await run("family:sega", nested)).sort(),
    ["e-sonic", "span-genesis", "span-sega"]
  );
});

test("parent: resolves a quoted multi-word title and combines with other leaves", async () => {
  assert.deepStrictEqual(
    (await run('parent:"roman republic"')).sort(),
    ["span-empire", "span-legion", "span-punic"]
  );
  assert.deepStrictEqual(await run("parent:punic is:event"), ["event-cannae"]);
  assert.deepStrictEqual((await run("~parent:roman is:span")).sort(), ["span-greece", "span-rome"]);
});

test("parent: yields nothing for an unknown target", async () => {
  assert.deepStrictEqual(await run("parent:span-atlantis"), []);
});

test("parent: does not match when no context is supplied", async () => {
  const { parseFilterQuery, matchesFilter } = await import("../src/utils/filterUtils.js");
  const parsed = parseFilterQuery("parent:span-rome");
  assert.strictEqual(matchesFilter(ELEMENTS[1], parsed), false);
});

const TAGGED = [
  { id: "e-ww1", type: "event", title: "Armistice", date: 1918, tags: ["World War", "europe"] },
  { id: "e-moon", type: "event", title: "Apollo 11", date: 1969, tags: ["space"] },
];

test("#tag matches a tag containing spaces when quoted", async () => {
  assert.deepStrictEqual(await run('#"world war"', TAGGED), ["e-ww1"]);
  assert.deepStrictEqual(await run('# "world war"', TAGGED), ["e-ww1"]);
});

test("#tag with spaces combines with other leaves", async () => {
  assert.deepStrictEqual(await run('#"world war" is:event', TAGGED), ["e-ww1"]);
  assert.deepStrictEqual(await run('~#"world war"', TAGGED), ["e-moon"]);
  assert.deepStrictEqual((await run('#"world war" | #space', TAGGED)).sort(), ["e-moon", "e-ww1"]);
});

test("#tag without spaces still matches unquoted", async () => {
  assert.deepStrictEqual(await run("#space", TAGGED), ["e-moon"]);
});

test("a quoted tag tokenizes as a tag leaf", async () => {
  const { tokenizeFilterQuery } = await import("../src/utils/filterUtils.js");
  assert.deepStrictEqual(tokenizeFilterQuery('#"World War"'), [
    { t: "LEAF", kind: "tag", value: "world war" },
  ]);
});

test("tag: matches part of a tag name", async () => {
  assert.deepStrictEqual(await run("tag:war", TAGGED), ["e-ww1"]);
  assert.deepStrictEqual(await run("tag:pac", TAGGED), ["e-moon"]);
});

test("tag: is case-insensitive and accepts spaces when quoted", async () => {
  assert.deepStrictEqual(await run("tag:WAR", TAGGED), ["e-ww1"]);
  assert.deepStrictEqual(await run('tag:"world war"', TAGGED), ["e-ww1"]);
  assert.deepStrictEqual(await run('tag: "rld wa"', TAGGED), ["e-ww1"]);
});

test("tag: combines with other leaves", async () => {
  assert.deepStrictEqual(await run("tag:war is:event", TAGGED), ["e-ww1"]);
  assert.deepStrictEqual(await run("~tag:war", TAGGED), ["e-moon"]);
  assert.deepStrictEqual((await run("tag:war | tag:pac", TAGGED)).sort(), ["e-moon", "e-ww1"]);
});

test("tag: differs from #tag, which stays exact", async () => {
  assert.deepStrictEqual(await run("#war", TAGGED), []);
  assert.deepStrictEqual(await run("tag:war", TAGGED), ["e-ww1"]);
});

test("tag: tokenizes as a tagsearch leaf", async () => {
  const { tokenizeFilterQuery } = await import("../src/utils/filterUtils.js");
  assert.deepStrictEqual(tokenizeFilterQuery("tag:World"), [
    { t: "LEAF", kind: "tagsearch", value: "world" },
  ]);
});

test("contains: still parses with a space before its value", async () => {
  const { tokenizeFilterQuery } = await import("../src/utils/filterUtils.js");
  assert.deepStrictEqual(tokenizeFilterQuery("contains: siege"), [
    { t: "LEAF", kind: "contains", value: "siege" },
  ]);
});
