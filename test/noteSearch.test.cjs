const test = require("node:test");
const assert = require("node:assert");

test("stripMarkdown keeps the words and drops the costume", async () => {
  const { stripMarkdown } = await import("../src/utils/noteSearch.js");
  assert.strictEqual(stripMarkdown("# Title\n\n**bold** and [a link](https://x.y) ![img](a.png)"), "Title bold and a link");
  assert.strictEqual(stripMarkdown("- [x] done\n- item\n> quoted"), "done item quoted");
  assert.strictEqual(stripMarkdown("see [[Some Page|alias]] and [[Other]]"), "see alias and Other");
});

test("findNoteSnippet returns context around the first match", async () => {
  const { findNoteSnippet } = await import("../src/utils/noteSearch.js");
  const hit = findNoteSnippet("# Assassination\n\nFranz Ferdinand in **Sarajevo**, sarajevo again", "sarajevo", 10);
  assert.strictEqual(hit.match, "Sarajevo");
  assert.strictEqual(hit.count, 2);
  assert.ok(hit.before.startsWith("…"));
  assert.strictEqual(findNoteSnippet("nothing here", "zzz"), null);
  assert.strictEqual(findNoteSnippet("anything", "  "), null);
});

test("getNoteSearchText ignores filter syntax", async () => {
  const { getNoteSearchText } = await import("../src/utils/noteSearch.js");
  assert.strictEqual(getNoteSearchText("franz"), "franz");
  assert.strictEqual(getNoteSearchText('"two words"'), "two words");
  assert.strictEqual(getNoteSearchText("#war"), "");
  assert.strictEqual(getNoteSearchText("is:event"), "");
  assert.strictEqual(getNoteSearchText("a | b"), "");
});
