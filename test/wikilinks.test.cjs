const test = require("node:test");
const assert = require("node:assert");

const load = () => import("../src/utils/wikilinks.js");

const VAULT = [
  "my-world-123456/alice.md",
  "my-world-123456/Battle of Cannae.md",
  "People/Alice.md",
  "People/Bob Smith.md",
  "Archive/People/Bob Smith.md",
  "Places/Rome.md",
  "Rome.md",
  "Readme.md",
];

test("parseWikilink splits target, heading and alias", async () => {
  const { parseWikilink } = await load();
  assert.deepStrictEqual(parseWikilink("Alice"), { target: "Alice", heading: "", alias: "" });
  assert.deepStrictEqual(parseWikilink("Alice#Early life"), { target: "Alice", heading: "Early life", alias: "" });
  assert.deepStrictEqual(parseWikilink("Alice|the queen"), { target: "Alice", heading: "", alias: "the queen" });
  assert.deepStrictEqual(parseWikilink(" People/Alice # Reign | her reign "), { target: "People/Alice", heading: "Reign", alias: "her reign" });
});

test("resolves by name, ignoring case and a trailing .md", async () => {
  const { buildNoteIndex, resolveWikilink } = await load();
  const index = buildNoteIndex(VAULT);
  assert.strictEqual(resolveWikilink("battle of cannae", index), "my-world-123456/Battle of Cannae.md");
  assert.strictEqual(resolveWikilink("Readme.md", index), "Readme.md");
  assert.strictEqual(resolveWikilink("Nobody", index), null);
  assert.strictEqual(resolveWikilink("", index), null);
});

test("prefers the open timeline's folder for duplicate names", async () => {
  const { buildNoteIndex, resolveWikilink } = await load();
  const index = buildNoteIndex(VAULT);
  assert.strictEqual(resolveWikilink("Alice", index, { timelineDir: "my-world-123456" }), "my-world-123456/alice.md");
});

test("then the linking note's folder, then the shortest path", async () => {
  const { buildNoteIndex, resolveWikilink } = await load();
  const index = buildNoteIndex(VAULT);
  assert.strictEqual(resolveWikilink("Bob Smith", index, { fromPath: "Archive/People/Index.md" }), "Archive/People/Bob Smith.md");
  assert.strictEqual(resolveWikilink("Bob Smith", index), "People/Bob Smith.md");
  assert.strictEqual(resolveWikilink("Rome", index), "Rome.md");
});

test("resolves full and partial paths", async () => {
  const { buildNoteIndex, resolveWikilink } = await load();
  const index = buildNoteIndex(VAULT);
  assert.strictEqual(resolveWikilink("Places/Rome", index), "Places/Rome.md");
  assert.strictEqual(resolveWikilink("People/Bob Smith", index), "People/Bob Smith.md");
  assert.strictEqual(resolveWikilink("Archive/People/Bob Smith", index), "Archive/People/Bob Smith.md");
  assert.strictEqual(resolveWikilink("Nowhere/Rome", index), null);
});

test("toNotePath mirrors main's folder rules for element note refs", async () => {
  const { toNotePath, timelineNotesDir, toNoteRef } = await load();
  assert.strictEqual(timelineNotesDir("My World-123456"), "my-world-123456");
  assert.strictEqual(toNotePath("event-1.md", "my-world-123456"), "my-world-123456/event-1.md");
  assert.strictEqual(toNotePath("Battle of Cannae.md", "Timelines/my-world-123456"), "Timelines/my-world-123456/Battle of Cannae.md");
  assert.strictEqual(toNotePath("People/Alice.md", "my-world-123456"), "People/Alice.md");
  assert.strictEqual(toNotePath("./Rome.md", "x"), "Rome.md");
  assert.strictEqual(toNoteRef("Rome.md"), "./Rome.md");
  assert.strictEqual(toNoteRef("People/Alice.md"), "People/Alice.md");
});

test("cleanNoteFileName keeps spaces and case but drops unsafe characters", async () => {
  const { cleanNoteFileName } = await load();
  assert.strictEqual(cleanNoteFileName("Bob Smith"), "Bob Smith");
  assert.strictEqual(cleanNoteFileName("  What? A/B: test  "), "What AB test");
  assert.strictEqual(cleanNoteFileName("..hidden"), "hidden");
});
