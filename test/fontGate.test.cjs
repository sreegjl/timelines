const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const pathToFileUrl = (p) => require("node:url").pathToFileURL(p).href;
const load = () => import(pathToFileUrl(path.join(__dirname, "..", "src", "utils", "fontGate.js")));

function makeFonts({ faces = [], notIterable = false } = {}) {
  const fonts = {
    faces,
    check: () => true,
    arrive: (family, status = "loaded") => { fonts.faces.push({ family, status }); },
    [Symbol.iterator]: function* iterate() {
      if (notIterable) throw new TypeError("not iterable");
      yield* fonts.faces;
    },
  };
  return fonts;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STACK = '"Lexend", "Inter", sans-serif';

test("isFontReady is false while the family is absent", async () => {
  const { isFontReady } = await load();
  const fonts = makeFonts({ faces: [{ family: "Inter", status: "loaded" }] });
  assert.strictEqual(isFontReady(fonts, STACK), false);
});

test("isFontReady is false while the family is declared but unloaded", async () => {
  const { isFontReady } = await load();
  const fonts = makeFonts({ faces: [{ family: "Lexend", status: "unloaded" }] });
  assert.strictEqual(isFontReady(fonts, STACK), false);
});

test("isFontReady is true once any face of the family is loaded", async () => {
  const { isFontReady } = await load();
  const fonts = makeFonts({ faces: [
    { family: "Lexend", status: "unloaded" },
    { family: "Lexend", status: "loaded" },
  ] });
  assert.strictEqual(isFontReady(fonts, STACK), true);
});

test("isFontReady ignores case and quoting", async () => {
  const { isFontReady } = await load();
  const fonts = makeFonts({ faces: [{ family: "lexend", status: "loaded" }] });
  assert.strictEqual(isFontReady(fonts, "'Lexend', sans-serif"), true);
});

test("isFontReady is true when there is nothing to inspect", async () => {
  const { isFontReady } = await load();
  assert.strictEqual(isFontReady(undefined, STACK), true);
  assert.strictEqual(isFontReady(makeFonts({ notIterable: true }), STACK), true);
  assert.strictEqual(isFontReady(makeFonts(), ""), true);
});

test("does not wait when the font is already there", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [{ family: "Lexend", status: "loaded" }] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; }, 5000);
  await wait(250);
  assert.strictEqual(calls, 0, "caller already checked isFontReady");
  stop();
});

test("reports once the font arrives", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; }, 5000);

  fonts.arrive("Lexend", "loaded");
  await wait(300);
  assert.strictEqual(calls, 1);
  stop();
});

test("reports on timeout when the font never arrives", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; }, 250);
  await wait(500);
  assert.strictEqual(calls, 1);
  stop();
});

test("reports at most once", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; }, 200);

  fonts.arrive("Lexend", "loaded");
  await wait(700);
  assert.strictEqual(calls, 1, "poll and timeout must not both fire");
  stop();
});

test("cleanup stops any later report", async () => {
  const { watchFontLoad } = await load();
  const fonts = makeFonts({ faces: [] });
  let calls = 0;
  const stop = watchFontLoad(fonts, STACK, () => { calls += 1; }, 200);

  stop();
  fonts.arrive("Lexend", "loaded");
  await wait(500);
  assert.strictEqual(calls, 0);
});
