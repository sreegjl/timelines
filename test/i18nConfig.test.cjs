const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const pathToFileUrl = (p) => require("node:url").pathToFileURL(p).href;
const repoRoot = path.join(__dirname, "..");
const load = () => import(pathToFileUrl(path.join(repoRoot, "src", "i18n", "config.js")));

test("resolveLocale matches exact locales and falls back through the base language", async () => {
  const { resolveLocale } = await load();
  assert.strictEqual(resolveLocale("en"), "en");
  // A regional tag resolves to its shipped base language.
  assert.strictEqual(resolveLocale("en-US"), "en");
  // Anything unshipped falls back to English.
  assert.strictEqual(resolveLocale("pt-BR"), "en");
  assert.strictEqual(resolveLocale("de"), "en");
  assert.strictEqual(resolveLocale("xx-YY"), "en");
  assert.strictEqual(resolveLocale(""), "en");
  assert.strictEqual(resolveLocale(null), "en");
});

test("every supported locale has a catalog directory with all namespaces", async () => {
  const { SUPPORTED_LOCALES, APP_NAMESPACES, VIEWER_NAMESPACES } = await load();
  const namespaces = new Set([...APP_NAMESPACES, ...VIEWER_NAMESPACES]);
  for (const { code } of SUPPORTED_LOCALES) {
    const dir = path.join(repoRoot, "src", "locales", code);
    assert.ok(fs.existsSync(dir), `missing catalog directory for ${code}`);
    for (const ns of namespaces) {
      const file = path.join(dir, `${ns}.json`);
      assert.ok(fs.existsSync(file), `missing ${code}/${ns}.json`);
      JSON.parse(fs.readFileSync(file, "utf8"));
    }
  }
});

test("the viewer bundle never depends on desktop-only namespaces", async () => {
  const { VIEWER_NAMESPACES } = await load();
  assert.ok(!VIEWER_NAMESPACES.includes("settings"));
  assert.ok(!VIEWER_NAMESPACES.includes("app"));
});

test("English catalogs have no empty values", () => {
  const dir = path.join(repoRoot, "src", "locales", "en");
  const empties = [];
  const walk = (obj, trail) => {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === "object") walk(value, `${trail}.${key}`);
      else if (value === "") empties.push(`${trail}.${key}`);
    }
  };
  for (const file of fs.readdirSync(dir)) {
    walk(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")), file);
  }
  assert.deepStrictEqual(empties, [], "English is the fallback, so it must be complete");
});
