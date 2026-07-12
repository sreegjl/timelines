// Byte-stability guard for deterministic package builds: a drift here would
// show up in production as "every timeline dirty" on every sync
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { buildPackage, readPackage, strToU8, strFromU8 } = require('../electron/timelinePackage.cjs');

const fixture = () => ({
  json: JSON.stringify({ file: { uid: 'fx', title: 'Fixture' }, elements: [{ id: 1, title: 'One' }] }, null, 2),
  files: {
    'assets/img.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]),
    'notes/one.md': strToU8('# One\n\nhello'),
    'assets/zzz.bin': new Uint8Array([9, 9, 9]),
  },
});

test('deterministic builds are byte-identical across runs', async () => {
  const { json, files } = fixture();
  const a = buildPackage(json, files, { deterministic: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const b = buildPackage(json, { 'notes/one.md': files['notes/one.md'], 'assets/zzz.bin': files['assets/zzz.bin'], 'assets/img.png': files['assets/img.png'] }, { deterministic: true });
  assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
});

test('touching one asset changes the build', () => {
  const { json, files } = fixture();
  const a = buildPackage(json, files, { deterministic: true });
  const changed = { ...files, 'assets/img.png': new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9]) };
  const b = buildPackage(json, changed, { deterministic: true });
  assert.notEqual(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
});

test('readPackage reads stored (level 0) entries', () => {
  const { json, files } = fixture();
  const pkg = readPackage(buildPackage(json, files, { deterministic: true }));
  assert.equal(pkg.timelineJson, json);
  assert.equal(pkg.manifest.format, 'timeline-package');
  assert.equal(pkg.notes['one.md'], '# One\n\nhello');
  assert.equal(Buffer.compare(Buffer.from(pkg.assets['img.png']), Buffer.from(files['assets/img.png'])), 0);
});

test('ESM viewer twin packageReader.js reads stored entries', async () => {
  const { json, files } = fixture();
  const zip = buildPackage(json, files, { deterministic: true });
  const mod = await import(pathToFileURL(path.join(__dirname, '../src/utils/packageReader.js')).href);
  const pkg = mod.readPackage(zip);
  assert.equal(pkg.timelineJson, json);
  assert.equal(pkg.notes['one.md'], '# One\n\nhello');
  assert.equal(strFromU8(pkg.assets['zzz.bin'] instanceof Uint8Array ? pkg.assets['zzz.bin'] : new Uint8Array()), '\t\t\t');
});
