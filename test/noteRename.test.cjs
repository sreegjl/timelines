const test = require("node:test");
const assert = require("node:assert");

test("renamed note refs keep their folder and get sanitized", async () => {
  const { buildRenamedNoteRef, getNoteDisplayName } = await import("../src/utils/noteRefs.js");
  assert.strictEqual(buildRenamedNoteRef("event-a.md", "Franz Ferdinand"), "franz-ferdinand.md");
  assert.strictEqual(buildRenamedNoteRef("event-a.md", "sarajevo.md"), "sarajevo.md");
  assert.strictEqual(buildRenamedNoteRef("vault/people/old.md", "New Name"), "vault/people/New-Name.md");
  assert.strictEqual(buildRenamedNoteRef("event-a.md", "../../etc/passwd"), "etc-passwd.md");
  assert.strictEqual(buildRenamedNoteRef("event-a.md", "   "), null);
  assert.strictEqual(buildRenamedNoteRef("event-a.md", "***"), null);
  assert.strictEqual(buildRenamedNoteRef("a/b.md", "c d"), "a/c-d.md");
  assert.strictEqual(getNoteDisplayName("vault/people/old.md"), "old");
});
