const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const pathToFileUrl = (p) => require("node:url").pathToFileURL(p).href;
const load = () => import(pathToFileUrl(path.join(__dirname, "..", "src", "utils", "fontGate.js")));

// Stands in for document.fonts; a family absent from `faces` models an unparsed stylesheet
function makeFonts({ faces = [], notIterable = false } = {}) {
  const fonts = {
    faces,
    check: () => true, // as the real one does, even for unknown families
    arrive: (family, status = "loaded") => { fonts.faces.push({ family, status }); },
    [Symbol.iterator]: function* iterate() {
      if (notIterable) throw new TypeError("not iterable");
      yield* fonts.faces;
    },
  };
  return fonts;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const STACK = '"Lexend", "Inter", sans-serif';

test("does nothing when the family is already loaded", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [{ family: "Lexend", status: "loaded" }] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; });
  await settle();
  assert.strictEqual(calls, 0);
  stop();
});

test("reports when an absent family shows up loaded", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [{ family: "Inter", status: "unloaded" }] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; });

  fonts.arrive("Lexend", "loaded");
  await settle();
  assert.strictEqual(calls, 1);
  stop();
});

test("waits while a known family is still loading", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [{ family: "Lexend", status: "unloaded" }] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; });
  await settle();
  assert.strictEqual(calls, 0, "declared but not downloaded is not loaded");

  fonts.faces[0].status = "loaded";
  await settle();
  assert.strictEqual(calls, 1);
  stop();
});

test("settles on one loaded face even when sibling subsets never load", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [{ family: "Lexend", status: "unloaded" }] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; });

  fonts.arrive("Lexend", "unloaded");
  fonts.arrive("Lexend", "loaded");
  await settle();
  assert.strictEqual(calls, 1);
  stop();
});

test("reports at most once", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; });

  fonts.arrive("Lexend", "loaded");
  await settle();
  await settle();
  assert.strictEqual(calls, 1);
  stop();
});

test("matches families case insensitively and ignores quoting", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [{ family: "lexend", status: "loaded" }] });
  let calls = 0;
  const stop = watchFontLoad(fonts, "'Lexend', sans-serif", () => { calls += 1; });
  await settle();
  assert.strictEqual(calls, 0, "same family, so nothing to correct");
  stop();
});

test("does nothing when the set cannot be inspected", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [], notIterable: true });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; });
  await settle();
  assert.strictEqual(calls, 0);
  stop();
});

test("cleanup stops any later report", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; });

  stop();
  fonts.arrive("Lexend", "loaded");
  await settle();
  assert.strictEqual(calls, 0);
});

test("tolerates a browser with no font loading API", async () => {
  const { watchFontLoad } = await load();
  let calls = 0;
  assert.doesNotThrow(() => watchFontLoad(undefined, "Inter", () => { calls += 1; })());
  assert.doesNotThrow(() => watchFontLoad({}, "Inter", () => { calls += 1; })());
  assert.strictEqual(calls, 0);
});
